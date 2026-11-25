'use strict';
// Parser for Valve's text KeyValues format (libraryfolders.vdf, appmanifest_*.acf, localconfig.vdf).

function parse(text) {
  let i = 0;
  const n = text.length;

  function token() {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return { brace: c }; }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[++i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else s += text[i];
        i++;
      }
      i++;
      return { str: s };
    }
    let s = '';
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return { str: s };
  }

  function object(top) {
    const obj = {};
    for (;;) {
      const key = token();
      if (!key) return obj;
      if (key.brace === '}') { if (top) continue; return obj; }
      if (key.brace) continue;
      const val = token();
      if (!val) return obj;
      if (val.brace === '{') obj[key.str] = object(false);
      else if (val.str !== undefined) obj[key.str] = val.str;
    }
  }

  return object(true);
}

/** Case-insensitive nested lookup — Valve is inconsistent about key casing. */
function get(obj, ...keys) {
  let cur = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    const want = String(key).toLowerCase();
    const hit = Object.keys(cur).find((k) => k.toLowerCase() === want);
    if (hit === undefined) return undefined;
    cur = cur[hit];
  }
  return cur;
}

module.exports = { parse, get };
