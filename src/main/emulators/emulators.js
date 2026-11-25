'use strict';
// Emulator integration: find emulator executables, discover ROM folders
// (conventions + the emulators' own config files), and scan them for games.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EMULATORS, SYSTEMS } = require('./catalog');
const {
  HOME, IMAGE_EXT, expandHome, isDir, isExecutableFile, realpath, which,
  flatpakInstalled, splitArgs, mediaUrl, uniqueBy,
} = require('../util');

const APPIMAGE_DIRS = ['Applications', 'AppImages', '.local/bin', 'bin', 'Games'].map((d) => path.join(HOME, d));
if (process.env.HALCYON_INSTALL_DIR) APPIMAGE_DIRS.unshift(process.env.HALCYON_INSTALL_DIR);
const ROM_ROOTS = ['ROMs', 'roms', 'Roms', 'Games/ROMs', 'Games/roms', 'Emulation/roms', 'Emulation/Roms',
  'Documents/Emulation/Roms', 'Documents/ROMs', 'RetroPie/roms', 'retrodeck/roms'].map((d) => path.join(HOME, d));
const MAX_DEPTH = 4;
const MAX_FILES_PER_SYSTEM = 4000;

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- detection

function findAppImage(pattern) {
  for (const dir of APPIMAGE_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (/\.appimage$/i.test(entry.name) && pattern.test(entry.name) && isExecutableFile(full)) return full;
      // One level down: ~/Applications/Ryujinx/ryujinx-x64.AppImage
      if (entry.isDirectory() && pattern.test(entry.name)) {
        try {
          for (const name of fs.readdirSync(full)) {
            const inner = path.join(full, name);
            if (/\.appimage$/i.test(name) && isExecutableFile(inner)) return inner;
          }
        } catch { /* unreadable dir */ }
      }
    }
  }
  return null;
}

function detectEmulator(def, cfg = {}) {
  const base = {
    id: def.id, name: def.name, customPath: cfg.path || '', customArgs: cfg.args || '', defaultArgs: def.args.join(' '),
    repo: def.repo || null, page: def.home || (def.repo ? `https://github.com/${def.repo}` : null),
  };
  if (cfg.path) {
    const p = expandHome(cfg.path);
    return isExecutableFile(p)
      ? { ...base, found: true, via: 'custom', argv: [p], display: p }
      : { ...base, found: false, via: 'custom', argv: null, display: p, issue: 'Configured executable is missing or not executable' };
  }
  for (const bin of def.bins) {
    const hit = which(bin);
    if (hit) return { ...base, found: true, via: 'system', argv: [hit], display: hit };
  }
  if (def.flatpak && flatpakInstalled(def.flatpak)) {
    return { ...base, found: true, via: 'flatpak', argv: ['flatpak', 'run', def.flatpak], display: `Flatpak · ${def.flatpak}` };
  }
  const appimage = def.appimage && findAppImage(def.appimage);
  if (appimage) return { ...base, found: true, via: 'appimage', argv: [appimage], display: appimage };
  return { ...base, found: false, via: null, argv: null, display: 'Not installed', issue: `${def.name} was not found` };
}

