'use strict';
// Interface sound packs: folders of audio files in <config>/sounds/<pack>/.
// Packs made for the Steam Deck sound loader (pack.json with "mappings" from Deck
// sound names to the pack's files) work as they are; a "halcyon" object in
// pack.json, or a halcyon.json beside it, can map Halcyon's own events directly.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const AUDIO = /\.(wav|ogg|mp3|m4a|flac|opus)$/i;
const MAX_FILE = 12 * 1024 * 1024;
const MAX_PACK = 80 * 1024 * 1024;

/** Halcyon event -> Deck sound names to look for, best first. */
const DECK = {
  move: ['deck_ui_navigation.wav', 'deck_ui_tile_scroll.wav'],
  edge: ['deck_ui_bumper_end_02.wav', 'bumper_end.wav'],
  select: ['deck_ui_default_activation.wav', 'deck_ui_into_game_detail.wav'],
  back: ['deck_ui_out_of_game_detail.wav', 'deck_ui_hide_modal.wav'],
  sectionLeft: ['deck_ui_tab_transition_01.wav', 'deck_ui_side_menu_fly_in.wav'],
  sectionRight: ['deck_ui_side_menu_fly_out.wav', 'deck_ui_tab_transition_01.wav'],
  open: ['deck_ui_show_modal.wav'],
  guide: ['deck_ui_side_menu_fly_in.wav', 'deck_ui_show_modal.wav'],
  toast: ['deck_ui_toast.wav', 'deck_ui_message_toast.wav'],
  error: ['confirmation_negative.wav', 'deck_ui_bumper_end_02.wav'],
  launch: ['deck_ui_launch_game.wav'],
  wake: ['deck_ui_misc_10.wav'],
  download: ['deck_ui_achievement_toast.wav', 'deck_ui_toast.wav'],
  typing: ['deck_ui_typing.wav'],
  toggleOn: ['deck_ui_switch_toggle_on.wav'],
  toggleOff: ['deck_ui_switch_toggle_off.wav'],
  boot: [],
  // Played by the achievement overlay (not the page); also found by plain file name.
  achievement: ['deck_ui_achievement_toast.wav'],
  rareAchievement: [],
};
const BY_NAME = { achievement: ['Achievement.wav', 'achievement.wav'], rareAchievement: ['RareAchievementStart.wav', 'RareAchievement.wav', 'rare_achievement.wav'] };
const EVENTS = Object.keys(DECK);

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Only plain file names inside the pack folder are honoured. */
function inPack(dir, name) {
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  const file = path.join(dir, name);
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size <= MAX_FILE && AUDIO.test(name) ? file : null;
  } catch { return null; }
}

function manifest(dir) {
  const pack = readJson(path.join(dir, 'pack.json')) || {};
  const own = readJson(path.join(dir, 'halcyon.json')) || {};
  return { pack, own: { ...(pack.halcyon || {}), ...own } };
}

/** event -> absolute file path for one pack folder. */
function resolve(dir) {
  const { pack, own } = manifest(dir);
  const mappings = pack.mappings || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const out = {};
  for (const event of EVENTS) {
    let file = inPack(dir, first(own[event]));
    for (const deckName of DECK[event]) {
      if (file) break;
      file = inPack(dir, first(mappings[deckName]));
    }
    for (const name of BY_NAME[event] || []) {
      if (file) break;
      file = inPack(dir, name);
    }
    if (file) out[event] = file;
  }
  return out;
}

function list(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => {
    const dir = path.join(root, e.name);
    const { pack } = manifest(dir);
    return { id: e.name, name: pack.name || e.name, author: pack.author || '', events: Object.keys(resolve(dir)).length };
  }).filter((p) => p.events > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** { ok, name, sounds: { event: Buffer } } for the renderer to decode. */
async function load(root, id) {
  if (!id || id.includes('/') || id.startsWith('.')) return { ok: false, error: 'Unknown sound pack.' };
  const dir = path.join(root, id);
  const files = resolve(dir);
  if (!Object.keys(files).length) return { ok: false, error: 'That sound pack has no sounds Halcyon can use.' };
  const sounds = {};
  for (const [event, file] of Object.entries(files)) sounds[event] = await fsp.readFile(file);
  return { ok: true, name: manifest(dir).pack.name || id, sounds };
}

/** Copy a pack folder (audio files and its JSON only) into the sounds folder. */
async function importPack(root, src) {
  let entries;
  try { entries = await fsp.readdir(src, { withFileTypes: true }); } catch { return { ok: false, error: 'That folder could not be read.' }; }
  const keep = entries.filter((e) => e.isFile() && (AUDIO.test(e.name) || ['pack.json', 'halcyon.json', 'README.md'].includes(e.name)));
  let total = 0;
  for (const e of keep) total += (await fsp.stat(path.join(src, e.name))).size;
  if (total > MAX_PACK) return { ok: false, error: 'That folder is too large to be a sound pack.' };
  const base = (readJson(path.join(src, 'pack.json')) || {}).name || path.basename(src);
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound-pack';
  const dest = path.join(root, id);
  await fsp.mkdir(dest, { recursive: true });
  for (const e of keep) await fsp.copyFile(path.join(src, e.name), path.join(dest, e.name));
  const found = Object.keys(resolve(dest)).length;
  if (!found) { await fsp.rm(dest, { recursive: true, force: true }); return { ok: false, error: 'No sounds in that folder match a known sound pack layout.' }; }
  return { ok: true, id, name: base, events: found };
}

module.exports = { list, load, importPack, resolve, EVENTS };
