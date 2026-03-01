import express from 'express';
import Database from 'better-sqlite3';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import * as scraper from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/covers', express.static(path.join(__dirname, 'covers')));

// ---- Database Setup ----
const db = new Database(path.join(__dirname, 'arcadia.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    system TEXT NOT NULL,
    region TEXT,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER,
    file_format TEXT,
    favorite INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    last_played TEXT,
    total_time INTEGER DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    cover_path TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrations: add columns if they don't exist
const migrations = [
  'ALTER TABLE games ADD COLUMN cover_path TEXT',
  'ALTER TABLE games ADD COLUMN description TEXT',
  'ALTER TABLE games ADD COLUMN genre TEXT',
  'ALTER TABLE games ADD COLUMN developer TEXT',
  'ALTER TABLE games ADD COLUMN publisher TEXT',
  'ALTER TABLE games ADD COLUMN release_date TEXT',
  'ALTER TABLE games ADD COLUMN players TEXT',
  'ALTER TABLE games ADD COLUMN rating REAL',
  'ALTER TABLE games ADD COLUMN igdb_id INTEGER',
  'ALTER TABLE games ADD COLUMN screenshot_path TEXT',
  'ALTER TABLE games ADD COLUMN scraped INTEGER DEFAULT 0',
];

for (const migration of migrations) {
  try {
    db.exec(migration);
    console.log(`  Migration: ${migration.split('ADD COLUMN ')[1]?.split(' ')[0] || 'done'}`);
  } catch (e) {
    // Column already exists, ignore
  }
}

// Collections tables
db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_games (
    collection_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, game_id),
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );
`);

// ---- Config ----
const DEFAULT_CONFIG = {
  emulators: {
    gb: {
      name: "mGBA",
      path: "",
      args: '"{rom}"'
    },
    gbc: {
      name: "mGBA",
      path: "",
      args: '"{rom}"'
    },
    gba: {
      name: "mGBA",
      path: "",
      args: '"{rom}"'
    },
    n64: {
      name: "simple64",
      path: "C:\\Users\\hound\\Documents\\sixtyfour\\simple64-win64-b49e10e\\simple64\\simple64-gui.exe",
      args: '"{rom}"'
    },
    gcn: {
      name: "Dolphin",
      path: "C:\\Users\\hound\\Documents\\sixtyfour\\Dolphin\\Dolphin-x64\\Dolphin.exe",
      args: '-e "{rom}" -b'
    },
    xbox: {
      name: "xemu",
      path: "E:\\xbob\\xemu-0.8.133-windows-x86_64\\xemu.exe",
      args: '-dvd_path "{rom}"'
    },
    ps4: {
      name: "shadPS4",
      path: "E:\\BBLauncher\\Pre-release\\shadPS4.exe",
      args: '"{rom}"'
    }
  },
  rom_directories: [
    { path: "G:\\Myrient\\Nintendo - Game Boy", system: "gb" },
    { path: "G:\\Myrient\\Nintendo - Game Boy Color", system: "gbc" },
    { path: "G:\\Myrient\\Nintendo - Game Boy Advance", system: "gba" },
    { path: "G:\\Myrient\\Nintendo - GameCube", system: "gcn" },
    { path: "E:\\xbob\\xboxGames", system: "xbox" },
    { path: "C:\\Users\\hound\\Documents\\sixtyfour", system: "n64" },
    { path: "E:\\ShadsPS4\\Roms", system: "ps4" }
  ],
  ports: [
    {
      name: "The Legend of Zelda: Ocarina of Time",
      path: "C:\\Users\\hound\\Documents\\sixtyfour\\SoH\\soh.exe",
      system: "port",
      cover: "soh"
    },
    {
      name: "The Legend of Zelda: Majora's Mask",
      path: "C:\\Users\\hound\\Documents\\sixtyfour\\2Ship\\2ship.exe",
      system: "port",
      cover: "2ship"
    },
    {
      name: "Super Mario 64",
      path: "C:\\Users\\hound\\Documents\\sixtyfour\\SM64Plus\\Super Mario 64 Plus Portable\\sm64plus.exe",
      system: "port",
      cover: "sm64"
    },
    {
      name: "Bloodborne",
      path: "E:\\BB_Launcher.exe",
      system: "port",
      cover: "bloodborne"
    }
  ]
};

function getConfig() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('main');
  if (row) return JSON.parse(row.value);
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('main', JSON.stringify(DEFAULT_CONFIG));
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('main', JSON.stringify(config));
}

// ---- ROM Name Parser ----
function parseRomName(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  // Extract title (everything before first parenthesis)
  const titleMatch = base.match(/^(.+?)\s*\(/);
  const title = titleMatch ? titleMatch[1].trim() : base;

  // Extract region (first parenthetical)
  const tags = [...base.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  const region = tags[0] || 'Unknown';

  return { title, region, format: ext.replace('.', '') };
}

// ---- WSL path <-> Windows path ----
function toWindowsPath(wslPath) {
  // If already a Windows path, return as-is
  if (/^[A-Z]:\\/.test(wslPath)) return wslPath;
  // Convert /mnt/c/... to C:\...
  const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)/);
  if (match) {
    return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
  }
  return wslPath;
}

function toWslPath(winPath) {
  const match = winPath.match(/^([A-Z]):\\(.*)/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
  }
  return winPath;
}

// ---- ROM Scanner ----
const ROM_EXTENSIONS = {
  gb: ['.gb'],
  gbc: ['.gbc'],
  gba: ['.gba'],
  n64: ['.z64', '.v64', '.n64'],
  gcn: ['.rvz', '.iso', '.gcm', '.zip'],
  xbox: ['.iso', '.xiso'],
  ps4: ['.pkg']
};

function scanDirectory(dirPath, system) {
  const wslPath = toWslPath(dirPath);
  const games = [];

  if (!fs.existsSync(wslPath)) {
    console.log(`  Directory not found: ${wslPath}`);
    return games;
  }

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const validExts = ROM_EXTENSIONS[system] || [];
        if (validExts.includes(ext)) {
          const { title, region, format } = parseRomName(entry.name);
          const stat = fs.statSync(fullPath);
          games.push({
            title,
            system,
            region,
            file_path: toWindowsPath(fullPath),
            file_size: stat.size,
            file_format: format
          });
        }
      }
    }
  }

  // Xbox: games are in folders
  if (system === 'xbox') {
    const entries = fs.readdirSync(wslPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const gamePath = path.join(wslPath, entry.name);
        games.push({
          title: entry.name.replace(/\(.*?\)/g, '').trim(),
          system: 'xbox',
          region: 'USA',
          file_path: toWindowsPath(gamePath),
          file_size: 0,
          file_format: 'folder'
        });
      }
    }
  } else if (system === 'ps4') {
    // PS4: scan for .pkg files AND folders with eboot.bin (installed games)
    const entries = fs.readdirSync(wslPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(wslPath, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pkg')) {
        const { title, region, format } = parseRomName(entry.name);
        const stat = fs.statSync(fullPath);
        games.push({ title, system: 'ps4', region, file_path: toWindowsPath(fullPath), file_size: stat.size, file_format: 'pkg' });
      } else if (entry.isDirectory()) {
        // Check for eboot.bin inside folder (installed/extracted PS4 game)
        const ebootPath = path.join(fullPath, 'eboot.bin');
        if (fs.existsSync(ebootPath)) {
          const title = entry.name.replace(/CUSA\d+/i, '').replace(/[-_]/g, ' ').trim() || entry.name;
          games.push({
            title,
            system: 'ps4',
            region: 'USA',
            file_path: toWindowsPath(ebootPath),
            file_size: 0,
            file_format: 'eboot'
          });
        }
      }
    }
  } else {
    walkDir(wslPath);
  }

  return games;
}

// ---- API Routes ----

// Get all games
app.get('/api/games', (req, res) => {
  const { system, search, favorites, sort, genre, developer, publisher, collection } = req.query;
  let query = 'SELECT * FROM games WHERE 1=1';
  const params = [];

  if (system && system !== 'all') {
    query += ' AND system = ?';
    params.push(system);
  }
  if (search) {
    query += ' AND title LIKE ?';
    params.push(`%${search}%`);
  }
  if (favorites === '1') {
    query += ' AND favorite = 1';
  }
  if (genre) {
    query += ' AND genre LIKE ?';
    params.push(`%${genre}%`);
  }
  if (developer) {
    query += ' AND developer LIKE ?';
    params.push(`%${developer}%`);
  }
  if (publisher) {
    query += ' AND publisher LIKE ?';
    params.push(`%${publisher}%`);
  }
  if (collection) {
    query += ' AND id IN (SELECT game_id FROM collection_games WHERE collection_id = ?)';
    params.push(collection);
  }

  switch (sort) {
    case 'recent':
      query += ' ORDER BY last_played DESC NULLS LAST';
      break;
    case 'most_played':
      query += ' ORDER BY play_count DESC';
      break;
    case 'rating':
      query += ' ORDER BY rating DESC NULLS LAST';
      break;
    case 'release_date':
      query += ' ORDER BY release_date ASC NULLS LAST';
      break;
    case 'genre':
      query += ' ORDER BY genre ASC NULLS LAST, title ASC';
      break;
    case 'developer':
      query += ' ORDER BY developer ASC NULLS LAST, title ASC';
      break;
    case 'name':
    default:
      query += ' ORDER BY title ASC';
  }

  res.json(db.prepare(query).all(...params));
});

// Get game counts per system
app.get('/api/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT system, COUNT(*) as count FROM games GROUP BY system
  `).all();
  const total = db.prepare('SELECT COUNT(*) as count FROM games').get();
  const favs = db.prepare('SELECT COUNT(*) as count FROM games WHERE favorite = 1').get();
  res.json({ systems: stats, total: total.count, favorites: favs.count });
});

