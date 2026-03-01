// ============================================================
// Arcadia IGDB Scraper
// Fetches game metadata from IGDB (Twitch) API
// ============================================================

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = path.join(__dirname, 'igdb-credentials.json');

// ---- IGDB Platform IDs ----
// https://api-docs.igdb.com/
const IGDB_PLATFORM_MAP = {
  gb:   33,   // Game Boy
  gbc:  22,   // Game Boy Color
  gba:  24,   // Game Boy Advance
  n64:  4,    // Nintendo 64
  gcn:  21,   // GameCube
  snes: 19,   // Super Nintendo
  nes:  18,   // NES
  xbox: 11,   // Xbox
  ps4:  48,   // PlayStation 4
  ps1:  7,    // PlayStation
  ps2:  8,    // PlayStation 2
  wii:  5,    // Wii
  ds:   20,   // Nintendo DS
  port: null, // PC ports — search as PC (6)
};

// ---- Auth ----

let accessToken = null;
let tokenExpiry = 0;

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch (e) {
    console.error('[Scraper] Failed to read credentials:', e.message);
    return null;
  }
}

function saveCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

function httpsRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOpts = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || (postData ? 'POST' : 'GET'),
      headers: options.headers || {},
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function authenticate() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('[Scraper] No IGDB credentials found. Create igdb-credentials.json with clientId and clientSecret.');
    return false;
  }

  // Check if we have a valid cached token
  if (creds.accessToken && creds.tokenExpiry && Date.now() < creds.tokenExpiry) {
    accessToken = creds.accessToken;
    tokenExpiry = creds.tokenExpiry;
    return true;
  }

  // Get new token from Twitch
  const url = `https://id.twitch.tv/oauth2/token?client_id=${creds.clientId}&client_secret=${creds.clientSecret}&grant_type=client_credentials`;

  try {
    const res = await httpsRequest(url, { method: 'POST' });
    if (res.status === 200 && res.data.access_token) {
      accessToken = res.data.access_token;
      tokenExpiry = Date.now() + (res.data.expires_in * 1000) - 60000; // 1 min buffer

      // Cache the token
      creds.accessToken = accessToken;
      creds.tokenExpiry = tokenExpiry;
      saveCredentials(creds);

      console.log('[Scraper] IGDB authenticated successfully');
      return true;
    } else {
      console.error('[Scraper] Auth failed:', res.data);
      return false;
    }
  } catch (e) {
    console.error('[Scraper] Auth error:', e.message);
    return false;
  }
}

// ---- IGDB API ----

async function igdbQuery(endpoint, body) {
  const creds = loadCredentials();
  if (!creds || !accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await httpsRequest(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': creds.clientId,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
  }, body);

  if (res.status === 401) {
    // Token expired, re-auth
    const ok = await authenticate();
    if (!ok) throw new Error('Re-authentication failed');
    return igdbQuery(endpoint, body);
  }

  if (res.status === 429) {
    // Rate limited — wait and retry
    await sleep(1000);
    return igdbQuery(endpoint, body);
  }

  return res.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Game Title Cleaning ----

function cleanGameTitle(title) {
  let clean = title;

  // Remove parenthetical tags like (USA), (Rev 1), (En,Fr,De), etc.
  clean = clean.replace(/\s*\([^)]*\)/g, '');

  // Remove bracket tags like [!], [b]
  clean = clean.replace(/\s*\[[^\]]*\]/g, '');

  // Remove leading/trailing junk
  clean = clean.trim();

  // Remove trailing ", The" and move to front
  if (clean.endsWith(', The')) {
    clean = 'The ' + clean.slice(0, -5);
  }

  return clean;
}

// ---- Search & Scrape ----

async function searchGame(title, system) {
  const cleanTitle = cleanGameTitle(title);
  const platformId = IGDB_PLATFORM_MAP[system];

  // Build query
  let query = `
    search "${cleanTitle.replace(/"/g, '\\"')}";
    fields name, summary, genres.name, involved_companies.company.name,
           involved_companies.developer, involved_companies.publisher,
           first_release_date, aggregated_rating, player_perspectives.name,
           game_modes.name, cover.image_id, screenshots.image_id,
           platforms.name;
    limit 5;
  `;

  // Add platform filter if we know it
  if (platformId) {
    query += `where platforms = (${platformId});`;
  } else if (system === 'port') {
    // PC ports — search PC platform
    query += `where platforms = (6);`;
  }

  try {
    const results = await igdbQuery('games', query);
    if (!results || results.length === 0) {
      // Try without platform filter as fallback
      const fallbackQuery = `
        search "${cleanTitle.replace(/"/g, '\\"')}";
        fields name, summary, genres.name, involved_companies.company.name,
               involved_companies.developer, involved_companies.publisher,
               first_release_date, aggregated_rating, player_perspectives.name,
               game_modes.name, cover.image_id, screenshots.image_id,
               platforms.name;
        limit 5;
      `;
      return await igdbQuery('games', fallbackQuery);
    }
    return results;
  } catch (e) {
    console.error(`[Scraper] Search failed for "${cleanTitle}":`, e.message);
    return [];
  }
}

