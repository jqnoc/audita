# Audita

Audita is a private, read-only music statistics visualizer for a MediaMonkey
XML export. It follows the same local Electron + Flask architecture as
Librarium, Spectata, and Ludarium, while keeping the MediaMonkey file as the
only source of truth.

## What it shows

- Dashboard totals for tracks, artists, albums, recorded plays, and calculated
  listening time
- Top artists, albums, tracks, and genres ranked by plays or total time
- Searchable and sortable catalog tables with pagination
- Artist and album shortcuts that filter the track list
- Genre aggregation from MediaMonkey's semicolon-separated genre field
- A catalog-date timeline and a transparent data/methodology page

Listening time is calculated as:

```text
track length in milliseconds × MediaMonkey PlayCounter
```

The export contains one `Date` value per track, not a timestamp for every
listening event. Audita therefore labels its timeline as catalog context and
does not present it as a false listening-history chart.

## Development

Requirements:

- Node.js 18+
- Python 3.11+

Install the JavaScript and Python dependencies:

```powershell
npm install
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start the desktop app:

```powershell
npm start
```

On Windows, `run-audita.bat` starts the same application through
`Audita.vbs`, which launches Electron without showing a console window.

The Electron shell starts `app.py` on a loopback-only port and waits for the
local Flask API before opening the renderer. For backend-only checks:

```powershell
.venv\Scripts\python.exe app.py
```

The bundled source file is `data/mm_stats.xml`. Set `AUDITA_STATS_FILE` to
point at another export when running the backend directly:

```powershell
$env:AUDITA_STATS_FILE = "D:\path\to\another-export.xml"
.venv\Scripts\python.exe app.py
```

## Project layout

- `main.js`: Electron main process and Flask lifecycle
- `preload.js`: sandboxed renderer bridge for window controls
- `app.py`: XML parser, aggregate calculations, and JSON API
- `Audita.vbs`: silent Windows launcher
- `run-audita.bat`: Windows launcher for the VBS file
- `static/index.html`: renderer shell
- `static/app.js`: views, tables, sorting, filtering, and charts
- `static/style.css`: responsive light/dark UI
- `scripts/build_backend.py`: PyInstaller backend build helper
- `data/mm_stats.xml`: the current MediaMonkey export

## Testing and packaging

Run the focused backend tests with:

```powershell
npm run test:backend
```

Build a Windows portable package with:

```powershell
npm run build
```

The packaging step freezes the Flask backend and includes the static UI and
MediaMonkey data as Electron resources. Audita does not need a database and
does not make edits to the source XML.