// Toggle favorite
app.post('/api/games/:id/favorite', (req, res) => {
  db.prepare('UPDATE games SET favorite = NOT favorite WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Launch game
app.post('/api/games/:id/launch', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const config = getConfig();

  let exePath, args;

  if (game.system === 'port') {
    exePath = game.file_path;
    args = [];
  } else {
    const emu = config.emulators[game.system];
    if (!emu || !emu.path) {
      return res.status(400).json({ error: `No emulator configured for ${game.system}` });
    }
    exePath = emu.path;
    const argsStr = emu.args.replace('{rom}', game.file_path);
    // Parse args string respecting quotes
    args = argsStr.match(/"[^"]*"|[^\s]+/g)?.map(a => a.replace(/^"|"$/g, '')) || [];
  }

  console.log(`Launching: ${exePath} ${args.join(' ')}`);

  const startTime = Date.now();
  const child = spawn(toWslPath(exePath), args, {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();

  // Track play
  db.prepare(`
    UPDATE games SET play_count = play_count + 1, last_played = datetime('now') WHERE id = ?
  `).run(game.id);

  // Try to track play time when process exits
  child.on('exit', () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    db.prepare('UPDATE games SET total_time = total_time + ? WHERE id = ?').run(elapsed, game.id);
  });

  res.json({ ok: true, launched: game.title });
});

// Scan ROM directories
app.post('/api/scan', (req, res) => {
  const config = getConfig();
  let totalAdded = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO games (title, system, region, file_path, file_size, file_format)
    VALUES (@title, @system, @region, @file_path, @file_size, @file_format)
  `);

  sendScanEvent({ phase: 'roms', status: 'scanning' });

  // Scan ROM directories
  for (const dir of config.rom_directories) {
    console.log(`Scanning: ${dir.path} (${dir.system})`);
    sendScanEvent({ phase: 'roms', status: 'scanning', directory: dir.path, system: dir.system });
    const games = scanDirectory(dir.path, dir.system);
    for (const game of games) {
      const result = insert.run(game);
      if (result.changes) totalAdded++;
    }
    console.log(`  Found ${games.length} games`);
  }

  // Add ports
  for (const port of config.ports) {
    const result = insert.run({
      title: port.name,
      system: 'port',
      region: 'N/A',
      file_path: port.path,
      file_size: 0,
      file_format: 'exe'
    });
    if (result.changes) totalAdded++;
  }

  console.log(`Scan complete: ${totalAdded} new games added`);
  sendScanEvent({ phase: 'roms', done: true, added: totalAdded });

  // Set port covers
  setPortCovers();

  // Kick off art scraping in background, then metadata (non-blocking)
  scrapeCovers().then(() => {
    if (scraper.isConfigured()) {
      scrapeMetadata();
    }
  });

  res.json({ added: totalAdded });
});

// Get/update config
app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ ok: true });
});

// ---- Cover Art Scraping ----

const LIBRETRO_SYSTEM_MAP = {
  gb:   'Nintendo - Game Boy',
  gbc:  'Nintendo - Game Boy Color',
  gba:  'Nintendo - Game Boy Advance',
  n64:  'Nintendo - Nintendo 64',
  gcn:  'Nintendo - GameCube',
  xbox: 'Microsoft - Xbox',
  ps4:  'Sony - PlayStation 4'
};

// LibRetro thumbnails use & -> _ substitution for filenames
function libretroEncode(name) {
  return name
    .replace(/&/g, '_')
    .replace(/\//g, '_');
}

// Extract the no-intro name from a file_path (filename without extension)
function extractRomName(filePath, system) {
  const basename = filePath.replace(/\\/g, '/').split('/').pop();
  if (system === 'xbox') {
    // Xbox games are folders — the folder name IS the no-intro name
    return basename;
  }
  // Strip file extension
  return basename.replace(/\.[^.]+$/, '');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return resolve(false);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      resolve(false);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// SSE clients for scan progress
let scanClients = [];

function sendScanEvent(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  scanClients.forEach(res => res.write(msg));
}

// SSE endpoint for scan progress
app.get('/api/scan/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  scanClients.push(res);
  req.on('close', () => {
    scanClients = scanClients.filter(c => c !== res);
  });
});

let scrapeInProgress = false;

async function scrapeCovers() {
  if (scrapeInProgress) return;
  scrapeInProgress = true;

  const updateCover = db.prepare('UPDATE games SET cover_path = ? WHERE id = ?');

  // Get all games that need cover art (cover_path is NULL — not yet attempted)
  const needsArt = db.prepare(
    "SELECT id, title, system, file_path FROM games WHERE cover_path IS NULL AND system != 'port'"
  ).all();

  if (needsArt.length === 0) {
    sendScanEvent({ phase: 'art', done: true, total: 0, fetched: 0, failed: 0 });
    scrapeInProgress = false;
    return;
  }

  console.log(`  Scraping cover art for ${needsArt.length} games...`);
  sendScanEvent({ phase: 'art', status: 'starting', total: needsArt.length });

  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < needsArt.length; i++) {
    const game = needsArt[i];
    const libretroSystem = LIBRETRO_SYSTEM_MAP[game.system];

    if (!libretroSystem) {
      updateCover.run('missing', game.id);
      failed++;
      continue;
    }

    const romName = extractRomName(game.file_path, game.system);
    const encodedSystem = encodeURIComponent(libretroSystem);
    const encodedName = encodeURIComponent(libretroEncode(romName));
    const url = `https://thumbnails.libretro.com/${encodedSystem}/Named_Boxarts/${encodedName}.png`;

    const coverDir = path.join(__dirname, 'covers', game.system);
    if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

    const localFile = path.join(coverDir, `${libretroEncode(romName)}.png`);
    const coverRelPath = `covers/${game.system}/${libretroEncode(romName)}.png`;

    const ok = await downloadFile(url, localFile);

    if (ok) {
      updateCover.run(coverRelPath, game.id);
      fetched++;
    } else {
      updateCover.run('missing', game.id);
      failed++;
    }

    // Progress update every 10 games or on last
    if ((i + 1) % 10 === 0 || i === needsArt.length - 1) {
      sendScanEvent({
        phase: 'art',
        current: i + 1,
        total: needsArt.length,
        fetched,
        failed,
        lastGame: game.title
      });
    }

    // Rate limit: ~5 req/sec
    await sleep(200);
  }

  console.log(`  Cover art done: ${fetched} fetched, ${failed} missing`);
  sendScanEvent({ phase: 'art', done: true, total: needsArt.length, fetched, failed });
  scrapeInProgress = false;
}

// Handle port covers manually
function setPortCovers() {
  const ports = db.prepare("SELECT id, title FROM games WHERE system = 'port' AND cover_path IS NULL").all();
  const updateCover = db.prepare('UPDATE games SET cover_path = ? WHERE id = ?');
  for (const port of ports) {
    // Mark as missing for now — user can drop custom PNGs into covers/port/
    const safeName = port.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
    const coverFile = path.join(__dirname, 'covers', 'port', `${safeName}.png`);
    if (fs.existsSync(coverFile)) {
      updateCover.run(`covers/port/${safeName}.png`, port.id);
    } else {
      updateCover.run('missing', port.id);
    }
  }
}

// ---- Metadata Scraping (IGDB) ----

// Serve screenshots
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Scraper status
app.get('/api/scraper/status', (req, res) => {
  const configured = scraper.isConfigured();
  const unscraped = db.prepare("SELECT COUNT(*) as count FROM games WHERE scraped = 0 AND system != 'port'").get();
  const total = db.prepare("SELECT COUNT(*) as count FROM games WHERE system != 'port'").get();
  res.json({
    configured,
    scrapeInProgress,
    unscraped: unscraped.count,
    total: total.count,
    scraped: total.count - unscraped.count,
  });
});

// Scrape metadata for all unscraped games
app.post('/api/scraper/run', async (req, res) => {
  if (metaScrapeInProgress) {
    return res.json({ error: 'Scrape already in progress' });
  }

  if (!scraper.isConfigured()) {
    return res.status(400).json({ error: 'IGDB credentials not configured. Create igdb-credentials.json' });
  }

  res.json({ ok: true, message: 'Metadata scrape started' });

  // Run in background
  scrapeMetadata();
});

// Scrape a single game (re-scrape)
app.post('/api/games/:id/scrape', async (req, res) => {
  if (!scraper.isConfigured()) {
    return res.status(400).json({ error: 'IGDB credentials not configured' });
  }

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const authed = await scraper.authenticate();
  if (!authed) return res.status(500).json({ error: 'IGDB authentication failed' });

  try {
    const meta = await scraper.scrapeGame(game, __dirname);
    if (meta) {
      applyMetadata(game.id, meta);
      const updated = db.prepare('SELECT * FROM games WHERE id = ?').get(game.id);
      res.json({ ok: true, game: updated });
    } else {
      db.prepare('UPDATE games SET scraped = 1 WHERE id = ?').run(game.id);
      res.json({ ok: false, message: 'No metadata found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get distinct genres for filter dropdown
app.get('/api/genres', (req, res) => {
  const genres = db.prepare(
    "SELECT DISTINCT genre FROM games WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC"
  ).all();
  // Flatten comma-separated genres into unique list
  const genreSet = new Set();
  for (const row of genres) {
    for (const g of row.genre.split(',')) {
      genreSet.add(g.trim());
    }
  }
  res.json([...genreSet].sort());
});

// Get distinct developers
app.get('/api/developers', (req, res) => {
  const devs = db.prepare(
    "SELECT DISTINCT developer FROM games WHERE developer IS NOT NULL AND developer != '' ORDER BY developer ASC"
  ).all();
  res.json(devs.map(d => d.developer));
});

// ---- Collections ----

app.get('/api/collections', (req, res) => {
  const collections = db.prepare(`
    SELECT c.*, COUNT(cg.game_id) as game_count
    FROM collections c
    LEFT JOIN collection_games cg ON c.id = cg.collection_id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();
  res.json(collections);
});

app.post('/api/collections', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const result = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)').run(name, description || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Collection already exists' });
  }
});

app.delete('/api/collections/:id', (req, res) => {
  db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/collections/:id/games', (req, res) => {
  const { gameId } = req.body;
  try {
    db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, game_id) VALUES (?, ?)').run(req.params.id, gameId);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.delete('/api/collections/:id/games/:gameId', (req, res) => {
  db.prepare('DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?').run(req.params.id, req.params.gameId);
  res.json({ ok: true });
});

// ---- Metadata Scrape Engine ----

let metaScrapeInProgress = false;

const updateMeta = db.prepare(`
  UPDATE games SET
    description = COALESCE(@description, description),
    genre = COALESCE(@genre, genre),
    developer = COALESCE(@developer, developer),
    publisher = COALESCE(@publisher, publisher),
    release_date = COALESCE(@release_date, release_date),
    players = COALESCE(@players, players),
    rating = COALESCE(@rating, rating),
    igdb_id = COALESCE(@igdb_id, igdb_id),
    screenshot_path = COALESCE(@screenshot_path, screenshot_path),
    cover_path = CASE WHEN @cover_path IS NOT NULL AND (cover_path IS NULL OR cover_path = 'missing') THEN @cover_path ELSE cover_path END,
    scraped = 1
  WHERE id = @id
`);

function applyMetadata(gameId, meta) {
  updateMeta.run({
    id: gameId,
    description: meta.description || null,
    genre: meta.genre || null,
    developer: meta.developer || null,
    publisher: meta.publisher || null,
    release_date: meta.release_date || null,
    players: meta.players || null,
    rating: meta.rating || null,
    igdb_id: meta.igdb_id || null,
    screenshot_path: meta.screenshot_path || null,
    cover_path: meta.cover_path || null,
  });
}

async function scrapeMetadata() {
  if (metaScrapeInProgress) return;
  metaScrapeInProgress = true;

  const authed = await scraper.authenticate();
  if (!authed) {
    console.log('[Scraper] Authentication failed — skipping metadata scrape');
    metaScrapeInProgress = false;
    return;
  }

  const needsScrape = db.prepare(
    "SELECT id, title, system, file_path FROM games WHERE scraped = 0 AND system != 'port'"
  ).all();

  if (needsScrape.length === 0) {
    console.log('[Scraper] All games already scraped');
    sendScanEvent({ phase: 'metadata', done: true, total: 0, scraped: 0, failed: 0 });
    metaScrapeInProgress = false;
    return;
  }

  console.log(`[Scraper] Scraping metadata for ${needsScrape.length} games...`);
  sendScanEvent({ phase: 'metadata', status: 'starting', total: needsScrape.length });

  let scraped = 0;
  let failed = 0;

  for (let i = 0; i < needsScrape.length; i++) {
    const game = needsScrape[i];

    try {
      const meta = await scraper.scrapeGame(game, __dirname);
      if (meta) {
        applyMetadata(game.id, meta);
        scraped++;
      } else {
        db.prepare('UPDATE games SET scraped = 1 WHERE id = ?').run(game.id);
        failed++;
      }
    } catch (e) {
      console.error(`[Scraper] Error scraping "${game.title}":`, e.message);
      db.prepare('UPDATE games SET scraped = 1 WHERE id = ?').run(game.id);
      failed++;
    }

    // Progress events
    if ((i + 1) % 5 === 0 || i === needsScrape.length - 1) {
      sendScanEvent({
        phase: 'metadata',
        current: i + 1,
        total: needsScrape.length,
        scraped,
        failed,
        lastGame: game.title,
      });
    }

    // Rate limit: ~4 req/sec (IGDB allows 4/sec)
    await new Promise(r => setTimeout(r, 280));
  }

  console.log(`[Scraper] Metadata done: ${scraped} scraped, ${failed} missed`);
  sendScanEvent({ phase: 'metadata', done: true, total: needsScrape.length, scraped, failed });
  metaScrapeInProgress = false;
}

// ---- Start ----
app.listen(PORT, () => {
  console.log(`\n  ⚡ Arcadia running at http://localhost:${PORT}\n`);
  if (!scraper.isConfigured()) {
    console.log('  ⚠  IGDB scraper not configured. Create igdb-credentials.json with:');
    console.log('     { "clientId": "your_twitch_client_id", "clientSecret": "your_twitch_secret" }');
    console.log('     Get credentials at: https://dev.twitch.tv/console/apps\n');
  } else {
    console.log('  ✓  IGDB scraper configured\n');
  }
});