function findRetroArchCore(system, preferred) {
  const dirs = [
    path.join(HOME, '.config/retroarch/cores'),
    path.join(HOME, '.var/app/org.libretro.RetroArch/config/retroarch/cores'),
    path.join(HOME, 'snap/retroarch/current/.config/retroarch/cores'),
    '/usr/lib/libretro', '/usr/lib/x86_64-linux-gnu/libretro', '/usr/lib64/libretro', '/usr/local/lib/libretro',
  ];
  const names = [preferred, ...system.cores].filter(Boolean);
  for (const name of names) {
    if (name.includes('/')) { if (fs.existsSync(expandHome(name))) return expandHome(name); continue; }
    for (const dir of dirs) {
      const file = path.join(dir, `${name}_libretro.so`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

// ------------------------------------------------------- ROM dir discovery

/** Game folders the emulators themselves are configured with: [{ system, dir }]. */
function dirsFromEmulatorConfigs() {
  const out = [];
  const add = (system, dir) => { if (dir && isDir(expandHome(dir.trim()))) out.push({ system, dir: expandHome(dir.trim()) }); };
  const cfgDirs = (native, flatpakId, sub) => [
    path.join(HOME, '.config', native),
    path.join(HOME, '.var/app', flatpakId, 'config', sub || native),
  ];

  for (const dir of cfgDirs('Cemu', 'info.cemu.Cemu')) {
    const xml = readText(path.join(dir, 'settings.xml'));
    const block = xml && /<GamePaths>([\s\S]*?)<\/GamePaths>/.exec(xml);
    if (block) for (const m of block[1].matchAll(/<Entry>([^<]+)<\/Entry>/g)) add('wiiu', m[1]);
  }
  for (const dir of [...cfgDirs('Ryujinx', 'io.github.ryubing.Ryujinx'), ...cfgDirs('Ryujinx', 'org.ryujinx.Ryujinx')]) {
    try {
      const json = JSON.parse(readText(path.join(dir, 'Config.json')));
      for (const d of json.game_dirs || []) add('switch', d);
    } catch { /* absent or unreadable */ }
  }
  for (const dir of cfgDirs('dolphin-emu', 'org.DolphinEmu.dolphin-emu')) {
    const ini = readText(path.join(dir, 'Dolphin.ini'));
    if (ini) for (const m of ini.matchAll(/^ISOPath\d+\s*=\s*(.+)$/gm)) add(/wii/i.test(m[1]) ? 'wii' : 'gc', m[1]);
  }
  const iniPaths = (file, system) => {
    const ini = readText(file);
    if (ini) for (const m of ini.matchAll(/^(?:Recursive)?Paths\s*=\s*(.+)$/gm)) add(system, m[1]);
  };
  iniPaths(path.join(HOME, '.config/PCSX2/inis/PCSX2.ini'), 'ps2');
  iniPaths(path.join(HOME, '.var/app/net.pcsx2.PCSX2/config/PCSX2/inis/PCSX2.ini'), 'ps2');
  iniPaths(path.join(HOME, '.local/share/duckstation/settings.ini'), 'psx');
  iniPaths(path.join(HOME, '.var/app/org.duckstation.DuckStation/config/duckstation/settings.ini'), 'psx');
  return out;
}

function esdeRomDir() {
  const xml = readText(path.join(HOME, 'ES-DE/settings/es_settings.xml'));
  const m = xml && /name="ROMDirectory"\s+value="([^"]+)"/.exec(xml);
  return m ? expandHome(m[1]) : null;
}

/** system id -> Set of directories to scan. */
function collectRomDirs(config) {
  const fromConfigs = dirsFromEmulatorConfigs();
  const roots = uniqueBy([
    ...(config.romRoots || []).map(expandHome),
    ...ROM_ROOTS,
    esdeRomDir(),
    ...fromConfigs.map((e) => path.dirname(e.dir)),
  ].filter((r) => r && isDir(r)), (r) => realpath(r));

  const map = new Map(SYSTEMS.map((s) => [s.id, { auto: [], user: [] }]));
  const aliasToSystem = new Map();
  for (const s of SYSTEMS) for (const a of [s.id, s.short, ...s.aliases]) aliasToSystem.set(a.toLowerCase().replace(/[\s_-]/g, ''), s.id);

  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const sys = aliasToSystem.get(entry.name.toLowerCase().replace(/[\s_-]/g, ''));
      if (sys && isDir(path.join(root, entry.name))) map.get(sys).auto.push(path.join(root, entry.name));
    }
  }
  for (const { system, dir } of fromConfigs) map.get(system).auto.push(dir);
  for (const [id, cfg] of Object.entries(config.systems || {})) {
    if (map.has(id)) map.get(id).user.push(...(cfg.romDirs || []).map(expandHome));
  }
  for (const entry of map.values()) {
    entry.user = uniqueBy(entry.user, (d) => d);
    entry.auto = uniqueBy(entry.auto.filter((d) => !entry.user.includes(d)), (d) => realpath(d));
  }
  return { map, roots };
}

// ------------------------------------------------------------------ scanning

function prettyName(raw) {
  const tags = [...raw.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1].trim());
  const name = raw.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
    // No-Intro style "Legend of Zelda, The - ..." -> "The Legend of Zelda - ..."
    .replace(/^([^,]+), (The|A|An)\b/, '$2 $1');
  return { name: name || raw, tags };
}

async function walk(dir, depth, onFile, budget) {
  if (depth > MAX_DEPTH || budget.left <= 0) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try { const st = await fsp.stat(full); isDirectory = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
    }
    if (isDirectory) await walk(full, depth + 1, onFile, budget);
    else if (isFile) { budget.left--; onFile(full, entry.name); if (budget.left <= 0) return; }
  }
}

function findRomArt(romPath, base, system) {
  const romDir = path.dirname(romPath);
  const names = [system.id, system.short.toLowerCase(), ...system.aliases];
  const media = [path.join(HOME, 'ES-DE/downloaded_media'), path.join(HOME, '.emulationstation/downloaded_media')];
  const first = (dirs) => {
    for (const dir of dirs) {
      for (const ext of IMAGE_EXT) {
        const file = path.join(dir, base + ext);
        if (fs.existsSync(file)) return [mediaUrl(file)];
      }
    }
    return [];
  };
  const esde = (kinds) => media.flatMap((m) => names.flatMap((n) => kinds.map((k) => path.join(m, n, k))));
  const local = (kinds) => kinds.flatMap((k) => [path.join(romDir, k), path.join(romDir, 'media', k)]);
  const cover = first([...esde(['covers', 'miximages', '3dboxes', 'titlescreens']), ...local(['covers', 'boxart', 'images']), romDir]);
  const hero = first([...esde(['fanart', 'screenshots']), ...local(['fanart', 'screenshots', 'backgrounds'])]);
  const logo = first([...esde(['marquees']), ...local(['marquees', 'logos'])]);
  return { cover, hero: hero.length ? hero : [], logo, header: [] };
}

