'use strict';
// Directory listing for the in-app (controller-friendly) file browser.
const fs = require('fs');
const path = require('path');
const { HOME, IMAGE_EXT, VIDEO_EXT, expandHome, isDir, mediaUrl } = require('./util');

function list(dir, mode = 'any') {
  let target = path.resolve(expandHome(dir || HOME));
  while (!isDir(target) && target !== '/') target = path.dirname(target);
  let entries = [];
  let error = null;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    error = err.code === 'EACCES' ? 'Permission denied' : err.message;
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(target, entry.name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) { dirs.push({ name: entry.name, path: full, dir: true }); continue; }
    if (mode === 'dir' || !st.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (mode === 'image' && !IMAGE_EXT.has(ext)) continue;
    if (mode === 'video' && !VIDEO_EXT.has(ext)) continue;
    if (mode === 'exec' && !(st.mode & 0o111)) continue;
    files.push({ name: entry.name, path: full, dir: false, preview: IMAGE_EXT.has(ext) ? mediaUrl(full) : null });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const places = [
    ['Home', HOME], ['Pictures', path.join(HOME, 'Pictures')], ['Downloads', path.join(HOME, 'Downloads')],
    ['Games', path.join(HOME, 'Games')], ['ROMs', path.join(HOME, 'ROMs')], ['Applications', path.join(HOME, 'Applications')],
    ['Media', '/media'], ['Mounts', '/mnt'], ['Root', '/'],
  ].filter(([, p]) => isDir(p)).map(([name, p]) => ({ name, path: p }));
  return {
    path: target,
    parent: target === '/' ? null : path.dirname(target),
    entries: [...dirs.sort(byName), ...files.sort(byName)],
    places,
    error,
  };
}

module.exports = { list };
