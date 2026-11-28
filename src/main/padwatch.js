'use strict';
// Listens for the controller's Home button while a game has the screen.
// The dashboard cannot see controller input in the background, so this reads
// the kernel's input events directly, and only while a game is running.
const fs = require('fs');

const EV_KEY = 1;
const BTN_SELECT = 314;
const BTN_START = 315;
const BTN_MODE = 316;
// struct input_event: a timeval (two longs) then type, code, value.
const RECORD = ['x64', 'arm64', 'ppc64', 's390x', 'riscv64', 'loong64'].includes(process.arch) ? 24 : 16;

/** Event nodes of connected game controllers (the ones the kernel also exposes as jsN). */
function gamepadNodes() {
  if (process.env.HALCYON_PAD_DEVICES) return process.env.HALCYON_PAD_DEVICES.split(':').filter(Boolean);
  let text = '';
  try { text = fs.readFileSync('/proc/bus/input/devices', 'utf8'); } catch { return []; }
  const nodes = [];
  for (const block of text.split(/\n\s*\n/)) {
    const handlers = /^H: Handlers=(.*)$/m.exec(block);
    if (!handlers || !/\bjs\d+\b/.test(handlers[1])) continue;
    const event = /\bevent\d+\b/.exec(handlers[1]);
    if (event) nodes.push(`/dev/input/${event[0]}`);
  }
  return nodes;
}

class PadWatch {
  /** onPress(): Home pressed (or Select+Start together). onHold(): still held after holdMs. */
  constructor({ onPress, onHold, onConnect = () => {}, holdMs = 2000 }) {
    this.onPress = onPress;
    this.onConnect = onConnect;   // a controller was plugged in or switched on
    this.onHold = onHold;
    this.holdMs = holdMs;
    this.streams = new Map(); // node -> { fd, down:Set, rest:Buffer }
    this.buffer = Buffer.alloc(RECORD * 128);
    this.pump = null;
    this.unreadable = new Set();
    this.timer = null;
    this.holdTimer = null;
    this.holder = null;
  }

  get active() { return Boolean(this.timer); }
  /** True when at least one controller could be opened. */
  get listening() { return this.streams.size > 0; }

  start() {
    if (this.timer) return;
    this.rescan();
    this.started = true;   // controllers found from here on are new connections
    this.timer = setInterval(() => this.rescan(), 3000); // hot-plug
    this.timer.unref();
    // Devices are opened non-blocking and drained on a short timer. (Blocking reads would
    // each park one of the process's few I/O threads for as long as a pad sits idle.)
    this.pump = setInterval(() => this.drain(), 30);
    this.pump.unref();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.pump);
    this.timer = null;
    this.pump = null;
    this.release();
    for (const { fd } of this.streams.values()) { try { fs.closeSync(fd); } catch { /* already gone */ } }
    this.streams.clear();
    this.unreadable.clear();
  }

  rescan() {
    const nodes = gamepadNodes();
    for (const node of nodes) if (!this.streams.has(node) && !this.unreadable.has(node)) this.open(node);
  }

  open(node) {
    try {
      const fd = fs.openSync(node, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      this.streams.set(node, { fd, down: new Set(), rest: Buffer.alloc(0) });
      if (this.started) this.onConnect(node);
    } catch (err) {
      // No permission will not fix itself; anything else may (the pad is still settling).
      if (err.code === 'EACCES' || err.code === 'EPERM') this.unreadable.add(node);
    }
  }

  drop(node) {
    const entry = this.streams.get(node);
    if (!entry) return;
    try { fs.closeSync(entry.fd); } catch { /* already gone */ }
    this.streams.delete(node);
    if (this.holder === node) this.release();
  }

  drain() {
    for (const [node, entry] of this.streams) {
      // A busy pad (stick noise) can queue a lot between ticks: read until it runs dry.
      for (let i = 0; i < 16; i++) {
        let n = 0;
        try {
          n = fs.readSync(entry.fd, this.buffer, 0, this.buffer.length, null);
        } catch (err) {
          if (err.code !== 'EAGAIN') this.drop(node);   // unplugged
          break;
        }
        if (n <= 0) { if (n === 0 && !process.env.HALCYON_PAD_DEVICES) this.drop(node); break; }
        this.feed(node, entry, this.buffer.subarray(0, n));
        if (n < this.buffer.length) break;
      }
    }
  }

  feed(node, entry, chunk) {
    const data = entry.rest.length ? Buffer.concat([entry.rest, chunk]) : chunk;
    const keep = (buf) => Buffer.from(buf);   // the read buffer is reused, so copy any partial record
    let at = 0;
    for (; at + RECORD <= data.length; at += RECORD) {
      if (data.readUInt16LE(at + RECORD - 8) !== EV_KEY) continue;
      const code = data.readUInt16LE(at + RECORD - 6);
      const value = data.readInt32LE(at + RECORD - 4);
      if (code !== BTN_MODE && code !== BTN_SELECT && code !== BTN_START) continue;
      if (value === 1) {
        const chordBefore = entry.down.has(BTN_SELECT) && entry.down.has(BTN_START);
        entry.down.add(code);
        const chord = entry.down.has(BTN_SELECT) && entry.down.has(BTN_START);
        if (code === BTN_MODE || (chord && !chordBefore)) this.press(node);
      } else if (value === 0) {
        entry.down.delete(code);
        const stillHeld = entry.down.has(BTN_MODE) || (entry.down.has(BTN_SELECT) && entry.down.has(BTN_START));
        if (this.holder === node && !stillHeld) this.release();
      }
    }
    entry.rest = keep(data.subarray(at));
  }

  press(node) {
    this.release();
    this.holder = node;
    this.holdTimer = setTimeout(() => { this.holdTimer = null; this.holder = null; this.onHold(); }, this.holdMs);
    this.onPress();
  }

  release() {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.holder = null;
  }
}

module.exports = { PadWatch, gamepadNodes, RECORD };