function pickBestMatch(results, title) {
  if (!results || results.length === 0) return null;

  const cleanTitle = cleanGameTitle(title).toLowerCase();

  // Score each result
  const scored = results.map(r => {
    const name = (r.name || '').toLowerCase();
    let score = 0;

    // Exact match
    if (name === cleanTitle) score += 100;
    // Starts with
    else if (name.startsWith(cleanTitle) || cleanTitle.startsWith(name)) score += 50;
    // Contains
    else if (name.includes(cleanTitle) || cleanTitle.includes(name)) score += 25;

    // Prefer games with more data
    if (r.summary) score += 10;
    if (r.genres) score += 5;
    if (r.cover) score += 5;
    if (r.aggregated_rating) score += 3;
    if (r.first_release_date) score += 3;

    return { ...r, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  return scored[0]._score > 0 ? scored[0] : scored[0]; // Return best even if low score
}

function extractMetadata(igdbGame) {
  if (!igdbGame) return null;

  const meta = {
    description: igdbGame.summary || null,
    genre: null,
    developer: null,
    publisher: null,
    release_date: null,
    players: null,
    rating: null,
    igdb_id: igdbGame.id || null,
    screenshot_url: null,
    cover_url: null,
  };

  // Genre — first genre name
  if (igdbGame.genres && igdbGame.genres.length > 0) {
    meta.genre = igdbGame.genres.map(g => g.name).join(', ');
  }

  // Developer & Publisher from involved_companies
  if (igdbGame.involved_companies) {
    const devs = igdbGame.involved_companies.filter(c => c.developer);
    const pubs = igdbGame.involved_companies.filter(c => c.publisher);

    if (devs.length > 0 && devs[0].company) {
      meta.developer = devs.map(d => d.company.name).join(', ');
    }
    if (pubs.length > 0 && pubs[0].company) {
      meta.publisher = pubs.map(p => p.company.name).join(', ');
    }
  }

  // Release date (IGDB returns Unix timestamp)
  if (igdbGame.first_release_date) {
    const d = new Date(igdbGame.first_release_date * 1000);
    meta.release_date = d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // Rating (IGDB uses 0-100 scale, normalize to 0-5)
  if (igdbGame.aggregated_rating) {
    meta.rating = Math.round(igdbGame.aggregated_rating / 20 * 10) / 10; // 0.0 - 5.0
  }

  // Players from game_modes
  if (igdbGame.game_modes) {
    const modes = igdbGame.game_modes.map(m => m.name);
    if (modes.includes('Multiplayer') || modes.includes('Co-operative') || modes.includes('Split screen')) {
      meta.players = '1-4'; // Approximate
    } else {
      meta.players = '1';
    }
  }

  // Cover URL (IGDB image hash -> URL)
  if (igdbGame.cover && igdbGame.cover.image_id) {
    meta.cover_url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${igdbGame.cover.image_id}.jpg`;
  }

  // Screenshot URL
  if (igdbGame.screenshots && igdbGame.screenshots.length > 0) {
    meta.screenshot_url = `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${igdbGame.screenshots[0].image_id}.jpg`;
  }

  return meta;
}

// ---- Download Helpers ----

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return downloadImage(response.headers.location, destPath).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return resolve(false);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      resolve(false);
    });
  });
}

// ---- Main Scrape Function ----

/**
 * Scrape metadata for a single game
 * @param {object} game - { id, title, system, file_path }
 * @param {string} baseDir - Arcadia root directory
 * @returns {object|null} - Metadata object or null
 */
async function scrapeGame(game, baseDir) {
  const results = await searchGame(game.title, game.system);
  const best = pickBestMatch(results, game.title);
  const meta = extractMetadata(best);

  if (!meta) return null;

  // Download cover art from IGDB if available and we don't have one
  if (meta.cover_url) {
    const coverDir = path.join(baseDir, 'covers', game.system);
    const safeName = game.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
    const coverFile = path.join(coverDir, `${safeName}.jpg`);
    const coverRelPath = `covers/${game.system}/${safeName}.jpg`;

    const ok = await downloadImage(meta.cover_url, coverFile);
    if (ok) {
      meta.cover_path = coverRelPath;
    }
  }

  // Download screenshot if available
  if (meta.screenshot_url) {
    const ssDir = path.join(baseDir, 'screenshots', game.system);
    const safeName = game.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
    const ssFile = path.join(ssDir, `${safeName}.jpg`);
    const ssRelPath = `screenshots/${game.system}/${safeName}.jpg`;

    const ok = await downloadImage(meta.screenshot_url, ssFile);
    if (ok) {
      meta.screenshot_path = ssRelPath;
    }
  }

  return meta;
}

/**
 * Check if scraper is configured and ready
 */
function isConfigured() {
  const creds = loadCredentials();
  return !!(creds && creds.clientId && creds.clientSecret);
}

export {
  authenticate,
  scrapeGame,
  searchGame,
  pickBestMatch,
  extractMetadata,
  cleanGameTitle,
  isConfigured,
  IGDB_PLATFORM_MAP,
};
