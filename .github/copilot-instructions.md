# Audita — Agent Directives

These directives apply whenever working on the Audita project. They keep the
Electron shell, read-only Flask API, MediaMonkey calculations, and statistics
renderer consistent.

## 1. Project overview

Audita is a self-contained Electron desktop application for visualizing
personal music statistics from a MediaMonkey XML export. It is intentionally
read-only: the source export is parsed at startup and is never modified.

| Aspect | Value |
|--------|-------|
| Electron entry point | `main.js` |
| Flask entry point | `app.py` |
| Preload bridge | `preload.js` |
| Packaged backend | `build/backend/audita-backend.exe` |
| Version | `APP_VERSION` in `app.py` and `version` in `package.json` |
| Source export | `data/mm_stats.xml` |
| Python | 3.11+ |
| Node.js | 18+ |
| Python dependencies | Flask, PyInstaller |
| Preferred Flask port | `48735`, with a dynamic fallback |
| Development start | `npm start` |
| Windows launchers | `run-audita.bat` or `Audita.vbs` |
| Portable build | `npm.cmd run build` |

Use the project virtual environment when available rather than assuming that
the system Python contains Flask or PyInstaller.

## 2. Architecture

### 2.1 Electron shell

`main.js` is the Electron main process. It:

1. Finds a free loopback TCP port, preferring `48735`
2. Starts `app.py` in development or `audita-backend.exe` when packaged
3. Polls until Flask accepts connections
4. Shows the splash window while the backend starts
5. Opens a frameless `BrowserWindow` at the local Flask URL
6. Handles minimize, maximize, restore, and quit controls
7. Opens non-local links in the system browser

`preload.js` must remain a narrow, sandbox-safe `contextBridge`. Do not enable
`nodeIntegration` or expose filesystem, process, or arbitrary IPC APIs to the
renderer.

### 2.2 Read-only Flask backend

All backend behavior currently lives in `app.py`. `MusicStats` parses the
MediaMonkey XML once at startup and stores normalized in-memory aggregates for
artists, albums, tracks, genres, and catalog years.

The backend must remain read-only:

- Do not add write routes for the XML or generated statistics
- Do not introduce a database for data that already exists in the export
- Surface missing files, malformed XML, and invalid API parameters explicitly
- Preserve the `AUDITA_STATS_FILE` override for backend-only checks
- Preserve PyInstaller `_MEIPASS` resource resolution

### 2.3 Packaging

`scripts/build_backend.py` freezes `app.py` with PyInstaller and bundles
`static/` and `data/` into the executable. `electron-builder` then includes
the backend executable and the static/data resources as extra resources.

When changing `app.py`, `static/`, `data/`, `main.js`, `preload.js`, or the
packaging configuration, run the backend build and the full Electron build.

## 3. Statistics rules

These rules are part of Audita's data contract:

- `Length.value` is interpreted as milliseconds
- Track listening time is `length_ms × PlayCounter`
- Artist totals aggregate credited `Artist` labels exactly as exported
- Album totals use the MediaMonkey album ID when present
- Genres are split on semicolons and counted once per track
- The XML `Date` field is a track-level catalog date, not a per-play timestamp
- Timeline labels must not claim to represent listening activity over time
- Sorting by plays and sorting by `listening_ms` must remain independently
  available for every relevant collection view

Do not silently split artist names, infer play timestamps, or replace missing
values with success-shaped statistics.

## 4. API surface

| Route | Purpose |
|-------|---------|
| `/` | Serve the renderer |
| `/api/status` | Report source loading status and metadata |
| `/api/dashboard` | Summary cards, ranked lists, timeline data, and metadata |
| `/api/artists` | Paginated, searchable artist aggregates |
| `/api/albums` | Paginated, searchable album aggregates |
| `/api/tracks` | Paginated, searchable and filterable track rows |
| `/api/genres` | Paginated genre aggregates |
| `/api/years` | Catalog-date year aggregates |

List routes accept `q`, `sort`, `order`, `page`, and `page_size`. Track queries
also accept exact `artist`, `album`, and `genre` filters. Keep pagination and
sort validation in the backend rather than relying only on the renderer.

## 5. Frontend conventions

- Use the existing vanilla JavaScript renderer in `static/app.js`
- Keep user-facing text in English unless a localization system is added
- Use event delegation and `data-view`/`data-*` hooks instead of inline scripts
- Escape values before inserting API data into HTML
- Keep the UI responsive for narrow Electron windows
- Preserve both light and dark themes
- Keep tables sortable by both plays and total listening time
- Keep the read-only and catalog-date caveats visible in relevant views
- Avoid adding a framework, bundler, CDN dependency, or chart package when
  the current static implementation is sufficient

CSS custom properties and layout components belong in `static/style.css`.
Branding assets belong in `static/logo.svg` and the static resource directory.

## 6. Verification

Run the smallest applicable checks first:

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --check static\app.js
node --check main.js
node --check preload.js
python -m py_compile app.py scripts\build_backend.py
```

For API changes, use Flask's test client and cover successful responses,
sorting, filtering, pagination, and malformed query parameters. For renderer
changes, start the app with `npm start`, open every affected view, verify the
DevTools console, and check that loading and error states are visible.

For Electron or packaging changes, run:

```powershell
npm.cmd run build:backend
npm.cmd run build
```

Do not claim that a GUI or packaging change is verified from syntax checks
alone. If the renderer is blank, verify the backend process, local URL,
renderer load event, and Electron logs before changing UI code.

## 7. File conventions

| Path | Purpose |
|------|---------|
| `main.js` | Electron main process and backend lifecycle |
| `preload.js` | Sandboxed window-control bridge |
| `package.json` | Node manifest and electron-builder configuration |
| `app.py` | XML parser, aggregates, routes, and startup |
| `requirements.txt` | Python runtime/build dependencies |
| `scripts/build_backend.py` | PyInstaller backend build helper |
| `Audita.vbs` | Silent Windows launcher using `npm start` |
| `run-audita.bat` | Windows launcher that invokes the VBS file |
| `static/index.html` | Renderer shell |
| `static/app.js` | Views, tables, sorting, filtering, and charts |
| `static/style.css` | Layout, components, themes, and responsiveness |
| `static/splash.html` | Electron loading screen |
| `static/logo.svg` | Audita branding asset |
| `data/mm_stats.xml` | MediaMonkey source export |
| `tests/test_app.py` | Parser and API-adjacent unit tests |
| `README.md` | Project setup, usage, and packaging documentation |

Do not track `build/`, `dist/`, `node_modules/`, `.venv/`, Python caches, or
other generated artifacts. Treat `data/mm_stats.xml` as personal source data:
do not rewrite, normalize, or replace it without an explicit request.

## 8. Git workflow and commit messages

Do not create or amend a commit unless the user explicitly asks for it. Keep
unrelated worktree changes intact and stage only intentional repository files.
Never stage generated artifacts or caches.

When the user requests a commit message, provide one conventional message
covering all intentional changes that are currently uncommitted.

Use this format:

```text
type(scope): lowercase imperative summary

* bullet describing a specific change
* another bullet
```

Use `feat`, `fix`, `refactor`, `docs`, `test`, or `chore`. Keep the subject
imperative, lowercase after the colon, and free of a trailing period. Use
backticks for routes, files, functions, and constants.
