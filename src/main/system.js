'use strict';
// The "console" side of the launcher: system volume, power, controller
// batteries, start-on-login, and noticing when a Steam game is running.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { which, HOME } = require('./util');

const DRY = () => Boolean(process.env.HALCYON_DRY_RUN);

function exec(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), error: err ? (String(stderr || '').trim() || err.message) : null });
    });
  });
}

// ------------------------------------------------------------------ volume

const SINK = '@DEFAULT_AUDIO_SINK@';

async function getVolume() {
  if (which('wpctl')) {
    const r = await exec('wpctl', ['get-volume', SINK]);
    const m = r.ok && r.out.match(/Volume:\s*([\d.]+)/);
    if (m) return { ok: true, level: Math.round(parseFloat(m[1]) * 100), muted: /MUTED/.test(r.out) };
  }
  if (which('pactl')) {
    const [vol, mute] = await Promise.all([
      exec('pactl', ['get-sink-volume', '@DEFAULT_SINK@']),
      exec('pactl', ['get-sink-mute', '@DEFAULT_SINK@']),
    ]);
    const m = vol.ok && vol.out.match(/(\d+)%/);
    if (m) return { ok: true, level: Number(m[1]), muted: /yes/.test(mute.out) };
  }
  return { ok: false, error: 'No audio control found (needs PipeWire’s wpctl or pactl).' };
}

async function setVolume({ level, muted }) {
  const useWp = Boolean(which('wpctl'));
  if (!useWp && !which('pactl')) return getVolume();
  if (level != null) {
    const pct = Math.max(0, Math.min(100, Math.round(level)));
    if (useWp) await exec('wpctl', ['set-volume', SINK, `${pct}%`]);
    else await exec('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${pct}%`]);
  }
  if (muted != null) {
    if (useWp) await exec('wpctl', ['set-mute', SINK, muted ? '1' : '0']);
    else await exec('pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']);
  }
  return getVolume();
}

// ------------------------------------------------------------------- power

const POWER = { suspend: 'suspend', restart: 'reboot', shutdown: 'poweroff' };

async function power(action) {
  const verb = POWER[action];
  if (!verb) return { ok: false, error: 'Unknown power action.' };
  if (!which('systemctl')) return { ok: false, error: 'systemctl was not found, so Halcyon cannot control power on this system.' };
  if (DRY()) {
    console.log('[dry-run] would run: systemctl', verb);
    return { ok: true, dryRun: true };
  }
  const r = await exec('systemctl', [verb], 15000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || `systemctl ${verb} failed.` };
}

// --------------------------------------------------------------- batteries

const PAD_HINT = /controller|gamepad|xbox|xpad|sony|playstation|dualsense|dualshock|ps-controller|nintendo|switch|joy-?con|8bitdo|wireless.?pad|stadia|steam/i;

/** Battery level of wireless controllers that expose one through the kernel. */
function batteries() {
  const root = '/sys/class/power_supply';
  const read = (dir, name) => { try { return fs.readFileSync(path.join(root, dir, name), 'utf8').trim(); } catch { return ''; } };
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const dir of entries) {
    if (read(dir, 'scope') !== 'Device') continue;
    const model = read(dir, 'model_name');
    if (!PAD_HINT.test(`${dir} ${model}`)) continue;
    const capacity = read(dir, 'capacity');
    const level = read(dir, 'capacity_level');
    const pct = capacity !== '' ? Number(capacity)
      : ({ Full: 100, High: 75, Normal: 50, Low: 20, Critical: 5 })[level];
    if (pct == null || Number.isNaN(pct)) continue;
    out.push({ id: dir, name: model || 'Controller', percent: pct, charging: read(dir, 'status') === 'Charging' });
  }
  return out;
}

// ---------------------------------------------------------- start on login

const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'autostart', 'halcyon.desktop');

const autostartEnabled = () => fs.existsSync(autostartFile());

function setAutostart(on, appPath) {
  const file = autostartFile();
  try {
    if (!on) {
      fs.rmSync(file, { force: true });
      return { ok: true };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Halcyon',
      'Comment=Console-style game launcher',
      `Exec="${process.execPath}" "${appPath}"`,
      `Path=${appPath}`,
      'Icon=input-gaming',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not update ${file}: ${err.message}` };
  }
}

// ------------------------------------------------------- running Steam games

/** Steam starts every game under `reaper SteamLaunch AppId=<id>`; that process lives as long as the game. */
function steamAppRunning(appid) {
  const needle = `AppId=${appid}`;
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return false; }
  for (const pid of pids) {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      if (args.includes('SteamLaunch') && args.includes(needle)) return true;
    } catch { /* process went away */ }
  }
  return false;
}

/**
 * Watch a Steam game from launch to exit. Calls onStart once the game process
 * shows up and onExit(ms) when it is gone. Gives up quietly if it never appears.
 */
function watchSteamApp(appid, { onStart, onExit, appearWithinMs = 180000, everyMs = 2500 }) {
  const began = Date.now();
  let startedAt = 0;
  const timer = setInterval(() => {
    const running = steamAppRunning(appid);
    if (!startedAt) {
      if (running) { startedAt = Date.now(); onStart(); }
      else if (Date.now() - began > appearWithinMs) clearInterval(timer);
    } else if (!running) {
      clearInterval(timer);
      onExit(Date.now() - startedAt);
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { getVolume, setVolume, power, batteries, autostartEnabled, setAutostart, steamAppRunning, watchSteamApp };
