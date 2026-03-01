// ---- State ----
let games = [];
let currentSystem = 'all';
let currentSearch = '';
let currentSort = 'name';
let currentGenre = '';
let selectedGame = null;

const SYSTEM_NAMES = {
  gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance',
  n64: 'N64', gcn: 'GameCube', xbox: 'Xbox', ps4: 'PlayStation 4', port: 'PC Port',
  all: 'All Games', favorites: 'Favorites', recent: 'Recently Played'
};

const SYSTEM_ICONS = {
  gb: '🟢', gbc: '🟣', gba: '🔵', n64: '🔴', gcn: '🟪', xbox: '🟩', ps4: '🔷', port: '⭐'
};

// ---- API ----
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

// ---- Fetch & Render ----
async function loadGames() {
  const params = new URLSearchParams();

  if (currentSystem === 'favorites') {
    params.set('favorites', '1');
  } else if (currentSystem === 'recent') {
    params.set('sort', 'recent');
  } else if (currentSystem !== 'all') {
    params.set('system', currentSystem);
  }

  if (currentSearch) params.set('search', currentSearch);
  if (currentSort && currentSystem !== 'recent') params.set('sort', currentSort);
  if (currentGenre) params.set('genre', currentGenre);

  games = await api(`/games?${params}`);
  renderGrid();
}

async function loadStats() {
  const stats = await api('/stats');
  document.getElementById('count-all').textContent = stats.total;
  document.getElementById('count-fav').textContent = stats.favorites;

  for (const s of stats.systems) {
    const el = document.getElementById(`count-${s.system}`);
    if (el) el.textContent = s.count;
  }
}

