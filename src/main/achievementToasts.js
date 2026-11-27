'use strict';
// "Achievement unlocked", the Xbox 360 way, over whatever is on screen (a fullscreen game too).
//   Steam: Steam tells its own UI the moment one is earned; Halcyon's listener inside Steam
//          queues those, and they are collected every couple of seconds.
//   RetroAchievements: while an emulated game runs, recent unlocks are checked every minute.
// The toast is drawn by overlay/toast.py as a Wayland layer-shell overlay (never takes focus);
// without that, the desktop's own notification is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const diary = require('./log');

const HELPER = path.join(__dirname, 'overlay', 'toast.py');
const ICON_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|steamcdn-a\.akamaihd\.net|retroachievements\.org)\//;

class AchievementToasts {
  /**
   * opts: { store, steamClient, achievements, retro, launcher, cacheDir,
   *         displayBounds: async () => ({ x, y }), soundFor: (event) => path | null }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.queue = [];
    this.showing = false;
    this.seenRetro = new Set();
    this.layerOk = null;
    this.loggedShape = false;
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch { /* exists */ }
  }

  get on() { return this.store.data.settings.achievementToasts !== false; }

  start() {
    this.steamTimer = setInterval(() => this.pollSteam().catch(() => {}), 2500);
    this.retroTimer = setInterval(() => this.pollRetro().catch(() => {}), 60000);
    this.steamTimer.unref?.();
    this.retroTimer.unref?.();
  }

  async pollSteam() {
    if (!this.on || !this.steamEnabled()) return;
    const list = await this.steamClient.takeAchievements();
    for (const ev of list) {
      const a = ev.a || {};
      if (!this.loggedShape) { this.loggedShape = true; diary.log('achievement event shape:', JSON.stringify(Object.keys(a))); }
      const appid = String(ev.appid);
      // Steam's event carries the achievement's ID; its name, icon and rarity come from the
      // game's list (cached, or fetched once with the Web API key).
      const info = await this.achievements.game(appid).catch(() => null);
      const def = info && info.ok ? info.list.find((x) => x.id === (a.strID || a.strName)) : null;
      const total = (info && info.ok && info.list.length) || ((this.store.data.achievements || {})[appid] || {}).total;
      this.show({
        name: (def && def.name) || a.strName || a.strDisplayName || a.strID || 'Achievement',
        points: total ? Math.round(1000 / total) : null,
        icon: (def && def.icon) || a.strImage || '',
        rare: Boolean(def && def.percent != null && def.percent < 10),
      });
      // Bring the game's list and the score up to date.
      setTimeout(() => this.achievements.game(appid, { refresh: true }).catch(() => {}), 4000);
    }
  }

  async pollRetro() {
    if (!this.on || !this.retro.account()) return;
    if (!this.launcher.nowPlaying().some((p) => String(p.id).startsWith('emu:'))) return;
    const recent = await this.retro.recent(3);
    for (const r of recent) {
      const key = `${r.id}:${r.date}`;
      if (this.seenRetro.has(key)) continue;
      this.seenRetro.add(key);
      this.show({ name: r.name, points: r.points, icon: r.icon, rare: false });
    }
    if (recent.length) this.retro.sync().catch(() => {});
  }

  steamEnabled() {
    try { return this.steamClient.enabled(this.installs()); } catch { return false; }
  }

  /** a: { name, points, icon (url), rare } */
  show(a) {
    this.queue.push(a);
    if (!this.showing) this.next();
  }

  async next() {
    const a = this.queue.shift();
    if (!a) { this.showing = false; return; }
    this.showing = true;
    const line = a.points ? `${a.points} G - ${a.name}` : a.name;
    diary.log('achievement toast:', line);
    const icon = await this.iconFile(a.icon).catch(() => '');
    const at = await this.displayBounds().catch(() => ({ x: 0, y: 0 }));
    const sounds = this.store.data.settings.sounds !== false;
    const sound = sounds ? (a.rare && this.soundFor('rareAchievement')) || this.soundFor('achievement') || '' : '';
    const args = { title: a.rare ? 'Rare achievement unlocked' : 'Achievement unlocked', line, icon, rare: Boolean(a.rare), x: at.x, y: at.y, sound, ms: 6500 };
    const done = () => setTimeout(() => this.next(), 400);
    if (await this.layerAvailable()) {
      const p = spawn('python3', [HELPER, JSON.stringify(args)], { stdio: 'ignore' });
      p.on('exit', done);
      p.on('error', () => { this.layerOk = false; this.fallback(args); done(); });
    } else {
      this.fallback(args);
      setTimeout(done, 3000);
    }
  }

  /** The desktop's own notification, where the overlay can't be drawn. */
  fallback(args) {
    execFile('notify-send', ['--app-name=Halcyon', '-i', args.icon || 'starred', args.title, args.line], () => {});
    if (args.sound) execFile('paplay', [args.sound], () => {});
  }

  layerAvailable() {
    if (this.layerOk != null) return Promise.resolve(this.layerOk);
    if (!process.env.WAYLAND_DISPLAY || !fs.existsSync(HELPER)) { this.layerOk = false; return Promise.resolve(false); }
    return new Promise((resolve) => {
      execFile('python3', ['-c', "import gi; gi.require_version('Gtk','3.0'); gi.require_version('GtkLayerShell','0.1'); from gi.repository import GtkLayerShell; import sys; sys.exit(0 if GtkLayerShell.is_supported() else 1)"],
        { timeout: 8000 }, (err) => { this.layerOk = !err; diary.log('achievement overlay:', this.layerOk ? 'layer shell' : 'desktop notifications'); resolve(this.layerOk); });
    });
  }

  /** The achievement's icon, saved locally (cached). */
  async iconFile(url) {
    if (!url) return '';
    url = String(url).replace(/^https?:\/\/steamcdn-a\.akamaihd\.net\//, 'https://cdn.akamai.steamstatic.com/');
    if (!/^https?:/.test(url)) {
      // Steam sometimes gives just the image's file name for the app.
      return '';
    }
    if (!ICON_HOSTS.test(url)) return '';
    const file = path.join(this.cacheDir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + path.extname(new URL(url).pathname).slice(0, 5));
    if (fs.existsSync(file)) return file;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return '';
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
}

module.exports = { AchievementToasts };
