(function () {
    "use strict";

    var state = {
        view: "dashboard",
        dashboardMetric: "plays",
        renderToken: 0,
        sourceMetadata: null,
        searchTimer: null,
        tables: {
            artists: { q: "", sort: "plays", order: "desc", page: 1, pageSize: 25 },
            albums: { q: "", sort: "plays", order: "desc", page: 1, pageSize: 25 },
            tracks: { q: "", sort: "plays", order: "desc", page: 1, pageSize: 25, artist: "", album: "", genre: "" },
            genres: { q: "", sort: "plays", order: "desc", page: 1, pageSize: 25 }
        }
    };

    var tableConfig = {
        artists: {
            title: "Artists",
            eyebrow: "People behind the sound",
            description: "Every credited artist, ranked by the way you listen.",
            endpoint: "/api/artists",
            sorts: [
                ["plays", "Plays"], ["listening_ms", "Listening time"], ["name", "Name"],
                ["tracks", "Tracks"], ["albums", "Albums"]
            ],
            columns: [
                { key: "name", label: "Artist", className: "primary-column" },
                { key: "tracks", label: "Tracks", numeric: true },
                { key: "albums", label: "Albums", numeric: true },
                { key: "plays", label: "Plays", numeric: true, format: formatNumber },
                { key: "listening_ms", label: "Listening time", numeric: true, format: formatDuration }
            ]
        },
        albums: {
            title: "Albums",
            eyebrow: "Full records and soundtracks",
            description: "Albums with play counts and the time they have earned.",
            endpoint: "/api/albums",
            sorts: [
                ["plays", "Plays"], ["listening_ms", "Listening time"], ["name", "Title"],
                ["artist", "Artist"], ["year", "Year"], ["tracks", "Tracks"]
            ],
            columns: [
                { key: "name", label: "Album", className: "primary-column" },
                { key: "artist", label: "Artist" },
                { key: "year", label: "Year", numeric: true, format: formatYear },
                { key: "tracks", label: "Tracks", numeric: true },
                { key: "plays", label: "Plays", numeric: true, format: formatNumber },
                { key: "listening_ms", label: "Listening time", numeric: true, format: formatDuration }
            ]
        },
        tracks: {
            title: "Tracks",
            eyebrow: "The individual songs",
            description: "Sort the complete track list by plays, duration, or total listening time.",
            endpoint: "/api/tracks",
            sorts: [
                ["plays", "Plays"], ["listening_ms", "Listening time"], ["title", "Title"],
                ["artist", "Artist"], ["album", "Album"], ["length_ms", "Track length"], ["date", "Date"]
            ],
            columns: [
                { key: "title", label: "Track", className: "primary-column" },
                { key: "artist", label: "Artist" },
                { key: "album", label: "Album" },
                { key: "length_ms", label: "Length", numeric: true, format: formatTrackLength },
                { key: "plays", label: "Plays", numeric: true, format: formatNumber },
                { key: "listening_ms", label: "Total time", numeric: true, format: formatDuration }
            ]
        },
        genres: {
            title: "Genres",
            eyebrow: "The shape of your taste",
            description: "MediaMonkey genres are split into individual labels for comparison.",
            endpoint: "/api/genres",
            sorts: [
                ["plays", "Plays"], ["listening_ms", "Listening time"], ["name", "Name"],
                ["tracks", "Tracks"]
            ],
            columns: [
                { key: "name", label: "Genre", className: "primary-column" },
                { key: "tracks", label: "Tracks", numeric: true },
                { key: "plays", label: "Plays", numeric: true, format: formatNumber },
                { key: "listening_ms", label: "Listening time", numeric: true, format: formatDuration }
            ]
        }
    };

    function $(selector) {
        return document.querySelector(selector);
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("en-US").format(Number(value) || 0);
    }

    function formatYear(value) {
        return value ? String(value) : "—";
    }

    function formatTrackLength(milliseconds) {
        var totalSeconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        if (hours) return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
        return minutes + ":" + String(seconds).padStart(2, "0");
    }

    function formatDuration(milliseconds) {
        var totalMinutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
        var days = Math.floor(totalMinutes / 1440);
        var hours = Math.floor((totalMinutes % 1440) / 60);
        var minutes = totalMinutes % 60;
        if (days) return days + "d " + hours + "h";
        if (hours) return hours + "h " + minutes + "m";
        return minutes + "m";
    }

    function formatDate(value) {
        if (!value) return "—";
        var date = new Date(value + "T00:00:00");
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(date);
    }

    function formatMetric(value, metric) {
        return metric === "listening_ms" ? formatDuration(value) : formatNumber(value);
    }

    function api(path) {
        return fetch(path, { headers: { Accept: "application/json" } }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
                if (!response.ok) {
                    var message = payload.details || payload.error || "The local API returned an error.";
                    throw new Error(message);
                }
                return payload;
            });
        });
    }

    function setTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("audita_theme", theme);
        var button = $(".theme-button");
        if (button) {
            button.textContent = theme === "dark" ? "☼" : "☾";
            button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
        }
    }

    function setView(view, filters) {
        if (view !== "dashboard" && view !== "timeline" && view !== "source" && !tableConfig[view]) {
            view = "dashboard";
        }
        state.view = view;
        if (tableConfig[view] && filters) {
            if (filters.artist !== undefined) state.tables[view].artist = filters.artist;
            if (filters.album !== undefined) state.tables[view].album = filters.album;
            if (filters.genre !== undefined) state.tables[view].genre = filters.genre;
            state.tables[view].page = 1;
        }
        document.querySelectorAll("[data-view]").forEach(function (element) {
            element.classList.toggle("active", element.dataset.view === view);
        });
        render();
    }

    function setLoading() {
        $("#main-content").innerHTML = '<div class="loading-state"><span class="loading-spinner"></span><span>Loading view…</span></div>';
    }

    function render() {
        var token = ++state.renderToken;
        setLoading();
        var promise;
        if (state.view === "dashboard" || state.view === "timeline") promise = api("/api/dashboard");
        else if (state.view === "source") promise = api("/api/status");
        else promise = renderTableData(state.view);
        promise.then(function (payload) {
            if (token !== state.renderToken) return;
            if (state.view === "dashboard") $("#main-content").innerHTML = renderDashboard(payload);
            else if (state.view === "timeline") $("#main-content").innerHTML = renderTimeline(payload);
            else if (state.view === "source") $("#main-content").innerHTML = renderSource(payload);
            else $("#main-content").innerHTML = payload;
            bindViewControls();
        }).catch(function (error) {
            if (token !== state.renderToken) return;
            $("#main-content").innerHTML = renderError(error);
        });
    }

    function renderError(error) {
        return '<section class="error-state"><div class="error-symbol">!</div><h1>Could not load this view</h1><p>' +
            escapeHtml(error.message) + '</p><button class="button button-primary" type="button" data-action="retry">Try again</button></section>';
    }

    function renderPageHeading(eyebrow, title, description, action) {
        return '<div class="page-heading"><div><span class="eyebrow">' + escapeHtml(eyebrow) +
            '</span><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(description) +
            '</p></div>' + (action || "") + '</div>';
    }

    function renderDashboard(data) {
        state.sourceMetadata = data.metadata;
        updateSourceLabel(data.metadata);
        var summary = data.summary;
        var metric = state.dashboardMetric;
        var artistRows = metric === "listening_ms" ? data.top_artists_by_time : data.top_artists;
        var albumRows = metric === "listening_ms" ? data.top_albums_by_time : data.top_albums;
        var trackRows = metric === "listening_ms" ? data.top_tracks_by_time : data.top_tracks;
        var genreRows = metric === "listening_ms" ? data.top_genres_by_time : data.top_genres;
        var toggle = '<div class="segmented-control"><button type="button" class="' + (metric === "plays" ? "selected" : "") +
            '" data-metric="plays">Plays</button><button type="button" class="' + (metric === "listening_ms" ? "selected" : "") +
            '" data-metric="listening_ms">Listening time</button></div>';

        return renderPageHeading("Your personal listening archive", "Dashboard", "A quiet overview of what keeps finding its way back into your ears.", toggle) +
            '<section class="stat-grid">' +
            statCard("Total listening", formatDuration(summary.listening_ms), "calculated from track length × plays", "accent") +
            statCard("Recorded plays", formatNumber(summary.plays), "across your library") +
            statCard("Tracks", formatNumber(summary.tracks), formatNumber(summary.played_tracks) + " with at least one play") +
            statCard("Artists", formatNumber(summary.artists), formatNumber(summary.albums) + " albums") +
            '</section>' +
            '<section class="dashboard-grid">' +
            renderRankCard("Top artists", artistRows, "artist", metric) +
            renderRankCard("Top albums", albumRows, "album", metric) +
            renderRankCard("Top tracks", trackRows, "track", metric) +
            renderRankCard("Genres in rotation", genreRows, "genre", metric) +
            '</section>' +
            '<section class="dashboard-lower">' +
            renderYearPreview(data.years) +
            renderLatestTracks(data.latest_tracks) +
            '</section>';
    }

    function statCard(label, value, note, extraClass) {
        return '<article class="stat-card ' + (extraClass || "") + '"><span class="stat-label">' + escapeHtml(label) +
            '</span><strong>' + escapeHtml(value) + '</strong><span class="stat-note">' + escapeHtml(note) + '</span></article>';
    }

    function renderRankCard(title, rows, type, metric) {
        var maxValue = rows.length ? Math.max.apply(null, rows.map(function (row) { return row[metric] || 0; })) : 0;
        var items = rows.map(function (row, index) {
            var label = row.name || row.title;
            var secondary = type === "track" ? row.artist : type === "album" ? row.artist : "";
            var filter = type === "artist" ? ' data-view="tracks" data-filter-artist="' + escapeHtml(row.name) + '"' :
                type === "album" ? ' data-view="tracks" data-filter-album="' + escapeHtml(row.title) + '"' : "";
            var width = maxValue ? Math.max(4, Math.round((row[metric] / maxValue) * 100)) : 0;
            return '<a class="rank-row" href="#"' + filter + '><span class="rank-number">' + String(index + 1).padStart(2, "0") +
                '</span><span class="rank-copy"><strong>' + escapeHtml(label) + '</strong>' +
                (secondary ? '<small>' + escapeHtml(secondary) + '</small>' : "") +
                '<span class="rank-bar"><i style="width:' + width + '%"></i></span></span><span class="rank-value">' +
                escapeHtml(formatMetric(row[metric], metric)) + '</span></a>';
        }).join("");
        return '<article class="panel rank-panel"><div class="panel-heading"><h2>' + escapeHtml(title) +
            '</h2><span class="panel-kicker">' + (metric === "plays" ? "plays" : "time") + '</span></div>' +
            (items || '<p class="empty-copy">No data available.</p>') + '</article>';
    }

    function renderYearPreview(years) {
        var rows = years.slice(-8);
        var max = rows.length ? Math.max.apply(null, rows.map(function (row) { return row.plays; })) : 1;
        var bars = rows.map(function (row) {
            return '<div class="mini-bar-row"><span>' + row.year + '</span><i><b style="width:' +
                Math.max(3, Math.round(row.plays / max * 100)) + '%"></b></i><strong>' + formatNumber(row.plays) + '</strong></div>';
        }).join("");
        return '<article class="panel year-preview"><div class="panel-heading"><div><h2>Catalog by year</h2>' +
            '<p>Track dates in the export, not individual listening timestamps.</p></div><button class="text-button" type="button" data-view="timeline">View timeline →</button></div>' +
            '<div class="mini-bars">' + (bars || '<p class="empty-copy">No dates found.</p>') + '</div></article>';
    }

    function renderLatestTracks(rows) {
        var items = rows.map(function (row) {
            return '<div class="latest-row"><span class="latest-date">' + escapeHtml(formatDate(row.date)) +
                '</span><div><strong>' + escapeHtml(row.title) + '</strong><small>' + escapeHtml(row.artist + " · " + row.album) +
                '</small></div><span class="latest-plays">' + formatNumber(row.plays) + ' plays</span></div>';
        }).join("");
        return '<article class="panel latest-panel"><div class="panel-heading"><div><h2>Latest catalog dates</h2>' +
            '<p>Useful context from MediaMonkey’s track-level Date field.</p></div></div>' +
            (items || '<p class="empty-copy">No dated tracks found.</p>') + '</article>';
    }

    function renderTimeline(data) {
        var years = data.years || [];
        var maxPlays = years.length ? Math.max.apply(null, years.map(function (row) { return row.plays; })) : 1;
        var maxTime = years.length ? Math.max.apply(null, years.map(function (row) { return row.listening_ms; })) : 1;
        var rows = years.map(function (row) {
            return '<div class="timeline-row"><div class="timeline-label"><strong>' + row.year + '</strong><span>' +
                formatNumber(row.tracks) + ' tracks · ' + formatNumber(row.albums) + ' albums</span></div>' +
                '<div class="timeline-metric"><span>Plays</span><i><b style="width:' + Math.max(1, Math.round(row.plays / maxPlays * 100)) + '%"></b></i><strong>' +
                formatNumber(row.plays) + '</strong></div><div class="timeline-metric time"><span>Time</span><i><b style="width:' +
                Math.max(1, Math.round(row.listening_ms / maxTime * 100)) + '%"></b></i><strong>' + formatDuration(row.listening_ms) + '</strong></div></div>';
        }).join("");
        return renderPageHeading("Context, not a listening diary", "Catalog timeline", "The XML provides one Date per track. This view shows how the dated catalog is distributed, without pretending those are play timestamps.", "") +
            '<section class="panel timeline-panel"><div class="timeline-head"><span>Year</span><span>Plays</span><span>Listening time</span></div>' +
            (rows || '<p class="empty-copy">No dated tracks found.</p>') + '</section>';
    }

    function renderSource(data) {
        var metadata = data.metadata || state.sourceMetadata || {};
        updateSourceLabel(metadata);
        return renderPageHeading("Methodology", "About this data", "A transparent read-only view of the file Audita is visualizing.", "") +
            '<section class="source-grid"><article class="panel source-card"><span class="source-card-icon">◈</span><h2>' +
            escapeHtml(metadata.source_name || "MediaMonkey XML") + '</h2><p>Loaded once when the local backend starts. Audita does not write to or modify this file.</p>' +
            '<dl class="definition-list"><div><dt>Source</dt><dd>MediaMonkey XML export</dd></div><div><dt>Loaded</dt><dd>' +
            escapeHtml(metadata.loaded_at ? new Date(metadata.loaded_at).toLocaleString() : "Unknown") + '</dd></div><div><dt>Audita version</dt><dd>' +
            escapeHtml(metadata.app_version || "—") + '</dd></div></dl></article>' +
            '<article class="panel source-card"><span class="source-card-icon">∑</span><h2>How totals work</h2><p>' +
            escapeHtml(metadata.calculation || "Listening time is calculated from track length and plays.") + '</p><div class="formula">track length <b>×</b> PlayCounter <b>=</b> total listening time</div>' +
            '<p class="muted-copy">Genres are split on semicolons and counted once per track. Artists and albums retain the exact labels present in the export.</p></article>' +
            '<article class="panel source-card source-card-wide"><span class="source-card-icon">⌁</span><h2>What the file cannot tell us</h2><p>' +
            escapeHtml(metadata.date_note || "The XML does not contain a timestamp for each play.") + '</p><div class="notice"><strong>No fake precision.</strong> Audita shows catalog-date context separately from listening totals so the distinction stays visible.</div></article></section>';
    }

    function renderTableData(view) {
        var config = tableConfig[view];
        var tableState = state.tables[view];
        var params = new URLSearchParams({
            q: tableState.q,
            sort: tableState.sort,
            order: tableState.order,
            page: tableState.page,
            page_size: tableState.pageSize
        });
        if (tableState.artist) params.set("artist", tableState.artist);
        if (tableState.album) params.set("album", tableState.album);
        if (tableState.genre) params.set("genre", tableState.genre);
        return api(config.endpoint + "?" + params.toString()).then(function (data) {
            return renderTable(view, data);
        });
    }

    function renderTable(view, data) {
        var config = tableConfig[view];
        var tableState = state.tables[view];
        var activeFilter = tableState.artist || tableState.album || tableState.genre;
        var filterMarkup = activeFilter ? '<span class="filter-chip">Filtered to <strong>' + escapeHtml(activeFilter) +
            '</strong><button type="button" data-clear-filter="' + view + '" aria-label="Clear filter">×</button></span>' : "";
        var sortOptions = config.sorts.map(function (option) {
            return '<option value="' + option[0] + '"' + (tableState.sort === option[0] ? " selected" : "") + '>' + option[1] + '</option>';
        }).join("");
        var headers = config.columns.map(function (column) {
            var isSelected = tableState.sort === column.key;
            return '<th class="' + (column.numeric ? "numeric" : "") + '"><button type="button" class="sort-header ' +
                (isSelected ? "selected" : "") + '" data-table-sort="' + view + '" data-sort="' + column.key + '">' +
                escapeHtml(column.label) + (isSelected ? '<span class="sort-arrow">' + (tableState.order === "desc" ? "↓" : "↑") + '</span>' : "") + '</button></th>';
        }).join("");
        var body = data.items.map(function (row) {
            return '<tr>' + config.columns.map(function (column) {
                var value = row[column.key];
                var content = column.format ? column.format(value) : (value || "—");
                if (view === "artists" && column.key === "name") {
                    content = '<button class="cell-link" type="button" data-view="tracks" data-filter-artist="' + escapeHtml(row.name) + '">' + escapeHtml(content) + '</button>';
                } else if (view === "albums" && column.key === "name") {
                    content = '<button class="cell-link" type="button" data-view="tracks" data-filter-album="' + escapeHtml(row.title) + '">' + escapeHtml(content) + '</button>';
                } else {
                    content = escapeHtml(content);
                }
                return '<td class="' + (column.numeric ? "numeric" : "") + '">' + content + '</td>';
            }).join("") + '</tr>';
        }).join("");
        var pagination = renderPagination(data, view);
        return renderPageHeading(config.eyebrow, config.title, config.description, "") +
            '<section class="table-panel panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" data-table-search="' +
            view + '" value="' + escapeHtml(tableState.q) + '" placeholder="Search ' + config.title.toLowerCase() + '" aria-label="Search ' + config.title.toLowerCase() + '"></label>' +
            '<div class="toolbar-spacer"></div><label class="select-field"><span>Sort by</span><select data-table-select="' + view + '">' + sortOptions +
            '</select></label><button class="sort-order-button" type="button" data-table-order="' + view + '" aria-label="Toggle sort direction">' +
            (tableState.order === "desc" ? "↓" : "↑") + '</button><label class="select-field compact-select"><span>Rows</span><select data-page-size="' + view +
            '"><option' + (tableState.pageSize === 25 ? " selected" : "") + '>25</option><option' + (tableState.pageSize === 50 ? " selected" : "") + '>50</option><option' +
            (tableState.pageSize === 100 ? " selected" : "") + '>100</option></select></label></div>' + (filterMarkup ? '<div class="filter-row">' + filterMarkup + '</div>' : "") +
            '<div class="table-meta"><span>' + formatNumber(data.total) + ' results</span><span>Sorted by ' + escapeHtml(config.sorts.find(function (option) { return option[0] === tableState.sort; })[1].toLowerCase()) +
            ' · ' + (tableState.order === "desc" ? "highest first" : "lowest first") + '</span></div><div class="table-scroll"><table><thead><tr>' + headers +
            '</tr></thead><tbody>' + (body || '<tr><td colspan="' + config.columns.length + '"><div class="empty-state compact"><strong>No matches</strong><span>Try a different search or clear the filter.</span></div></td></tr>') +
            '</tbody></table></div>' + pagination + '</section>';
    }

    function renderPagination(data, view) {
        var previousDisabled = data.page <= 1 ? " disabled" : "";
        var nextDisabled = data.page >= data.pages ? " disabled" : "";
        return '<div class="pagination"><span>Page ' + formatNumber(data.page) + ' of ' + formatNumber(data.pages) + '</span><div>' +
            '<button type="button" class="pagination-button" data-page="' + view + '" data-page-value="' + (data.page - 1) + '"' + previousDisabled + '>← Previous</button>' +
            '<button type="button" class="pagination-button" data-page="' + view + '" data-page-value="' + (data.page + 1) + '"' + nextDisabled + '>Next →</button></div></div>';
    }

    function updateSourceLabel(metadata) {
        var label = $("#source-name");
        if (label && metadata) label.textContent = metadata.source_name || "MediaMonkey XML";
    }

    function bindViewControls() {
        document.querySelectorAll("[data-metric]").forEach(function (button) {
            button.addEventListener("click", function () {
                state.dashboardMetric = button.dataset.metric;
                render();
            });
        });
        document.querySelectorAll("[data-table-search]").forEach(function (input) {
            input.addEventListener("input", function () {
                var view = input.dataset.tableSearch;
                state.tables[view].q = input.value;
                state.tables[view].page = 1;
                window.clearTimeout(state.searchTimer);
                state.searchTimer = window.setTimeout(render, 220);
            });
        });
        document.querySelectorAll("[data-table-select]").forEach(function (select) {
            select.addEventListener("change", function () {
                state.tables[select.dataset.tableSelect].sort = select.value;
                state.tables[select.dataset.tableSelect].page = 1;
                render();
            });
        });
        document.querySelectorAll("[data-page-size]").forEach(function (select) {
            select.addEventListener("change", function () {
                var view = select.dataset.pageSize;
                state.tables[view].pageSize = Number(select.value);
                state.tables[view].page = 1;
                render();
            });
        });
    }

    document.addEventListener("click", function (event) {
        var viewElement = event.target.closest("[data-view]");
        if (viewElement) {
            event.preventDefault();
            var filters = {};
            if (viewElement.dataset.filterArtist !== undefined) filters.artist = viewElement.dataset.filterArtist;
            if (viewElement.dataset.filterAlbum !== undefined) filters.album = viewElement.dataset.filterAlbum;
            if (viewElement.dataset.filterGenre !== undefined) filters.genre = viewElement.dataset.filterGenre;
            setView(viewElement.dataset.view, filters);
            return;
        }
        var sortElement = event.target.closest("[data-table-sort]");
        if (sortElement) {
            var sortView = sortElement.dataset.tableSort;
            var tableState = state.tables[sortView];
            if (tableState.sort === sortElement.dataset.sort) tableState.order = tableState.order === "desc" ? "asc" : "desc";
            else {
                tableState.sort = sortElement.dataset.sort;
                tableState.order = "desc";
            }
            tableState.page = 1;
            render();
            return;
        }
        var orderElement = event.target.closest("[data-table-order]");
        if (orderElement) {
            var orderState = state.tables[orderElement.dataset.tableOrder];
            orderState.order = orderState.order === "desc" ? "asc" : "desc";
            render();
            return;
        }
        var pageElement = event.target.closest("[data-page]");
        if (pageElement && !pageElement.disabled) {
            state.tables[pageElement.dataset.page].page = Number(pageElement.dataset.pageValue);
            render();
            return;
        }
        var clearElement = event.target.closest("[data-clear-filter]");
        if (clearElement) {
            var clearState = state.tables[clearElement.dataset.clearFilter];
            clearState.artist = "";
            clearState.album = "";
            clearState.genre = "";
            clearState.page = 1;
            render();
            return;
        }
        var action = event.target.closest("[data-action]");
        if (!action) return;
        if (action.dataset.action === "theme") {
            setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
        } else if (action.dataset.action === "retry") {
            render();
        } else if (action.dataset.action === "minimize" && window.audita) {
            window.audita.minimize();
        } else if (action.dataset.action === "maximize" && window.audita) {
            window.audita.toggleMaximize();
        } else if (action.dataset.action === "quit" && window.audita) {
            window.audita.quit();
        }
    });

    function updateWindowButton(stateValue) {
        var button = document.querySelector('[data-action="maximize"]');
        if (button) button.textContent = stateValue && stateValue.isMaximized ? "❐" : "□";
    }

    var savedTheme = localStorage.getItem("audita_theme");
    setTheme(savedTheme === "light" ? "light" : "dark");
    if (window.audita && window.audita.getWindowState) {
        window.audita.getWindowState().then(updateWindowButton);
        window.audita.onWindowStateChanged(updateWindowButton);
    }
    render();
}());