async function scanSystem(system, dirs) {
  const exts = new Set(system.ext);
  const special = new Set(system.special || []);
  const games = [];
  const seen = new Set();
  const budget = { left: MAX_FILES_PER_SYSTEM };

  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    await walk(dir, 0, (full, fileName) => {
      const lower = fileName.toLowerCase();
      const ext = path.extname(lower).slice(1);
      let base;
      if (special.has(lower)) {
        // PS3 disc folders: <Game>/PS3_GAME/USRDIR/EBOOT.BIN
        base = path.basename(path.resolve(full, '../../..'));
      } else if (!exts.has(ext)) {
        return;
      } else if (ext === 'rpx') {
        // Extracted Wii U titles: <Game>/code/<name>.rpx
        if (path.basename(path.dirname(full)).toLowerCase() !== 'code') return;
        base = path.basename(path.resolve(full, '../..'));
      } else {
        base = path.basename(fileName, path.extname(fileName));
      }
      const real = realpath(full) || full;
      if (seen.has(real)) return;
      seen.add(real);
      const { name, tags } = prettyName(base);
      let size = 0;
      try { size = fs.statSync(full).size; } catch { /* keep 0 */ }
      games.push({
        id: `emu:${system.id}:${crypto.createHash('sha1').update(real).digest('hex').slice(0, 12)}`,
        source: 'emulator',
        system: system.id,
        platform: system.name,
        platformShort: system.short,
        name,
        tags,
        art: findRomArt(full, base, system),
        sizeBytes: size,
        lastPlayed: 0,
        playtimeMin: 0,
        detail: full,
        launch: { type: 'emulator', system: system.id, rom: full },
      });
    }, budget);
  }
  return games;
}

async function scan(config) {
  const { map, roots } = collectRomDirs(config);
  const emulators = EMULATORS.map((def) => detectEmulator(def, (config.emulators || {})[def.id]));
  const byId = new Map(emulators.map((e) => [e.id, e]));
  const games = [];
  const systems = [];

  for (const system of SYSTEMS) {
    const dirs = map.get(system.id);
    const cfg = (config.systems || {})[system.id] || {};
    const found = await scanSystem(system, [...dirs.user, ...dirs.auto]);
    // Preferred emulator: explicit choice, else the first installed candidate.
    const chosen = (cfg.emulator && byId.get(cfg.emulator))
      || system.emulators.map((id) => byId.get(id)).find((e) => e && e.found)
      || byId.get(system.emulators[0]);
    let issue = chosen.found ? null : chosen.issue;
    if (chosen.found && chosen.id === 'retroarch' && !chosen.customArgs && !findRetroArchCore(system, cfg.core)) {
      issue = `No RetroArch core installed for ${system.name}`;
    }
    for (const g of found) g.status = issue;
    games.push(...found);
    systems.push({
      id: system.id, name: system.name, short: system.short,
      count: found.length,
      emulator: chosen.id, emulatorName: chosen.name, emulatorFound: chosen.found,
      candidates: system.emulators,
      userDirs: dirs.user, autoDirs: dirs.auto,
      issue,
    });
  }
  for (const emu of emulators) {
    emu.systems = SYSTEMS.filter((s) => s.emulators.includes(emu.id)).map((s) => s.short);
    emu.gameCount = systems.filter((s) => s.emulator === emu.id).reduce((n, s) => n + s.count, 0);
  }
  return { games, systems, emulators: emulators.map(({ argv, ...rest }) => rest), romRoots: roots };
}

/** Resolve the argv for launching a ROM (or the bare emulator when rom is null). */
function buildCommand(config, systemId, rom, emulatorId) {
  const system = SYSTEMS.find((s) => s.id === systemId);
  const sysCfg = (system && (config.systems || {})[system.id]) || {};
  const pick = (id) => {
    const def = EMULATORS.find((e) => e.id === id);
    return def ? { def, det: detectEmulator(def, (config.emulators || {})[id]) } : null;
  };
  let chosen = emulatorId ? pick(emulatorId) : null;
  if (!chosen && system) {
    const options = [sysCfg.emulator, ...system.emulators].filter(Boolean).map(pick).filter(Boolean);
    chosen = (sysCfg.emulator && options[0]) || options.find((o) => o.det.found) || options[0];
  }
  if (!chosen) return { error: 'No emulator is configured for this platform' };
  const { def, det } = chosen;
  if (!det.found) return { error: `${det.issue}. Set its path under Systems.` };
  if (!rom) return { argv: det.argv, name: def.name };
  if (!fs.existsSync(rom)) return { error: `ROM file is missing: ${rom}` };

  const template = det.customArgs ? splitArgs(det.customArgs) : def.args;
  let core = null;
  if (template.some((a) => a.includes('{core}'))) {
    core = findRetroArchCore(system, sysCfg.core);
    if (!core) return { error: `No RetroArch core installed for ${system.name}. Install one from RetroArch's Online Updater.` };
  }
  const args = template.map((a) => a.replaceAll('{rom}', rom).replaceAll('{core}', core || ''));
  if (!template.some((a) => a.includes('{rom}'))) args.push(rom);
  return { argv: [...det.argv, ...args], name: def.name };
}

module.exports = { scan, buildCommand, SYSTEMS, EMULATORS };
