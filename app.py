"""Audita's local, read-only Flask backend.

The MediaMonkey export is intentionally kept as the source of truth.  The
backend parses it once at startup and exposes normalized aggregates through a
small JSON API for the Electron renderer.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from flask import Flask, jsonify, request, send_from_directory


APP_VERSION = "0.1.0"
LOGGER = logging.getLogger("audita")
YEAR_PATTERN = re.compile(r"^(\d{4})")


def _resource_dir() -> Path:
    """Return the directory containing bundled static resources."""

    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent


RESOURCE_DIR = _resource_dir()
STATIC_DIR = RESOURCE_DIR / "static"
DEFAULT_STATS_FILE = RESOURCE_DIR / "data" / "mm_stats.xml"
STATS_FILE = Path(os.environ.get("AUDITA_STATS_FILE", str(DEFAULT_STATS_FILE))).expanduser()


class StatsLoadError(RuntimeError):
    """Raised when the MediaMonkey export cannot be loaded safely."""


def _clean_text(value: str | None, fallback: str = "") -> str:
    return (value or "").strip() or fallback


def _child_text(node: ET.Element, tag: str, fallback: str = "") -> str:
    child = node.find(tag)
    return _clean_text(child.text if child is not None else None, fallback)


def _parse_non_negative_int(value: str | None, field_name: str) -> int:
    text = (value or "").strip()
    if not text:
        return 0
    try:
        parsed = int(float(text))
    except ValueError as exc:
        raise StatsLoadError(f"Invalid {field_name} value in the MediaMonkey export: {text!r}") from exc
    return max(0, parsed)


def _parse_length_ms(node: ET.Element) -> int:
    length_node = node.find("Length")
    if length_node is None:
        return 0

    raw_value = length_node.attrib.get("value", "").strip()
    if raw_value:
        try:
            return max(0, int(float(raw_value)))
        except ValueError as exc:
            raise StatsLoadError(f"Invalid track length value: {raw_value!r}") from exc

    display_value = _clean_text(length_node.text)
    if not display_value:
        return 0
    parts = display_value.split(":")
    if len(parts) != 3:
        raise StatsLoadError(f"Invalid track length: {display_value!r}")
    try:
        hours, minutes, seconds = (int(part) for part in parts)
    except ValueError as exc:
        raise StatsLoadError(f"Invalid track length: {display_value!r}") from exc
    return max(0, ((hours * 60 + minutes) * 60 + seconds) * 1000)


def _parse_year(date_value: str) -> int | None:
    match = YEAR_PATTERN.match(date_value)
    return int(match.group(1)) if match else None


def _split_genres(value: str) -> list[str]:
    genres: list[str] = []
    seen: set[str] = set()
    for raw_genre in value.split(";"):
        genre = raw_genre.strip()
        key = genre.casefold()
        if genre and key not in seen:
            genres.append(genre)
            seen.add(key)
    return genres


def _new_aggregate(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "tracks": 0,
        "plays": 0,
        "listening_ms": 0,
    }


def _add_track_totals(target: dict[str, Any], song: dict[str, Any]) -> None:
    target["tracks"] += 1
    target["plays"] += song["plays"]
    target["listening_ms"] += song["listening_ms"]


def _sorted_names(values: Iterable[str]) -> list[str]:
    return sorted(values, key=lambda value: value.casefold())


class MusicStats:
    """Parse and aggregate one MediaMonkey XML export."""

    def __init__(self, source_path: Path) -> None:
        self.source_path = source_path
        self.loaded_at = ""
        self.songs: list[dict[str, Any]] = []
        self.artists: list[dict[str, Any]] = []
        self.albums: list[dict[str, Any]] = []
        self.genres: list[dict[str, Any]] = []
        self.years: list[dict[str, Any]] = []
        self.summary: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self.source_path.is_file():
            raise StatsLoadError(f"MediaMonkey statistics file was not found: {self.source_path}")

        try:
            root = ET.parse(self.source_path).getroot()
        except (OSError, ET.ParseError) as exc:
            raise StatsLoadError(f"Could not parse the MediaMonkey statistics file: {exc}") from exc

        if root.tag != "MusicDatabase":
            raise StatsLoadError(f"Unexpected MediaMonkey root element: {root.tag!r}")

        artist_catalog: dict[str, str] = {}
        artists_node = root.find("Artists")
        if artists_node is not None:
            for artist_node in artists_node.findall("Artist"):
                artist_id = _clean_text(artist_node.attrib.get("id"))
                name = _child_text(artist_node, "Name")
                if artist_id and name:
                    artist_catalog[artist_id] = name

        album_catalog: dict[str, dict[str, str]] = {}
        albums_node = root.find("Albums")
        if albums_node is not None:
            for album_node in albums_node.findall("Album"):
                album_id = _clean_text(album_node.attrib.get("id"))
                title = _child_text(album_node, "Title", "Unknown album")
                artist = _child_text(album_node, "AlbumArtist", "Unknown artist")
                if album_id:
                    album_catalog[album_id] = {"title": title, "artist": artist}

        artist_rows: dict[str, dict[str, Any]] = {}
        album_rows: dict[str, dict[str, Any]] = {}
        genre_rows: dict[str, dict[str, Any]] = {}
        year_rows: dict[int, dict[str, Any]] = {}
        album_ids_by_artist: defaultdict[str, set[str]] = defaultdict(set)
        genre_names_by_artist: defaultdict[str, set[str]] = defaultdict(set)
        album_ids_by_year: defaultdict[int, set[str]] = defaultdict(set)
        dates: list[str] = []

        songs_node = root.find("Songs")
        song_nodes = songs_node.findall("Song") if songs_node is not None else []
        for index, song_node in enumerate(song_nodes, start=1):
            song_id = _clean_text(song_node.attrib.get("id"), f"song_{index}")
            artist = _child_text(song_node, "Artist", "Unknown artist")
            title = _child_text(song_node, "Title", "Unknown track")
            album_node = song_node.find("Album")
            catalog_album_id = _clean_text(album_node.attrib.get("id") if album_node is not None else None)
            catalog_album = album_catalog.get(catalog_album_id, {})
            album_title = _clean_text(
                album_node.text if album_node is not None else None,
                catalog_album.get("title", "Unknown album"),
            )
            album_artist = _child_text(
                song_node,
                "AlbumArtist",
                catalog_album.get("artist") or artist,
            )
            length_ms = _parse_length_ms(song_node)
            plays = _parse_non_negative_int(_child_text(song_node, "PlayCounter"), "PlayCounter")
            date_value = _child_text(song_node, "Date")
            year = _parse_year(date_value)
            genres = _split_genres(_child_text(song_node, "Genre"))
            album_key = catalog_album_id or (
                f"album:{album_artist.casefold()}:{album_title.casefold()}"
            )
            song = {
                "id": song_id,
                "artist": artist,
                "album": album_title,
                "album_id": catalog_album_id or album_key,
                "album_artist": album_artist,
                "title": title,
                "length_ms": length_ms,
                "date": date_value,
                "year": year,
                "genres": genres,
                "plays": plays,
                "listening_ms": length_ms * plays,
            }
            self.songs.append(song)
            if date_value:
                dates.append(date_value)

            artist_row = artist_rows.setdefault(artist, _new_aggregate(artist))
            _add_track_totals(artist_row, song)
            album_ids_by_artist[artist].add(album_key)
            genre_names_by_artist[artist].update(genres)

            album_row = album_rows.setdefault(
                album_key,
                {
                    **_new_aggregate(album_title),
                    "id": album_key,
                    "title": album_title,
                    "artists": set(),
                    "genres": set(),
                    "year": year,
                    "date": date_value,
                },
            )
            _add_track_totals(album_row, song)
            album_row["artists"].add(album_artist)
            album_row["genres"].update(genres)
            if album_row["year"] is None and year is not None:
                album_row["year"] = year
            if not album_row["date"] and date_value:
                album_row["date"] = date_value

            for genre in genres:
                genre_key = genre.casefold()
                genre_row = genre_rows.setdefault(genre_key, _new_aggregate(genre))
                _add_track_totals(genre_row, song)

            if year is not None:
                year_row = year_rows.setdefault(
                    year,
                    {
                        "year": year,
                        "tracks": 0,
                        "plays": 0,
                        "listening_ms": 0,
                        "album_ids": set(),
                    },
                )
                _add_track_totals(year_row, song)
                album_ids_by_year[year].add(album_key)

        self.artists = []
        for artist, row in artist_rows.items():
            self.artists.append(
                {
                    **row,
                    "id": artist,
                    "albums": len(album_ids_by_artist[artist]),
                    "genres": len(genre_names_by_artist[artist]),
                }
            )

        self.albums = []
        for row in album_rows.values():
            artists = _sorted_names(row["artists"])
            genres = _sorted_names(row["genres"])
            self.albums.append(
                {
                    "id": row["id"],
                    "name": row["title"],
                    "title": row["title"],
                    "artist": "; ".join(artists) or "Unknown artist",
                    "artists": artists,
                    "genres": genres,
                    "tracks": row["tracks"],
                    "plays": row["plays"],
                    "listening_ms": row["listening_ms"],
                    "year": row["year"],
                    "date": row["date"],
                }
            )

        self.genres = [
            {
                **row,
                "id": row["name"],
            }
            for row in genre_rows.values()
        ]
        self.years = [
            {
                "year": year,
                "tracks": row["tracks"],
                "plays": row["plays"],
                "listening_ms": row["listening_ms"],
                "albums": len(album_ids_by_year[year]),
            }
            for year, row in sorted(year_rows.items())
        ]
        self.loaded_at = datetime.now(timezone.utc).isoformat()

        total_plays = sum(song["plays"] for song in self.songs)
        total_listening_ms = sum(song["listening_ms"] for song in self.songs)
        self.summary = {
            "tracks": len(self.songs),
            "played_tracks": sum(1 for song in self.songs if song["plays"] > 0),
            "artists": len(self.artists),
            "catalog_artists": len(artist_catalog),
            "albums": len(self.albums),
            "catalog_albums": len(album_catalog),
            "genres": len(self.genres),
            "plays": total_plays,
            "listening_ms": total_listening_ms,
            "date_start": min(dates) if dates else None,
            "date_end": max(dates) if dates else None,
            "years": len(self.years),
        }

    def _ranked(self, rows: list[dict[str, Any]], field: str, limit: int = 8) -> list[dict[str, Any]]:
        return sorted(
            rows,
            key=lambda row: (-row[field], str(row.get("name", row.get("title", ""))).casefold()),
        )[:limit]

    def dashboard(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "top_artists": self._ranked(self.artists, "plays"),
            "top_artists_by_time": self._ranked(self.artists, "listening_ms"),
            "top_albums": self._ranked(self.albums, "plays"),
            "top_albums_by_time": self._ranked(self.albums, "listening_ms"),
            "top_tracks": self._ranked(self.songs, "plays"),
            "top_tracks_by_time": self._ranked(self.songs, "listening_ms"),
            "top_genres": self._ranked(self.genres, "plays"),
            "top_genres_by_time": self._ranked(self.genres, "listening_ms"),
            "years": self.years,
            "latest_tracks": sorted(
                [song for song in self.songs if song["date"]],
                key=lambda song: (song["date"], song["title"].casefold()),
                reverse=True,
            )[:8],
            "metadata": self.metadata(),
        }

    def metadata(self) -> dict[str, Any]:
        return {
            "app_version": APP_VERSION,
            "source_name": self.source_path.name,
            "loaded_at": self.loaded_at,
            "calculation": "Listening time = track length × MediaMonkey PlayCounter.",
            "date_note": (
                "The XML contains one Date value per track, not a timestamp for each play. "
                "Timeline values therefore describe the dates present in the catalog, not listening activity over time."
            ),
        }

    def query(
        self,
        kind: str,
        *,
        query: str = "",
        sort: str = "",
        order: str = "desc",
        page: int = 1,
        page_size: int = 25,
        artist: str = "",
        album: str = "",
        genre: str = "",
    ) -> dict[str, Any]:
        rows = list(self.songs if kind == "tracks" else getattr(self, kind))
        query_text = query.casefold().strip()

        if query_text:
            def matches(row: dict[str, Any]) -> bool:
                fields = {
                    "artists": " ".join(row.get("artists", [])),
                    "genres": " ".join(row.get("genres", [])),
                }
                values = [
                    row.get("name", ""),
                    row.get("title", ""),
                    row.get("artist", ""),
                    row.get("album", ""),
                    fields.get("artists", ""),
                    fields.get("genres", ""),
                ]
                return query_text in " ".join(str(value) for value in values).casefold()

            rows = [row for row in rows if matches(row)]

        if kind == "tracks":
            if artist:
                rows = [row for row in rows if row["artist"].casefold() == artist.casefold()]
            if album:
                rows = [row for row in rows if row["album"].casefold() == album.casefold()]
            if genre:
                rows = [
                    row
                    for row in rows
                    if any(item.casefold() == genre.casefold() for item in row["genres"])
                ]

        allowed_sorts = {
            "artists": {"name", "tracks", "albums", "genres", "plays", "listening_ms"},
            "albums": {"name", "artist", "year", "tracks", "plays", "listening_ms"},
            "tracks": {
                "title",
                "artist",
                "album",
                "date",
                "length_ms",
                "plays",
                "listening_ms",
            },
            "genres": {"name", "tracks", "plays", "listening_ms"},
        }
        defaults = {
            "artists": "plays",
            "albums": "plays",
            "tracks": "plays",
            "genres": "plays",
        }
        selected_sort = sort if sort in allowed_sorts[kind] else defaults[kind]
        descending = order != "asc"

        def sort_value(row: dict[str, Any]) -> Any:
            value = row.get(selected_sort)
            if value is None:
                return "" if selected_sort in {"name", "title", "artist", "album", "date"} else 0
            return value.casefold() if isinstance(value, str) else value

        rows.sort(key=lambda row: str(row.get("name", row.get("title", ""))).casefold())
        rows.sort(key=sort_value, reverse=descending)

        total = len(rows)
        safe_page_size = min(100, max(1, page_size))
        pages = max(1, (total + safe_page_size - 1) // safe_page_size)
        safe_page = min(pages, max(1, page))
        start = (safe_page - 1) * safe_page_size
        return {
            "items": rows[start : start + safe_page_size],
            "page": safe_page,
            "page_size": safe_page_size,
            "pages": pages,
            "total": total,
            "sort": selected_sort,
            "order": "desc" if descending else "asc",
            "query": query,
        }


def _load_stats() -> tuple[MusicStats | None, str | None]:
    try:
        return MusicStats(STATS_FILE), None
    except StatsLoadError as exc:
        LOGGER.exception("Unable to load MediaMonkey statistics")
        return None, str(exc)


stats, stats_error = _load_stats()
app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


def _stats_error_response() -> tuple[Any, int]:
    return (
        jsonify(
            {
                "error": "Audita could not load the MediaMonkey statistics file.",
                "details": stats_error or "Unknown loading error.",
            }
        ),
        503,
    )


def _require_stats() -> MusicStats | tuple[Any, int]:
    return stats if stats is not None else _stats_error_response()


@app.get("/")
def index() -> Any:
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/status")
def status() -> Any:
    if stats is None:
        return jsonify({"ok": False, "error": stats_error}), 503
    return jsonify({"ok": True, "metadata": stats.metadata()})


@app.get("/api/dashboard")
def dashboard() -> Any:
    loaded = _require_stats()
    if not isinstance(loaded, MusicStats):
        return loaded
    return jsonify(loaded.dashboard())


def _list_response(kind: str) -> Any:
    loaded = _require_stats()
    if not isinstance(loaded, MusicStats):
        return loaded
    try:
        page = int(request.args.get("page", "1"))
        page_size = int(request.args.get("page_size", "25"))
    except ValueError:
        return jsonify({"error": "page and page_size must be integers"}), 400
    return jsonify(
        loaded.query(
            kind,
            query=request.args.get("q", ""),
            sort=request.args.get("sort", ""),
            order=request.args.get("order", "desc"),
            page=page,
            page_size=page_size,
            artist=request.args.get("artist", ""),
            album=request.args.get("album", ""),
            genre=request.args.get("genre", ""),
        )
    )


@app.get("/api/artists")
def artists() -> Any:
    return _list_response("artists")


@app.get("/api/albums")
def albums() -> Any:
    return _list_response("albums")


@app.get("/api/tracks")
def tracks() -> Any:
    return _list_response("tracks")


@app.get("/api/genres")
def genres() -> Any:
    return _list_response("genres")


@app.get("/api/years")
def years() -> Any:
    loaded = _require_stats()
    if not isinstance(loaded, MusicStats):
        return loaded
    return jsonify({"items": loaded.years})


@app.errorhandler(404)
def not_found(error: Any) -> Any:
    if request.path.startswith("/api/"):
        return jsonify({"error": "API endpoint not found"}), 404
    return error


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    port = int(os.environ.get("AUDITA_PORT", "48735"))
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
