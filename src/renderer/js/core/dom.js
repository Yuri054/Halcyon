// Tiny DOM helpers and the inline icon set.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// Solid glyphs in the console's style, used instead of the line icons while the 360 theme is on.
const X360_ICONS = {
  'x-console': '<rect x="9.2" y="2.5" width="5.6" height="13.8" rx="1.1" fill="currentColor" stroke="none"/><rect x="9.2" y="17.6" width="5.6" height="3.9" rx="1.1" fill="currentColor" stroke="none"/>',
  'x-profile': '<path fill-rule="evenodd" d="M4 2.5h16v19H4zM6.2 4.7v14.6h11.6V4.7z" fill="currentColor" stroke="none"/><circle cx="12" cy="9.6" r="2.7" fill="currentColor" stroke="none"/><path d="M7.6 17.6c.5-2.8 2.3-4.3 4.4-4.3s3.9 1.5 4.4 4.3z" fill="currentColor" stroke="none"/>',
  'x-list': '<rect x="3" y="4.6" width="3" height="3" fill="currentColor" stroke="none"/><rect x="8.2" y="5.2" width="12.8" height="1.8" fill="currentColor" stroke="none"/><rect x="3" y="10.5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="8.2" y="11.1" width="12.8" height="1.8" fill="currentColor" stroke="none"/><rect x="3" y="16.4" width="3" height="3" fill="currentColor" stroke="none"/><rect x="8.2" y="17" width="12.8" height="1.8" fill="currentColor" stroke="none"/>',
  'x-power': '<path d="M12 2.8v8.4" stroke-width="2.6"/><path d="M6.2 6.4a8.3 8.3 0 1011.6 0" stroke-width="2.6"/>',
  'x-pin': '<path d="M14.6 2.6l6.8 6.8-1.6 1.6-1.3-.6-3.4 3.4.4 4.1-1.6 1.6-3.7-3.7-5.3 5.3-.9-.9 5.3-5.3-3.7-3.7 1.6-1.6 4.1.4 3.4-3.4-.6-1.3z" fill="currentColor" stroke="none"/>',
  'x-recent': '<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19zm-1.1 4.2v6.2l4.9 2.9 1-1.7-3.7-2.2V6.7z" fill="currentColor" stroke="none"/>',
  'x-games': '<path fill-rule="evenodd" d="M7.3 6.5h9.4c2.6 0 4.4 1.9 5 4.6l.9 4.3c.4 1.9-.8 3.5-2.4 3.5-1.1 0-1.8-.6-2.4-1.5l-1.2-1.7H7.4l-1.2 1.7c-.6.9-1.3 1.5-2.4 1.5-1.6 0-2.8-1.6-2.4-3.5l.9-4.3c.6-2.7 2.4-4.6 5-4.6zM6.4 9.4v1.6H4.8v1.6h1.6v1.6H8v-1.6h1.6V11H8V9.4zm9.9.3a1 1 0 100 2 1 1 0 000-2zm2.1 2.1a1 1 0 100 2 1 1 0 000-2z" fill="currentColor" stroke="none"/>',
  'x-apps': '<rect x="3" y="3" width="8.3" height="8.3" fill="currentColor" stroke="none"/><rect x="12.7" y="3" width="8.3" height="8.3" fill="currentColor" stroke="none"/><rect x="3" y="12.7" width="8.3" height="8.3" fill="currentColor" stroke="none"/><rect x="12.7" y="12.7" width="8.3" height="8.3" fill="currentColor" stroke="none"/>',
  'x-disc': '<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19zm0 6.6a2.9 2.9 0 100 5.8 2.9 2.9 0 000-5.8z" fill="currentColor" stroke="none"/>',
  'x-drive': '<path fill-rule="evenodd" d="M3 6h18v12H3zm11.5 7.6v1.8H19v-1.8z" fill="currentColor" stroke="none"/>',
  'x-people': '<circle cx="8.3" cy="7.3" r="3.1" fill="currentColor" stroke="none"/><path d="M2.4 18.8c.5-4 2.8-6.1 5.9-6.1s5.4 2.1 5.9 6.1z" fill="currentColor" stroke="none"/><circle cx="16.3" cy="8.6" r="2.6" fill="currentColor" stroke="none"/><path d="M15.4 12.9c.3 0 .6-.1.9-.1 2.7 0 4.7 1.8 5.2 5.4h-5.6c-.1-2.2-.3-3.9-.5-5.3z" fill="currentColor" stroke="none"/>',
  'x-lock': '<path fill-rule="evenodd" d="M7.3 10V7.8a4.7 4.7 0 019.4 0V10H18.6v11H5.4V10zm2.3 0h4.8V7.8a2.4 2.4 0 00-4.8 0z" fill="currentColor" stroke="none"/>',
  'x-tv': '<path fill-rule="evenodd" d="M2.5 4.5h19v12.5h-19zm2.1 2.1v8.3h14.8V6.6z" fill="currentColor" stroke="none"/><rect x="9" y="18.2" width="6" height="1.9" fill="currentColor" stroke="none"/>',
  'x-cloud': '<path d="M7 19a4.5 4.5 0 01-.6-9 6 6 0 0111.4 1.5A3.8 3.8 0 0117.5 19z" fill="currentColor" stroke="none"/>',
  'x-video': '<path fill-rule="evenodd" d="M2.5 5h19v14h-19zm7.2 3.6v6.8l5.8-3.4z" fill="currentColor" stroke="none"/>',
  'x-film': '<path fill-rule="evenodd" d="M3 4h18v16H3zm2 2v2h2V6zm12 0v2h2V6zM5 10v2h2v-2zm12 0v2h2v-2zM5 14v2h2v-2zm12 0v2h2v-2zM9 6v12h6V6z" fill="currentColor" stroke="none"/>',
  'x-music': '<path d="M9.5 4.5l10-2v12.8a3 3 0 11-2-2.8V7.3l-6 1.2v9.3a3 3 0 11-2-2.8z" fill="currentColor" stroke="none"/>',
  'x-trophy': '<path fill-rule="evenodd" d="M7 3h10v2h3.5v2.5a4.5 4.5 0 01-4.1 4.5 5 5 0 01-3.3 2.8V17H16v2.5H8V17h2.9v-2.2A5 5 0 017.6 12 4.5 4.5 0 013.5 7.5V5H7zm-1.6 4v.5c0 1.2.7 2.1 1.7 2.4C7 9 7 8 7 7zm13.2 0H17c0 1 0 2-.1 2.9 1-.3 1.7-1.2 1.7-2.4z" fill="currentColor" stroke="none"/>',
  'x-download': '<path d="M10.4 3h3.2v8.2h3.6L12 16.6l-5.2-5.4h3.6z" fill="currentColor" stroke="none"/><rect x="4" y="18.4" width="16" height="2.4" fill="currentColor" stroke="none"/>',
  'x-search': '<circle cx="10.3" cy="10.3" r="6" stroke-width="2.6"/><path d="M14.8 14.8l5.6 5.6" stroke-width="3"/>',
  'x-folder': '<path d="M2.5 5h7l2 2.2h10V19h-19z" fill="currentColor" stroke="none"/>',
  'x-plus': '<path d="M10.6 3.5h2.8v7.1h7.1v2.8h-7.1v7.1h-2.8v-7.1H3.5v-2.8h7.1z" fill="currentColor" stroke="none"/>',
  'x-gear': '<path fill-rule="evenodd" d="M10.4 2.5h3.2l.5 2.6 1.6.7 2.2-1.5 2.3 2.3-1.5 2.2.7 1.6 2.6.5v3.2l-2.6.5-.7 1.6 1.5 2.2-2.3 2.3-2.2-1.5-1.6.7-.5 2.6h-3.2l-.5-2.6-1.6-.7-2.2 1.5-2.3-2.3 1.5-2.2-.7-1.6-2.6-.5v-3.2l2.6-.5.7-1.6-1.5-2.2 2.3-2.3 2.2 1.5 1.6-.7zM12 8.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z" fill="currentColor" stroke="none"/>',
  'x-screen': '<path fill-rule="evenodd" d="M2.5 4.5h19v12.5h-19zm2.1 2.1v8.3h14.8V6.6z" fill="currentColor" stroke="none"/><rect x="9" y="18.2" width="6" height="1.9" fill="currentColor" stroke="none"/>',
};
// Which line icon each 360 glyph stands in for.
const X360_FOR = {
  pad: 'x-games', star: 'x-pin', starFill: 'x-pin', clock: 'x-recent', grid: 'x-apps', gear: 'x-gear', power: 'x-power', screen: 'x-tv', image: 'x-profile',
  cloud: 'x-cloud', video: 'x-video', film: 'x-film', music: 'x-music', folder: 'x-drive', download: 'x-download', search: 'x-search', plus: 'x-plus',
  list: 'x-list', user: 'x-profile', disc: 'x-disc', tv: 'x-tv', trophy: 'x-trophy',
};