function renderGrid() {
  const grid = document.getElementById('game-grid');
  const empty = document.getElementById('empty-state');

  if (games.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  grid.innerHTML = games.map(game => {
    const hasCover = game.cover_path && game.cover_path !== 'missing';
    const coverContent = hasCover
      ? `<img class="cover-img" src="/${game.cover_path}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
        + `<span class="system-icon" style="display:none">${SYSTEM_ICONS[game.system] || '🎮'}</span>`
      : `<span class="system-icon">${SYSTEM_ICONS[game.system] || '🎮'}</span>`;
    return `
    <div class="game-card" data-id="${game.id}" onclick="showDetail(${game.id})">
      <div class="card-cover${hasCover ? ' has-art' : ''}">
        ${coverContent}
        ${game.favorite ? '<span class="card-fav">★</span>' : ''}
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHtml(game.title)}</div>
        <span class="card-system ${game.system}">${SYSTEM_NAMES[game.system] || game.system}</span>
      </div>
    </div>
  `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Detail Modal ----
function showDetail(id) {
  selectedGame = games.find(g => g.id === id);
  if (!selectedGame) return;

  const g = selectedGame;
  document.getElementById('modal-title').textContent = g.title;
  document.getElementById('modal-system').textContent = SYSTEM_NAMES[g.system] || g.system;
  document.getElementById('modal-system').className = `badge ${g.system}`;
  document.getElementById('modal-region').textContent = g.region || 'Unknown';
  document.getElementById('modal-format').textContent = `.${g.file_format}`;
  document.getElementById('modal-size').textContent = formatSize(g.file_size);
  const coverEl = document.getElementById('modal-cover-img');
  const hasCover = g.cover_path && g.cover_path !== 'missing';
  if (hasCover) {
    coverEl.innerHTML = `<img class="modal-cover-art" src="/${g.cover_path}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${SYSTEM_ICONS[g.system] || '🎮'}'">`;
  } else {
    coverEl.innerHTML = '';
    coverEl.textContent = SYSTEM_ICONS[g.system] || '🎮';
  }

  // Rich metadata
  setMetaRow('modal-genre', 'Genre', g.genre);
  setMetaRow('modal-developer', 'Developer', g.developer);
  setMetaRow('modal-publisher', 'Publisher', g.publisher);
  setMetaRow('modal-release-date', 'Released', g.release_date);
  setMetaRow('modal-players', 'Players', g.players);

  // Rating as stars
  const ratingEl = document.getElementById('modal-rating-display');
  if (g.rating && g.rating > 0) {
    const stars = '★'.repeat(Math.round(g.rating)) + '☆'.repeat(5 - Math.round(g.rating));
    ratingEl.innerHTML = `<span class="meta-label">Rating</span><span class="meta-value">${stars} <span class="rating-num">${g.rating.toFixed(1)}</span></span>`;
    ratingEl.style.display = '';
  } else {
    ratingEl.style.display = 'none';
  }

  // Description
  const descEl = document.getElementById('modal-description');
  if (g.description) {
    descEl.textContent = g.description;
    descEl.style.display = '';
  } else {
    descEl.style.display = 'none';
  }

  // Stats
  document.getElementById('modal-plays').textContent =
    g.play_count > 0 ? `Played ${g.play_count} time${g.play_count !== 1 ? 's' : ''}` : 'Never played';
  document.getElementById('modal-last-played').textContent =
    g.last_played ? `Last: ${new Date(g.last_played + 'Z').toLocaleDateString()}` : '';
  document.getElementById('modal-total-time').textContent =
    g.total_time > 0 ? `Total: ${formatTime(g.total_time)}` : '';

  // Fav button
  const favBtn = document.getElementById('modal-fav');
  favBtn.className = g.favorite ? 'btn-fav active' : 'btn-fav';
  favBtn.textContent = g.favorite ? '★ Favorited' : '☆ Favorite';

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function setMetaRow(id, label, value) {
  const el = document.getElementById(id);
  if (value) {
    el.innerHTML = `<span class="meta-label">${label}</span><span class="meta-value">${escapeHtml(value)}</span>`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function hideDetail() {
  document.getElementById('modal-overlay').classList.add('hidden');
  selectedGame = null;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---- Actions ----
async function scanLibrary() {
  const btn = document.getElementById('btn-scan');
  btn.textContent = '⟳ Scanning...';
  btn.disabled = true;
  const scanState = document.getElementById('scanning-state');
  scanState.classList.remove('hidden');
  scanState.innerHTML = '<p>Scanning ROM directories...</p>';

  // Connect to SSE for progress
  const evtSource = new EventSource('/api/scan/progress');
  let artTotal = 0;

  evtSource.onmessage = async (e) => {
    const data = JSON.parse(e.data);

    if (data.phase === 'roms' && data.done) {
      scanState.innerHTML = `<p>Found ${data.added} new games. Fetching cover art...</p>`;
      await loadGames();
      await loadStats();
    }

    if (data.phase === 'art' && !data.done) {
      artTotal = data.total;
      const pct = Math.round((data.current / data.total) * 100);
      scanState.innerHTML = `
        <p>Fetching cover art: ${data.current} / ${data.total} (${pct}%)</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <p class="scan-detail">${data.fetched} found · ${data.failed} missing · ${escapeHtml(data.lastGame || '')}</p>
      `;
      // Periodically refresh grid so covers appear live
      if (data.current % 50 === 0) {
        await loadGames();
      }
    }

    if (data.phase === 'art' && data.done) {
      if (data.total > 0) {
        scanState.innerHTML = `<p>Covers: ${data.fetched} found, ${data.failed} unavailable. Fetching metadata...</p>`;
      } else {
        scanState.innerHTML = `<p>All covers up to date. Fetching metadata...</p>`;
      }
      await loadGames();
      await loadStats();
    }

    // Metadata scraping phase
    if (data.phase === 'metadata' && !data.done) {
      const pct = Math.round((data.current / data.total) * 100);
      scanState.innerHTML = `
        <p>Scraping metadata: ${data.current} / ${data.total} (${pct}%)</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <p class="scan-detail">${data.scraped} enriched · ${data.failed} missed · ${escapeHtml(data.lastGame || '')}</p>
      `;
      if (data.current % 20 === 0) {
        await loadGames();
        await loadGenres();
      }
    }

    if (data.phase === 'metadata' && data.done) {
      evtSource.close();
      if (data.total > 0) {
        scanState.innerHTML = `<p>Done! ${data.scraped} games enriched with metadata.</p>`;
      } else {
        scanState.innerHTML = `<p>All metadata up to date.</p>`;
      }
      btn.textContent = '⟳ Scan';
      btn.disabled = false;
      await loadGames();
      await loadStats();
      await loadGenres();
      setTimeout(() => { scanState.classList.add('hidden'); }, 4000);
    }

    // If metadata phase never fires (scraper not configured), close after art with a timeout
    if (data.phase === 'art' && data.done) {
      // Give metadata phase 5 seconds to start, otherwise close
      setTimeout(() => {
        if (btn.disabled) {
          evtSource.close();
          scanState.innerHTML = `<p>Done! Covers scraped. Configure IGDB for metadata enrichment.</p>`;
          btn.textContent = '⟳ Scan';
          btn.disabled = false;
          setTimeout(() => { scanState.classList.add('hidden'); }, 4000);
        }
      }, 5000);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    btn.textContent = '⟳ Scan';
    btn.disabled = false;
  };

  try {
    const result = await api('/scan', { method: 'POST' });
    console.log(`Scan complete: ${result.added} new games`);
  } catch (e) {
    console.error('Scan failed:', e);
    evtSource.close();
    btn.textContent = '⟳ Scan';
    btn.disabled = false;
    scanState.classList.add('hidden');
  }
}

async function launchGame() {
  if (!selectedGame) return;

  const btn = document.getElementById('modal-play');
  btn.textContent = '⏳ Launching...';

  try {
    await api(`/games/${selectedGame.id}/launch`, { method: 'POST' });
    btn.textContent = '✓ Launched!';
    setTimeout(() => { btn.textContent = '▶ PLAY'; }, 2000);
  } catch (e) {
    btn.textContent = '✗ Failed';
    setTimeout(() => { btn.textContent = '▶ PLAY'; }, 2000);
  }

  // Refresh stats
  await loadGames();
  await loadStats();
}

async function toggleFavorite() {
  if (!selectedGame) return;

  await api(`/games/${selectedGame.id}/favorite`, { method: 'POST' });
  selectedGame.favorite = !selectedGame.favorite;

  const favBtn = document.getElementById('modal-fav');
  favBtn.className = selectedGame.favorite ? 'btn-fav active' : 'btn-fav';
  favBtn.textContent = selectedGame.favorite ? '★ Favorited' : '☆ Favorite';

  await loadGames();
  await loadStats();
}

// ---- Genre Filter ----
async function loadGenres() {
  const genres = await api('/genres');
  const select = document.getElementById('genre-filter');
  // Keep the "All Genres" option
  select.innerHTML = '<option value="">All Genres</option>';
  for (const genre of genres) {
    const opt = document.createElement('option');
    opt.value = genre;
    opt.textContent = genre;
    select.appendChild(opt);
  }
}

// ---- Re-scrape ----
async function rescrapeGame() {
  if (!selectedGame) return;

  const btn = document.getElementById('modal-rescrape');
  btn.textContent = '⟳ Scraping...';
  btn.disabled = true;

  try {
    const result = await api(`/games/${selectedGame.id}/scrape`, { method: 'POST' });
    if (result.ok && result.game) {
      // Update the selected game with new data
      selectedGame = result.game;
      showDetail(selectedGame.id);
      // Also refresh the games list in background
      games = games.map(g => g.id === result.game.id ? result.game : g);
      btn.textContent = '✓ Done';
    } else {
      btn.textContent = '✗ Not found';
    }
  } catch (e) {
    btn.textContent = '✗ Error';
  }

  btn.disabled = false;
  setTimeout(() => { btn.textContent = '⟳ Scrape'; }, 2000);
}

// ---- Settings ----
let settingsConfig = null;

const SYSTEM_OPTIONS = [
  { value: 'gb', label: 'Game Boy' },
  { value: 'gbc', label: 'Game Boy Color' },
  { value: 'gba', label: 'Game Boy Advance' },
  { value: 'n64', label: 'Nintendo 64' },
  { value: 'gcn', label: 'GameCube' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'ps4', label: 'PlayStation 4' },
];

async function openSettings() {
  settingsConfig = await api('/config');
  renderSettings();
  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('settings-status').textContent = '';
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
  settingsConfig = null;
}

function renderSettings() {
  renderEmulators();
  renderDirectories();
  renderPorts();
}

function renderEmulators() {
  const container = document.getElementById('emulator-list');
  const emulators = settingsConfig.emulators || {};

  container.innerHTML = Object.entries(emulators).map(([sys, emu]) => `
    <div class="emu-row" data-system="${sys}">
      <div class="emu-row-header">
        <span class="emu-system-label">${SYSTEM_NAMES[sys] || sys}</span>
        <input type="text" class="settings-input emu-name-input" data-field="name" value="${escapeAttr(emu.name || '')}" placeholder="Emulator name">
      </div>
      <div class="emu-fields">
        <div class="emu-field-row">
          <label>Path</label>
          <input type="text" class="settings-input" data-field="path" value="${escapeAttr(emu.path || '')}" placeholder="C:\\path\\to\\emulator.exe">
        </div>
        <div class="emu-field-row">
          <label>Args</label>
          <input type="text" class="settings-input" data-field="args" value="${escapeAttr(emu.args || '')}" placeholder='"{rom}"'>
        </div>
      </div>
    </div>
  `).join('');

  // Bind inputs
  container.querySelectorAll('.emu-row').forEach(row => {
    const sys = row.dataset.system;
    row.querySelectorAll('.settings-input').forEach(input => {
      input.addEventListener('input', () => {
        settingsConfig.emulators[sys][input.dataset.field] = input.value;
      });
    });
  });
}

function renderDirectories() {
  const container = document.getElementById('directory-list');
  const dirs = settingsConfig.rom_directories || [];

  container.innerHTML = dirs.map((dir, i) => `
    <div class="dir-row" data-index="${i}">
      <input type="text" class="settings-input" data-field="path" value="${escapeAttr(dir.path || '')}" placeholder="G:\\Myrient\\Nintendo - GameCube">
      <select data-field="system">
        ${SYSTEM_OPTIONS.map(s => `<option value="${s.value}" ${dir.system === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
      <button class="btn-remove" onclick="removeDirectory(${i})">✕</button>
    </div>
  `).join('');

  // Bind inputs
  container.querySelectorAll('.dir-row').forEach(row => {
    const i = parseInt(row.dataset.index);
    row.querySelector('input').addEventListener('input', (e) => {
      settingsConfig.rom_directories[i].path = e.target.value;
    });
    row.querySelector('select').addEventListener('change', (e) => {
      settingsConfig.rom_directories[i].system = e.target.value;
    });
  });
}

function addDirectory() {
  settingsConfig.rom_directories.push({ path: '', system: 'gb' });
  renderDirectories();
  // Focus the new input
  const inputs = document.querySelectorAll('#directory-list .dir-row:last-child input');
  if (inputs.length) inputs[0].focus();
}

function removeDirectory(index) {
  settingsConfig.rom_directories.splice(index, 1);
  renderDirectories();
}

function renderPorts() {
  const container = document.getElementById('port-list');
  const ports = settingsConfig.ports || [];

  container.innerHTML = ports.map((port, i) => `
    <div class="port-row" data-index="${i}">
      <div class="port-fields">
        <div class="port-field-row">
          <label>Name</label>
          <input type="text" class="settings-input" data-field="name" value="${escapeAttr(port.name || '')}" placeholder="Game title">
          <button class="btn-remove" onclick="removePort(${i})">✕</button>
        </div>
        <div class="port-field-row">
          <label>Path</label>
          <input type="text" class="settings-input" data-field="path" value="${escapeAttr(port.path || '')}" placeholder="C:\\path\\to\\game.exe">
        </div>
      </div>
    </div>
  `).join('');

  // Bind inputs
  container.querySelectorAll('.port-row').forEach(row => {
    const i = parseInt(row.dataset.index);
    row.querySelectorAll('.settings-input').forEach(input => {
      input.addEventListener('input', () => {
        settingsConfig.ports[i][input.dataset.field] = input.value;
      });
    });
  });
}

function addPort() {
  settingsConfig.ports.push({ name: '', path: '', system: 'port', cover: '' });
  renderPorts();
  const inputs = document.querySelectorAll('#port-list .port-row:last-child input');
  if (inputs.length) inputs[0].focus();
}

function removePort(index) {
  settingsConfig.ports.splice(index, 1);
  renderPorts();
}

async function saveSettings() {
  const btn = document.getElementById('settings-save');
  const status = document.getElementById('settings-status');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    await api('/config', { method: 'POST', body: settingsConfig });
    status.textContent = '✓ Saved';
    status.style.color = 'var(--green)';
    btn.textContent = 'Save';
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (e) {
    status.textContent = '✗ Failed to save';
    status.style.color = 'var(--red)';
    btn.textContent = 'Save';
    btn.disabled = false;
  }
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Event Listeners ----
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSystem = btn.dataset.system;
      document.getElementById('content-title').textContent =
        SYSTEM_NAMES[currentSystem] || currentSystem;
      loadGames();
    });
  });

  // Search
  let searchTimeout;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = e.target.value;
      loadGames();
    }, 200);
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    loadGames();
  });

  // Genre filter
  loadGenres();
  document.getElementById('genre-filter').addEventListener('change', (e) => {
    currentGenre = e.target.value;
    loadGames();
  });

  // Scan
  document.getElementById('btn-scan').addEventListener('click', scanLibrary);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById('btn-add-dir').addEventListener('click', addDirectory);
  document.getElementById('btn-add-port').addEventListener('click', addPort);

  // Settings tabs
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.settings-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', hideDetail);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideDetail();
  });
  document.getElementById('modal-play').addEventListener('click', launchGame);
  document.getElementById('modal-fav').addEventListener('click', toggleFavorite);
  document.getElementById('modal-rescrape').addEventListener('click', rescrapeGame);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('settings-overlay').classList.contains('hidden')) {
        closeSettings();
      } else {
        hideDetail();
      }
    }
    if (e.key === '/' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
  });

  // Initial load
  loadGames();
  loadStats();
});
