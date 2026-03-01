# ◉ Arcadia

A local-first unified game launcher. One interface for your entire retro (and not-so-retro) library. No cloud accounts, no telemetry, no bullshit.

## What It Does

- Scans your ROM directories and indexes everything into a local SQLite database
- Launches games through their respective emulators with one click
- Tracks play count, last played, and total play time
- Favorites, search (with `/` hotkey), and filtering by system
- Supports native PC ports alongside emulated games

## Supported Systems

| System | Emulator | Formats |
|--------|----------|---------|
| Game Boy | mGBA | `.gb` |
| Game Boy Color | mGBA | `.gbc` |
| Game Boy Advance | mGBA | `.gba` |
| Nintendo 64 | simple64 | `.z64`, `.v64`, `.n64` |
| GameCube | Dolphin | `.rvz`, `.iso`, `.gcm`, `.zip` |
| Xbox | xemu | `.iso`, `.xiso`, folders |
| PlayStation 4 | shadPS4 | `.pkg`, folders with `eboot.bin` |
| PC Ports | Native | `.exe` |

## Screenshot

*TODO*

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Edit the emulator paths and ROM directories in `server.js` under `DEFAULT_CONFIG` (or update them later via the API at `/api/config`).

3. Start the server:

   ```
   npm start
   ```

4. Open `http://localhost:3333` in your browser.

5. Click **⟳ Scan** to index your ROM directories.

## Usage

- **Sidebar** — filter by system, favorites, or recently played
- **Search** — press `/` to focus the search bar
- **Click a game** — opens the detail modal with stats and a Play button
- **★ Favorite** — bookmark games for quick access
- **Sort** — by name, recently played, or most played
- **Esc** — close modals

## Project Structure

```
arcadia/
├── server.js          # Express backend + SQLite + emulator launching
├── package.json
├── arcadia.db         # Auto-created on first run
└── public/
    ├── index.html     # Single-page app shell
    ├── style.css      # Dark theme UI
    └── app.js         # Frontend logic (vanilla JS)
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/games?system=&search=&favorites=&sort=` | List games (filterable) |
| `GET` | `/api/stats` | Game counts per system |
| `POST` | `/api/scan` | Scan ROM directories and index new games |
| `POST` | `/api/games/:id/launch` | Launch a game |
| `POST` | `/api/games/:id/favorite` | Toggle favorite |
| `GET` | `/api/config` | Get configuration |
| `POST` | `/api/config` | Update configuration |

## Notes

- Runs via WSL, launches Windows emulators through path translation (`/mnt/g/...` ↔ `G:\...`)
- The database persists between runs — re-scanning skips already-indexed files
- Play time tracking works when the emulator process is a direct child (doesn't work if the emulator spawns a separate process and exits)
- Xbox games are detected as folders (xemu style)