const ICONS = {
  trophy: '<path d="M7 4h10v4a5 5 0 01-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 007.4 11M17 6h3v1.5a3.5 3.5 0 01-3.4 3.5M12 13v4M8.5 20h7M10 17h4"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9h17M3.5 15h17M8 5v14M16 5v14"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  video: '<rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/>',
  tv: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="M9 3l3 3 3-3"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z"/>',
  starFill: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z" fill="currentColor"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 000-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 00-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 00-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 000 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 002.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 002.6-1.5l2.3.9 2-3.4z"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1011.4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  folder: '<path d="M3.5 6.5a1 1 0 011-1h5l2 2.5h8a1 1 0 011 1v9.5a1 1 0 01-1 1h-15a1 1 0 01-1-1z"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
  pad: '<path d="M7.5 7.5h9a5 5 0 015 5v1.5a3 3 0 01-5.6 1.5l-.6-1h-6.6l-.6 1A3 3 0 012.5 14v-1.5a5 5 0 015-5z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".6" fill="currentColor"/><circle cx="18" cy="13.5" r=".6" fill="currentColor"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5" opacity=".5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5 3.8 3.8 0 01-.4 7.5z"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  pencil: '<path d="M4.5 19.5l1-4L16 5a2 2 0 013 3L8.5 18.5z"/>',
  trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 12.5h8L17 7"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 6.2A9 9 0 0121 12a9.800 9.800 0 01-2.700 3.600M14.800 17.500A9 9 0 013 12a9.800 9.800 0 013.300-4.100"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.200-5.300"/><path d="M19.500 4v4.500H15"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  terminal: '<rect x="3.500" y="5" width="17" height="14" rx="1.500"/><path d="M7.500 10l2.500 2.200-2.500 2.300M12.500 14.500h4"/>',
  screen: '<rect x="3.500" y="4.500" width="17" height="11.500" rx="1.500"/><path d="M8.500 20h7M12 16v4"/>',
  sound: '<path d="M4.500 9.500v5h3.500l4.500 4v-13l-4.500 4z"/><path d="M16 9a4.500 4.500 0 010 6M18.500 6.500a8 8 0 010 11"/>',
  palette: '<path d="M12 3.500a8.500 8.500 0 100 17c1.400 0 2-1 1.500-2.200-.600-1.500.400-2.800 2-2.800h1.500a3.500 3.500 0 003.500-3.500A8.500 8.500 0 0012 3.500z"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="11" cy="7.500" r="1" fill="currentColor"/><circle cx="15.500" cy="8.500" r="1" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500M12 7.700v.100"/>',
  warn: '<path d="M12 4l9 15.500H3z"/><path d="M12 10v4.500M12 16.800v.100"/>',
  heart: '<path d="M12 19.500S4 14.500 4 9a4 4 0 018-1 4 4 0 018 1c0 5.500-8 10.500-8 10.500z"/>',
  download: '<path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 19.500h14"/>',
  key: '<circle cx="8" cy="15" r="3.500"/><path d="M10.500 12.500L19 4M15.500 7.500l2.500 2.500M13 10l2 2"/>',
  link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1"/>',
  moon: '<path d="M19.5 14.5A8 8 0 019.5 4.500a8 8 0 1010 10z"/>',
  restart: '<path d="M4.500 12a7.500 7.500 0 102.200-5.300"/><path d="M4.500 4v4.500H9"/>',
  exit: '<path d="M10 4.500H5.500a1 1 0 00-1 1v13a1 1 0 001 1H10"/><path d="M14.500 8l4 4-4 4M18.500 12H9"/>',
  mute: '<path d="M4.500 9.500v5h3.500l4.500 4v-13l-4.500 4z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  login: '<path d="M14 4.500h4.500a1 1 0 011 1v13a1 1 0 01-1 1H14"/><path d="M10.500 8l4 4-4 4M14.500 12H4.500"/>',
  spark: '<path d="M12 3.500l1.800 5.200 5.200 1.800-5.200 1.800L12 17.500l-1.800-5.200L5 10.500l5.200-1.800z"/><path d="M18.500 16.500l.600 1.900 1.900.600-1.900.600-.600 1.900-.600-1.900-1.900-.600 1.900-.600z"/>',
  captions: '<rect x="3" y="5.500" width="18" height="13" rx="2"/><path d="M10.500 10.300a2.300 2.300 0 100 3.400M16.500 10.300a2.300 2.300 0 100 3.400"/>',
  shuffle: '<path d="M3 7h3.500c4.500 0 6.500 10 11 10H21M3 17h3.500c1.800 0 3-1.600 4.200-3.500M13.300 10.500C14.500 8.600 15.700 7 17.500 7H21"/><path d="M18.500 4.500L21 7l-2.500 2.500M18.500 14.500L21 17l-2.500 2.500"/>',
  user: '<circle cx="12" cy="8.500" r="3.800"/><path d="M4.500 20c1-3.800 4-5.800 7.500-5.800s6.500 2 7.500 5.800"/>',
  list: '<path d="M9 6.500h11M9 12h11M9 17.500h7"/><circle cx="4.800" cy="6.500" r="0.900"/><circle cx="4.800" cy="12" r="0.900"/><circle cx="4.800" cy="17.500" r="0.900"/>',
  disc: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="2.200"/>',
  home: '<path d="M4 11l8-7 8 7v8.500a1 1 0 01-1 1h-4.500v-6h-5v6H5a1 1 0 01-1-1z"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  // The 360 theme uses its own solid glyphs (named "x-..." directly, or standing in for a line icon).
  const x360 = typeof document !== 'undefined' && document.body?.dataset.theme === 'x360';
  const glyph = X360_ICONS[name] || (x360 && /\btile__icon\b/.test(cls) && X360_ICONS[X360_FOR[name]]);
  span.innerHTML = svg(glyph || ICONS[name] || '');
  return span;
}

/** Add a class for one animation pass, then take it off so re-renders do not replay it. */
export function flash(el, cls, ms = 1100) {
  clearTimeout(el._flash);
  el.classList.remove(...(el._flashCls || []));
  void el.offsetWidth;
  el.classList.add(cls);
  el._flashCls = [cls];
  el._flash = setTimeout(() => el.classList.remove(cls), ms);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hashHue(str) {
  let hsh = 0;
  for (let i = 0; i < str.length; i++) hsh = (hsh * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hsh) % 360;
}
