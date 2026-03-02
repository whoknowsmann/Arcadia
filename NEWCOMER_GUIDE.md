# Arcadia Newcomer Guide

## Quick mental model

Arcadia is a **local web app** for organizing and launching ROMs and native ports.

- `server.js` is the backend (Express + SQLite + launcher logic).
- `public/` is the frontend (single-page vanilla JS UI).
- `scraper.js` is metadata enrichment (IGDB/Twitch auth + scraping + media download).
- `scripts/` are optional bulk-ROM helper scripts (download and pruning utilities).

The app is intentionally local-first: scan folders, store state in `arcadia.db`, and launch configured executables directly.

## How data flows

1. User clicks **Scan** in the UI.
2. Frontend calls `POST /api/scan` and listens on `GET /api/scan/progress` (SSE) for progress updates.
3. Backend scans configured ROM directories, inserts unseen titles into SQLite, sets/updates cover art, then optionally scrapes IGDB metadata.
4. Frontend refreshes library/stats/filters as scan phases complete.

## Key subsystems

### 1) Backend + database (`server.js`)

- Creates and migrates the `games`, `config`, `collections`, and `collection_games` tables.
- Stores runtime configuration inside the database (`config` table), seeded from `DEFAULT_CONFIG`.
- Handles platform-specific scanning behavior:
  - extension-based scanning for most systems,
  - Xbox folder-style game detection,
  - PS4 package and extracted-folder detection.
- Launches games via configured emulator command templates (`{rom}` token replacement).
- Tracks play count, last played time, and attempts total playtime tracking from child process exit.

### 2) Frontend SPA (`public/index.html`, `public/app.js`, `public/style.css`)

- Sidebar + searchable/sortable game grid.
- Detail modal for metadata and actions (play, favorite, re-scrape).
- Settings modal to edit emulators, ROM directories, and PC ports.
- Progress UI for scan/art/metadata phases via SSE events.

### 3) Metadata scraper (`scraper.js`)

- Uses `igdb-credentials.json` for Twitch OAuth client credentials.
- Caches access token in the credentials file.
- Searches IGDB, picks best match heuristically, normalizes metadata fields, downloads cover/screenshot assets.

### 4) Gamepad support (`public/gamepad.js`)

- Implements Xbox-style navigation with focus handling, repeats, and contextual hints.
- Supports grid/sidebar/modal control modes, plus shortcuts for favorite, settings, and launch.

## Good first tasks for new contributors

- Read `server.js` route-by-route to understand the API contract first.
- Then read `public/app.js` from top-to-bottom to map each UI action to API calls.
- Explore the scan pipeline (`/api/scan` + `scrapeCovers()` + `scrapeMetadata()`) as the main orchestration path.
- Run a local scan with a tiny ROM directory and inspect `arcadia.db` contents to cement the mental model.

## Known gaps / roadmap hints

From `requirements.md`, notable next opportunities include:

- file-removal re-scan pruning,
- additional console support,
- per-game emulator overrides,
- import/export and bulk actions.

