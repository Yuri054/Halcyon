'use strict';
// In the YouTube window: read the controller and ask Halcyon to press the TV remote's keys.
// D-pad or left stick: move (held: repeats). A: select. B: back. X: play / pause.
// (Home is watched by Halcyon itself and opens the Guide.)
const { ipcRenderer } = require('electron');

const BUTTONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'accept', 1: 'back', 2: 'playpause' };
const REPEATS = new Set(['up', 'down', 'left', 'right']);
const held = new Map();   // name -> { since, last }

function pressed(pad) {
  const now = new Set();
  for (const [i, name] of Object.entries(BUTTONS)) if (pad.buttons[i] && pad.buttons[i].pressed) now.add(name);
  const [x = 0, y = 0] = pad.axes;
  if (x < -0.6) now.add('left'); else if (x > 0.6) now.add('right');
  if (y < -0.6) now.add('up'); else if (y > 0.6) now.add('down');
  return now;
}

function tick() {
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p) => p && p.connected);
  const now = new Set();
  if (document.hasFocus()) for (const p of pads) for (const n of pressed(p)) now.add(n);
  const t = performance.now();
  for (const name of now) {
    const h = held.get(name);
    if (!h) { held.set(name, { since: t, last: t }); ipcRenderer.send('yt:key', name); continue; }
    if (REPEATS.has(name) && t - h.since > 400 && t - h.last > 110) { h.last = t; ipcRenderer.send('yt:key', name); }
  }
  for (const name of [...held.keys()]) if (!now.has(name)) held.delete(name);
  requestAnimationFrame(tick);
}

window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
