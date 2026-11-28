// Controller + keyboard input, normalised into dashboard actions:
//   up down left right accept back x y lb rb lt rt start select guide
// Gamepads are polled every frame (hot-plug safe); held directions auto-repeat.

// rup / rdown: the right stick pushed up or down (volume in the player).
const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'lt', 'rt', 'rup', 'rdown']);
const REPEAT_DELAY = 380;
const REPEAT_FAST_AFTER = 1400;
const STICK_ON = 0.55;
const TRIGGER_ON = 0.5;

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'accept', ' ': 'accept', Escape: 'back', Backspace: 'back',
  q: 'lb', e: 'rb', PageUp: 'lt', PageDown: 'rt',
  f: 'x', Tab: 'y', m: 'y', '/': 'start', Home: 'select', g: 'guide', F1: 'guide', '+': 'rup', '=': 'rup', '-': 'rdown',
};

const listeners = { action: () => {}, pads: () => {}, mode: () => {}, activity: () => {}, backgroundGuide: () => {} };
let rawKeyHook = null;       // (KeyboardEvent) => boolean, lets text entry claim keys
let windowFocused = true;
let mode = 'keys';
const held = new Map();      // action -> { since, next }
let knownPads = '';
// Buttons already held when Halcyon first looks (or when a controller connects) are taken as
// held, not pressed: some controllers report a button as down at that moment, which would
// otherwise act at once (pick the first thing on screen, start a game...).
let armed = false;

function setMode(next) {
  if (mode === next) return;
  mode = next;
  document.body.dataset.input = next;
  listeners.mode(next);
}

function readPad(pad) {
  const b = (i) => Boolean(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > TRIGGER_ON));
  const ax = (i) => pad.axes[i] || 0;
  const s = {};
  if (pad.mapping === 'standard') {
    s.accept = b(0); s.back = b(1); s.x = b(2); s.y = b(3);
    s.lb = b(4); s.rb = b(5); s.lt = b(6); s.rt = b(7);
    s.select = b(8); s.start = b(9); s.guide = b(16);
    s.up = b(12) || ax(1) < -STICK_ON;
    s.down = b(13) || ax(1) > STICK_ON;
    s.left = b(14) || ax(0) < -STICK_ON;
    s.right = b(15) || ax(0) > STICK_ON;
    s.rup = ax(3) < -STICK_ON;
    s.rdown = ax(3) > STICK_ON;
  } else {
    // Unmapped Linux joystick layout (xpad-style): hat on the last two axes, triggers as axes.
    const n = pad.axes.length;
    const hatX = n >= 8 ? ax(6) : n >= 6 ? ax(n - 2) : 0;
    const hatY = n >= 8 ? ax(7) : n >= 6 ? ax(n - 1) : 0;
    s.accept = b(0); s.back = b(1); s.x = b(2); s.y = b(3);
    s.lb = b(4); s.rb = b(5);
    s.lt = n >= 6 && ax(2) > 0; s.rt = n >= 6 && ax(5) > 0;
    s.select = b(6); s.start = b(7); s.guide = b(8);
    s.up = hatY < -0.5 || ax(1) < -STICK_ON;
    s.down = hatY > 0.5 || ax(1) > STICK_ON;
    s.left = hatX < -0.5 || ax(0) < -STICK_ON;
    s.right = hatX > 0.5 || ax(0) > STICK_ON;
    s.rup = n >= 5 && ax(4) < -STICK_ON;
    s.rdown = n >= 5 && ax(4) > STICK_ON;
  }
  return s;
}

