'use strict';
// A small diary of what Halcyon and the windows around it do, for working out
// timing problems (launches, the Guide over games). <config>/halcyon.log, kept short.
const fs = require('fs');
const path = require('path');

let file = null;
const MAX = 512 * 1024;

function init(dir) {
  file = path.join(dir, 'halcyon.log');
  try { if (fs.statSync(file).size > MAX) fs.renameSync(file, `${file}.old`); } catch { /* new log */ }
  log('---- Halcyon started');
}

function log(...parts) {
  if (!file) return;
  const t = new Date();
  const stamp = `${t.toTimeString().slice(0, 8)}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  const line = `${stamp} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  fs.appendFile(file, line, () => {});
}

module.exports = { init, log };
