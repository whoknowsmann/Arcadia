// ============================================================
// Arcadia Gamepad Navigation
// Xbox Series X controller (standard mapping) over Bluetooth
// Uses the browser Gamepad API — no server-side dependencies
// ============================================================

const Gamepad = (() => {
  // ---- Xbox Standard Mapping (W3C "standard" layout) ----
  const BTN = {
    A: 0,          // Select / confirm
    B: 1,          // Back / cancel
    X: 2,          // (unused for now)
    Y: 3,          // Toggle favorite
    LB: 4,         // Previous system
    RB: 5,         // Next system
    LT: 6,         // (unused)
    RT: 7,         // (unused)
    SELECT: 8,     // (unused)
    START: 9,      // Open settings / scan
    L3: 10,        // (unused)
    R3: 11,        // (unused)
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
  };

  const AXIS = {
    LEFT_X: 0,
    LEFT_Y: 1,
    RIGHT_X: 2,
    RIGHT_Y: 3,
  };

  // ---- Config ----
  const DEADZONE = 0.4;            // Stick deadzone
  const REPEAT_DELAY = 400;        // ms before repeat starts
  const REPEAT_RATE = 120;         // ms between repeats
  const SCROLL_SPEED = 12;         // px per frame for right stick scroll

  // ---- State ----
  let active = false;
  let connected = false;
  let animFrameId = null;
  let focusedIndex = -1;           // Index in current card list
  let focusMode = 'grid';          // 'grid' | 'sidebar' | 'modal'
  let prevButtons = [];
  let prevAxes = [];
  let repeatTimers = {};           // For button/direction repeat

  // ---- Helpers ----

  function getGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  function isPressed(gp, btn) {
    return gp.buttons[btn] && gp.buttons[btn].pressed;
  }

  function wasPressed(btn) {
    return prevButtons[btn] === true;
  }

  function justPressed(gp, btn) {
    return isPressed(gp, btn) && !wasPressed(btn);
  }

  function getAxis(gp, axis) {
    const val = gp.axes[axis] || 0;
    return Math.abs(val) > DEADZONE ? val : 0;
  }

  function axisToDirection(gp) {
    const x = getAxis(gp, AXIS.LEFT_X);
    const y = getAxis(gp, AXIS.LEFT_Y);
    return { x: Math.sign(x) * (x !== 0 ? 1 : 0), y: Math.sign(y) * (y !== 0 ? 1 : 0) };
  }

  // Repeat system: fires once on press, then repeats after delay
  function handleRepeat(key, isActive, callback) {
    if (isActive) {
      if (!repeatTimers[key]) {
        callback(); // Fire immediately
        repeatTimers[key] = {
          phase: 'delay',
          timer: setTimeout(() => {
            repeatTimers[key].phase = 'repeat';
            repeatTimers[key].timer = setInterval(callback, REPEAT_RATE);
          }, REPEAT_DELAY),
        };
      }
    } else {
      if (repeatTimers[key]) {
        clearTimeout(repeatTimers[key].timer);
        clearInterval(repeatTimers[key].timer);
        delete repeatTimers[key];
      }
    }
  }

  // ---- Focus Management ----

  function getCards() {
    return Array.from(document.querySelectorAll('.game-card'));
  }

  function getGridColumns() {
    const grid = document.getElementById('game-grid');
    if (!grid || !grid.children.length) return 1;
    const gridStyle = window.getComputedStyle(grid);
    const cols = gridStyle.getPropertyValue('grid-template-columns').split(' ').length;
    return cols || 1;
  }

  function getSidebarItems() {
    return Array.from(document.querySelectorAll('.nav-item'));
  }

  function setFocus(index) {
    const cards = getCards();
    // Remove old focus
    document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));

    if (cards.length === 0) return;

    focusedIndex = Math.max(0, Math.min(index, cards.length - 1));
    const card = cards[focusedIndex];
    card.classList.add('gamepad-focus');

    // Scroll into view
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setSidebarFocus(index) {
    const items = getSidebarItems();
    document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));

    if (items.length === 0) return;
    const i = Math.max(0, Math.min(index, items.length - 1));
    focusedIndex = i;
    items[i].classList.add('gamepad-focus');
    items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- Navigation Actions ----

  function navigateGrid(dx, dy) {
    const cards = getCards();
    if (cards.length === 0) return;

    const cols = getGridColumns();

    if (focusedIndex < 0) {
      setFocus(0);
      return;
    }

    let newIndex = focusedIndex;

    if (dx !== 0) {
      newIndex += dx;
    }
    if (dy !== 0) {
      newIndex += dy * cols;
    }

    // Clamp
    newIndex = Math.max(0, Math.min(newIndex, cards.length - 1));
    setFocus(newIndex);
  }

  function navigateSidebar(dy) {
    const items = getSidebarItems();
    if (items.length === 0) return;

    let newIndex = focusedIndex + dy;
    newIndex = Math.max(0, Math.min(newIndex, items.length - 1));
    setSidebarFocus(newIndex);
  }

  function activateSidebarItem() {
    const items = getSidebarItems();
    if (focusedIndex >= 0 && focusedIndex < items.length) {
      items[focusedIndex].click();
      // Switch back to grid after selection
      switchToGrid();
    }
  }

  function switchToSidebar() {
    focusMode = 'sidebar';
    const items = getSidebarItems();
    // Focus the currently active item
    const activeIndex = items.findIndex(el => el.classList.contains('active'));
    focusedIndex = activeIndex >= 0 ? activeIndex : 0;
    document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));
    setSidebarFocus(focusedIndex);
    updateHints();
  }

  function switchToGrid() {
    focusMode = 'grid';
    document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));
    focusedIndex = 0;
    const cards = getCards();
    if (cards.length > 0) {
      setFocus(0);
    }
    updateHints();
  }

  function openFocusedGame() {
    const cards = getCards();
    if (focusedIndex >= 0 && focusedIndex < cards.length) {
      const id = parseInt(cards[focusedIndex].dataset.id);
      if (id) {
        showDetail(id); // Calls the global function from app.js
        focusMode = 'modal';
        updateHints();
      }
    }
  }

  function cycleSystem(direction) {
    const items = getSidebarItems();
    const activeIndex = items.findIndex(el => el.classList.contains('active'));
    let newIndex = activeIndex + direction;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;
    items[newIndex].click();

    // Reset grid focus after system change
    setTimeout(() => {
      if (focusMode === 'grid') {
        focusedIndex = 0;
        const cards = getCards();
        if (cards.length > 0) setFocus(0);
      }
    }, 100);
  }

  // ---- Modal Controls ----

  function handleModalInput(gp) {
    // A = play
    if (justPressed(gp, BTN.A)) {
      document.getElementById('modal-play').click();
    }
    // Y = favorite
    if (justPressed(gp, BTN.Y)) {
      document.getElementById('modal-fav').click();
    }
    // B = close
    if (justPressed(gp, BTN.B)) {
      hideDetail(); // Global from app.js
      focusMode = 'grid';
      updateHints();
    }
  }

  // ---- Main Poll Loop ----

  function poll() {
    const gp = getGamepad();
    if (!gp) {
      animFrameId = requestAnimationFrame(poll);
      return;
    }

    // Check if any modal is open
    const modalOpen = !document.getElementById('modal-overlay').classList.contains('hidden');
    const settingsOpen = !document.getElementById('settings-overlay').classList.contains('hidden');

    if (settingsOpen) {
      // B closes settings
      if (justPressed(gp, BTN.B)) {
        closeSettings(); // Global from app.js
      }
      savePrevState(gp);
      animFrameId = requestAnimationFrame(poll);
      return;
    }

    if (modalOpen) {
      focusMode = 'modal';
      handleModalInput(gp);
      savePrevState(gp);
      animFrameId = requestAnimationFrame(poll);
      return;
    }

    // If modal just closed, return to grid
    if (focusMode === 'modal') {
      focusMode = 'grid';
      updateHints();
    }

    // ---- D-pad and stick navigation with repeat ----
    const dpadUp = isPressed(gp, BTN.DPAD_UP);
    const dpadDown = isPressed(gp, BTN.DPAD_DOWN);
    const dpadLeft = isPressed(gp, BTN.DPAD_LEFT);
    const dpadRight = isPressed(gp, BTN.DPAD_RIGHT);
    const stick = axisToDirection(gp);

    const up = dpadUp || stick.y < 0;
    const down = dpadDown || stick.y > 0;
    const left = dpadLeft || stick.x < 0;
    const right = dpadRight || stick.x > 0;

    if (focusMode === 'grid') {
      handleRepeat('up', up, () => navigateGrid(0, -1));
      handleRepeat('down', down, () => navigateGrid(0, 1));
      handleRepeat('left', left, () => navigateGrid(-1, 0));
      handleRepeat('right', right, () => navigateGrid(1, 0));

      // A = open game detail
      if (justPressed(gp, BTN.A)) {
        openFocusedGame();
      }

      // B = (no-op at top level, or could switch to sidebar)

    } else if (focusMode === 'sidebar') {
      handleRepeat('up', up, () => navigateSidebar(-1));
      handleRepeat('down', down, () => navigateSidebar(1));

      // A = select system
      if (justPressed(gp, BTN.A)) {
        activateSidebarItem();
      }

      // B = back to grid
      if (justPressed(gp, BTN.B)) {
        switchToGrid();
      }

      // Right = back to grid
      if (justPressed(gp, BTN.DPAD_RIGHT) || (stick.x > 0 && !wasPressed('stickRight'))) {
        switchToGrid();
      }
    }

    // ---- Global controls (work in both grid and sidebar) ----

    // LB / RB = cycle system
    if (justPressed(gp, BTN.LB)) cycleSystem(-1);
    if (justPressed(gp, BTN.RB)) cycleSystem(1);

    // Y = toggle favorite on focused game (grid mode)
    if (justPressed(gp, BTN.Y) && focusMode === 'grid') {
      const cards = getCards();
      if (focusedIndex >= 0 && focusedIndex < cards.length) {
        const id = parseInt(cards[focusedIndex].dataset.id);
        if (id) {
          fetch(`/api/games/${id}/favorite`, { method: 'POST' })
            .then(() => { loadGames(); loadStats(); });
        }
      }
    }

    // Left on grid (at column 0) = switch to sidebar
    if (focusMode === 'grid' && (justPressed(gp, BTN.DPAD_LEFT) || (stick.x < 0 && !wasPressed('stickLeft')))) {
      const cols = getGridColumns();
      if (focusedIndex % cols === 0) {
        switchToSidebar();
      }
    }

    // Start = open settings
    if (justPressed(gp, BTN.START)) {
      openSettings(); // Global from app.js
    }

    // Right stick = scroll content area
    const scrollY = getAxis(gp, AXIS.RIGHT_Y);
    if (scrollY !== 0) {
      const content = document.getElementById('content');
      content.scrollTop += scrollY * SCROLL_SPEED;
    }

    savePrevState(gp);
    animFrameId = requestAnimationFrame(poll);
  }

  function savePrevState(gp) {
    prevButtons = gp.buttons.map(b => b.pressed);
    prevAxes = [...gp.axes];
    // Track stick directions as virtual buttons for justPressed logic
    prevButtons['stickLeft'] = getAxis(gp, AXIS.LEFT_X) < 0;
    prevButtons['stickRight'] = getAxis(gp, AXIS.LEFT_X) > 0;
  }

  // ---- HUD / Visual Feedback ----

  function createHUD() {
    const hud = document.createElement('div');
    hud.id = 'gamepad-hud';
    hud.innerHTML = `
      <div id="gamepad-status">
        <span id="gamepad-icon">🎮</span>
        <span id="gamepad-label">Controller Connected</span>
      </div>
      <div id="gamepad-hints"></div>
    `;
    document.body.appendChild(hud);
  }

  function showHUD() {
    const hud = document.getElementById('gamepad-hud');
    if (hud) {
      hud.classList.add('visible');
      updateHints();
    }
  }

  function hideHUD() {
    const hud = document.getElementById('gamepad-hud');
    if (hud) hud.classList.remove('visible');
  }

  function updateHints() {
    const hints = document.getElementById('gamepad-hints');
    if (!hints) return;

    if (focusMode === 'grid') {
      hints.innerHTML = `
        <span class="gp-hint"><kbd>A</kbd> Select</span>
        <span class="gp-hint"><kbd>Y</kbd> Favorite</span>
        <span class="gp-hint"><kbd>LB</kbd><kbd>RB</kbd> System</span>
        <span class="gp-hint"><kbd>Start</kbd> Settings</span>
      `;
    } else if (focusMode === 'sidebar') {
      hints.innerHTML = `
        <span class="gp-hint"><kbd>A</kbd> Select</span>
        <span class="gp-hint"><kbd>B</kbd> Back</span>
        <span class="gp-hint"><kbd>↕</kbd> Navigate</span>
      `;
    } else if (focusMode === 'modal') {
      hints.innerHTML = `
        <span class="gp-hint"><kbd>A</kbd> Play</span>
        <span class="gp-hint"><kbd>Y</kbd> Favorite</span>
        <span class="gp-hint"><kbd>B</kbd> Close</span>
      `;
    }
  }

  // ---- Lifecycle ----

  function init() {
    if (!('getGamepads' in navigator)) {
      console.log('[Gamepad] API not supported');
      return;
    }

    createHUD();

    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[Gamepad] Connected: ${e.gamepad.id}`);
      connected = true;
      showHUD();

      if (!active) {
        active = true;
        focusMode = 'grid';
        focusedIndex = 0;
        const cards = getCards();
        if (cards.length > 0) setFocus(0);
        poll();
      }
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log(`[Gamepad] Disconnected: ${e.gamepad.id}`);
      connected = false;
      hideHUD();

      // Clean up focus styling
      document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));

      // Clear repeat timers
      Object.keys(repeatTimers).forEach(key => {
        clearTimeout(repeatTimers[key].timer);
        clearInterval(repeatTimers[key].timer);
      });
      repeatTimers = {};
    });

    // Check if already connected (e.g. page refresh with controller on)
    const gp = getGamepad();
    if (gp) {
      connected = true;
      active = true;
      showHUD();
      poll();
    }
  }

  return { init };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  Gamepad.init();
});