function poll(now) {
  requestAnimationFrame(poll);
  const pads = [...navigator.getGamepads()].filter((p) => p && p.connected);

  const sig = pads.map((p) => `${p.index}:${p.id}`).join('|');
  if (sig !== knownPads) {
    const before = knownPads;
    knownPads = sig;
    armed = false;
    listeners.pads(pads.map((p) => ({ index: p.index, id: p.id, name: cleanName(p.id) })), before !== '' || pads.length > 0);
  }

  const state = {};
  for (const pad of pads) {
    for (const [action, on] of Object.entries(readPad(pad))) if (on) state[action] = true;
  }

  if (!armed) {
    for (const action of Object.keys(state)) held.set(action, { since: now, next: now + REPEAT_DELAY });
    armed = true;
    return;
  }

  // While the window is in the background (a game is running) track state but
  // never act, so a button held when focus returns does not fire.
  const live = isLive();
  for (const action of Object.keys(state)) {
    const h = held.get(action);
    if (!h) {
      held.set(action, { since: now, next: now + REPEAT_DELAY });
      if (live) { setMode('pad'); listeners.action(action, false); }
      // The one thing a background press may do: call up the in-game menu.
      else if (action === 'guide') listeners.backgroundGuide();
    } else if (live && REPEATABLE.has(action) && now >= h.next) {
      h.next = now + (now - h.since > REPEAT_FAST_AFTER ? 70 : 115);
      listeners.action(action, true);
    }
  }
  for (const action of [...held.keys()]) if (!state[action]) held.delete(action);
}

function cleanName(id) {
  return id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*$/i, '').replace(/\s*\(.*?\)\s*$/, '').trim() || 'Controller';
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (rawKeyHook && rawKeyHook(e)) e.preventDefault();
    return;
  }
  if (rawKeyHook && rawKeyHook(e)) { e.preventDefault(); setMode('keys'); return; }
  const action = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  if (e.repeat && !REPEATABLE.has(action)) return;
  setMode('keys');
  listeners.action(action, e.repeat);
}

export function init({ onAction, onPads, onMode, onActivity, onBackgroundGuide }) {
  listeners.activity = onActivity || listeners.activity;
  listeners.backgroundGuide = onBackgroundGuide || listeners.backgroundGuide;
  listeners.action = onAction;
  listeners.pads = onPads || listeners.pads;
  listeners.mode = onMode || listeners.mode;
  document.body.dataset.input = mode;
  window.addEventListener('keydown', onKeyDown);
  // The pointer shows only while the mouse is actually in use.
  let cursorTimer = null;
  window.addEventListener('mousemove', () => {
    if (alwaysLive) return;   // an automated run must not be steered by the real mouse
    setMode('mouse');
    listeners.activity();
    document.body.classList.remove('cursor-idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-idle'), 2500);
  }, { passive: true });
  window.addEventListener('gamepadconnected', () => {});   // presence of a listener makes Chromium surface pads promptly
  window.addEventListener('gamepaddisconnected', () => {});
  window.addEventListener('blur', () => { windowFocused = false; });
  window.addEventListener('focus', () => { windowFocused = true; });
  requestAnimationFrame(poll);
}

let alwaysLive = false;
/** Whether input should act right now: only while Halcyon is the focused window. */
export const isLive = () => alwaysLive || (windowFocused && document.hasFocus());
/** Automated tests drive the UI without owning the desktop's focus. */
export const setAlwaysLive = (on) => { alwaysLive = Boolean(on); };

export const setRawKeyHook = (fn) => { rawKeyHook = fn; };
export const getMode = () => mode;

export function rumble(ms = 120, strength = 0.5) {
  for (const pad of navigator.getGamepads()) {
    try {
      pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, weakMagnitude: strength, strongMagnitude: strength * 0.6 });
    } catch { /* not supported on this pad */ }
  }
}

/** Glyph text for an action in the current input mode. */
export function glyph(action) {
  const arrows = { left: '◀', right: '▶', up: '▲', down: '▼', rup: mode === 'pad' ? 'R▲' : '+', rdown: mode === 'pad' ? 'R▼' : '−' };
  if (arrows[action]) return arrows[action];
  const pad = { accept: 'A', back: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: '☰', select: '⧉', guide: '⌂' };
  const keys = { accept: 'Enter', back: 'Esc', x: 'F', y: 'Tab', lb: 'Q', rb: 'E', lt: 'PgUp', rt: 'PgDn', start: '/', select: 'Home', guide: 'G' };
  return (mode === 'pad' ? pad : keys)[action] || action;
}
