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

const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
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
  home: '<path d="M4 11l8-7 8 7v8.500a1 1 0 01-1 1h-4.500v-6h-5v6H5a1 1 0 01-1-1z"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.innerHTML = svg(ICONS[name] || '');
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
