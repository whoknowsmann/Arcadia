# Arcadia — Requirements

## Core Requirements

### Library Management
- [x] Scan configurable ROM directories and index games into a local database
- [x] Parse ROM filenames to extract title, region, and format
- [x] Support multiple systems with distinct file extensions
- [x] Deduplicate on file path (no double-indexing)
- [x] Display game counts per system

### Game Launching
- [x] Launch games through configured emulators with correct arguments
- [x] Support native PC ports (direct .exe launch)
- [x] WSL-to-Windows path translation for emulator and ROM paths
- [x] Detached process spawning (launcher doesn't block on emulator)

### Play Tracking
- [x] Track play count per game
- [x] Track last played timestamp
- [x] Track total play time (when emulator exits as child process)

### UI
- [x] Web-based frontend (localhost:3333)
- [x] Sidebar navigation with system filters
- [x] Game grid view
- [x] Search with debounced input
- [x] Sort by name, recently played, most played
- [x] Favorites filter
- [x] Game detail modal with metadata and stats
- [x] Keyboard shortcuts (`/` for search, `Esc` to close modal)
- [x] Dark theme

### Configuration
- [x] Emulator paths and arguments per system
- [x] ROM directory paths per system
- [x] PC port definitions
- [x] Config stored in database, editable via API

## Planned / TODO

### High Priority
- [x] Cover art / box art (scrape or local image matching)
- [x] Settings UI (emulators, ROM directories, PC ports)
- [ ] Re-scan detection (remove games whose files no longer exist)
- [ ] mGBA emulator path configuration

### Medium Priority
- [ ] Additional systems (PS1, PS2, Wii, DS, SNES, NES, etc.)
- [ ] Per-game emulator override
- [x] Custom collections (user-created game lists)
- [ ] Grid vs list view toggle
- [ ] Bulk actions (favorite multiple, delete from library)
- [ ] Import/export library data

### Low Priority / Nice to Have
- [x] Gamepad navigation in the UI (Xbox Series X controller)
- [ ] Auto-scan on startup or file watch
- [ ] ROM file integrity checks (hash verification)
- [ ] Multi-disc game grouping
- [ ] Achievement tracking integration
- [ ] Theme customization
- [ ] Portable mode (relative paths, carry on USB drive)

### Recently Completed
- [x] **IGDB metadata scraping** — description, genre, developer, publisher, release date, rating, players, screenshots
- [x] **Genre filtering** — filter game library by genre
- [x] **Extended sort options** — rating, release date, genre, developer
- [x] **Re-scrape per game** — manually re-fetch metadata for individual games
- [x] **Custom collections** — create named game collections (backend API)
- [x] **Gamepad navigation** — full Xbox controller support with D-pad/stick navigation, button hints HUD
