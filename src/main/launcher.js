'use strict';
// Process launching. Every launch is detached so games outlive the launcher,
// and spawn failures / instant crashes are reported back instead of swallowed.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const steam = require('./steam/steam');
const emulators = require('./emulators/emulators');
const system = require('./system');
const steamClient = require('./steam/client');
const diary = require('./log');
const { expandHome, isDir, HOME } = require('./util');

const EARLY_EXIT_MS = 4000;
const HANDOFF_MS = 1500; // a clean exit this fast is a wrapper handing off, not a play session

function run(argv, { cwd, shell = false, onExit } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    let child;
    const started = Date.now();
    try {
      child = shell
        ? spawn('/bin/sh', ['-c', argv], { cwd, detached: true, stdio: 'ignore' })
        : spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: 'ignore' });
    } catch (err) {
      return done({ ok: false, error: err.message });
    }
    child.once('error', (err) => {
      done({ ok: false, error: err.code === 'ENOENT' ? `Executable not found: ${shell ? '/bin/sh' : argv[0]}` : err.message });
    });
    child.once('spawn', () => {
      child.unref();
      done({ ok: true, pid: child.pid });
    });
    child.once('exit', (code, signal) => {
      if (onExit) onExit({ code, signal, ms: Date.now() - started });
    });
  });
}

class Launcher {
  constructor(library, notify) {
    this.library = library;
    this.notify = notify; // (event) => void, forwarded to the renderer
    this.running = new Map(); // id -> { id, name, since }
    this.bigPictureOpen = false; // whether Halcyon switched Steam into Big Picture
  }

  nowPlaying() {
    return [...this.running.values()].map(({ id, name, since, quittable }) => ({ id, name, since, quittable }));
  }

  /** Close a game Halcyon started: ask politely, then insist. */
  quit(id) {
    const entry = id ? this.running.get(id) : [...this.running.values()].reverse().find((e) => e.quittable);
    if (!entry) return { ok: false, error: 'That game is no longer running.' };
    if (!entry.quittable) return { ok: false, error: `${entry.name} was started by Steam. Close it from the game or from Steam.` };
    entry.quitting = true;
    const signal = (sig) => {
      // The game is its own process group (it was started detached), so this reaches helpers too.
      try { process.kill(-entry.pid, sig); return true; } catch { return false; }
    };
    const sent = signal('SIGTERM');
    // A Flatpak app lives in a sandbox the wrapper's signal does not always reach.
    if (entry.argv[0] === 'flatpak' && entry.argv[1] === 'run') {
      const appId = entry.argv.slice(2).find((a) => !a.startsWith('-'));
      if (appId) execFile('flatpak', ['kill', appId], () => {});
    }
    setTimeout(() => { if (this.running.get(entry.id) === entry) signal('SIGKILL'); }, 4000).unref();
    return sent ? { ok: true, name: entry.name } : { ok: false, error: `Could not close ${entry.name}.` };
  }

  /** pid/argv are only known for games Halcyon started itself (not through Steam). */
  started(game, proc = null) {
    this.running.set(game.id, { id: game.id, name: game.name, since: Date.now(), quittable: Boolean(proc), ...(proc || {}) });
    this.notify({ type: 'started', id: game.id, name: game.name });
  }

  /** A play session ended: bank the time and tell the dashboard. */
  ended(game, ms, { bank = true } = {}) {
    this.running.delete(game.id);
    const minutes = Math.round(ms / 60000);
    if (bank && minutes > 0) this.library.addPlaytime(game.id, minutes);
    this.notify({ type: 'exited', id: game.id, name: game.name, minutes, source: game.source });
  }

  async launch(id) {
    const game = this.library.get(id);
    if (!game) return { ok: false, error: 'This game is no longer in the library. Try rescanning.' };
    const { launch } = game;
    const config = this.library.config;
    let argv;
    let opts = {};

    if (launch.type === 'steam') {
      argv = steam.clientCommand(launch.kind, launch.root, launch.install ? `steam://install/${launch.appid}` : `steam://rungameid/${launch.appid}`);
      if (!argv) return { ok: false, error: 'Could not find a Steam client to launch this game with.' };
      if (launch.install) { await this.bigPicture(launch); return this.steamUrl(argv, { installing: true }); }
      // Games start from the desktop Steam client: Halcyon follows the launch itself (and
      // skips shader processing on request), so Big Picture is not needed and stays shut.
    } else if (launch.type === 'emulator') {
      const cmd = emulators.buildCommand(config, launch.system, launch.rom);
      if (cmd.error) return { ok: false, error: cmd.error };
      argv = cmd.argv;
    } else if (launch.type === 'custom') {
      if (!launch.command) return { ok: false, error: 'This game has no launch command. Edit it to add one.' };
      const cwd = launch.cwd ? expandHome(launch.cwd) : HOME;
      if (!isDir(cwd)) return { ok: false, error: `Working directory does not exist: ${cwd}` };
      argv = launch.command;
      opts = { shell: true, cwd };
    } else {
      return { ok: false, error: 'Unknown game type.' };
    }

    // With Steam's controls on, Steam games are started through Steam itself, which keeps
    // Steam's window out of the way (a steam:// link brings it up first).
    if (launch.type === 'steam' && !process.env.HALCYON_DRY_RUN && steamClient.enabled(this.library.raw.steam.installs || [])) {
      const direct = await steamClient.runGame(launch.appid);
      if (direct.ok) return this.afterSteamStart(game, id, launch);
      // Steam not answering: fall back to the link below.
    }

    // HALCYON_DRY_RUN=1 resolves real launches without starting anything (for UI testing).
    if (process.env.HALCYON_DRY_RUN && launch.type !== 'custom') {
      console.log('[dry-run] would launch:', JSON.stringify(argv));
      // Against a stand-in Steam (tests), follow the launch steps for a while as for real.
      if (launch.type === 'steam' && process.env.HALCYON_STEAM_CEF_PORT) { const stop = this.followSteamLaunch(game, launch.appid); setTimeout(stop, 20000).unref(); }
      return { ok: true, dryRun: true, bigPicture: false, ...(launch.type === 'steam' ? { followsSteam: true } : {}) };
    }

    // Steam hands off to its own client, so its wrapper exiting quickly is normal;
    // the game itself is followed through Steam's per-game reaper process.
    const direct = launch.type !== 'steam';
    const result = await run(argv, {
      ...opts,
      onExit: ({ code, ms }) => {
        if (!direct) return;
        if (this.running.get(id) && this.running.get(id).quitting) {
          this.ended(game, ms);
        } else if (code && ms < EARLY_EXIT_MS) {
          this.running.delete(id);
          this.notify({ type: 'failed', id, name: game.name, error: `${game.name} exited immediately (code ${code}). Check its launch settings.` });
        } else if (!code && ms < HANDOFF_MS) {
          this.running.delete(id);
          this.notify({ type: 'detached', id, name: game.name });
        } else {
          this.ended(game, ms);
        }
      },
    });
    if (result.ok && direct) {
      this.started(game, { pid: result.pid, argv: opts.shell ? ['/bin/sh', '-c', argv] : argv });
      result.tracked = true;
    } else if (result.ok) {
      return this.afterSteamStart(game, id, launch, result);
    }
    if (result.ok) this.library.markPlayed(id);
    return result;
  }

  /** A Steam game has been asked to start: follow it until it runs and until it ends. */
  afterSteamStart(game, id, launch, result = { ok: true }) {
    {
      // Steam keeps its own playtime, so nothing is banked here.
      const stopFollowing = this.followSteamLaunch(game, launch.appid);
      result.followsSteam = true;
      // Steam can still put its window up while it prepares a game; keep it in the tray.
      for (const ms of [1200, 3500, 7000]) setTimeout(() => { steamClient.hideMainWindow().then((r) => diary.log(`steam window hide @${ms}ms:`, r)).catch(() => {}); }, ms).unref();
      system.watchSteamApp(launch.appid, {
        onStart: () => {
          stopFollowing();
          this.started(game);
        },
        onExit: async (ms) => {
          stopFollowing();
          if (this.bigPictureOpen) {
            await this.leaveBigPicture(launch);
            if (!process.env.HALCYON_DRY_RUN) await new Promise((r) => setTimeout(r, 2000));
          }
          this.ended(game, ms, { bank: false });
        },
      });
    }
    this.library.markPlayed(id);
    return result;
  }

  /**
   * Follow Steam's steps for starting a game and report them to the dashboard, so the
   * launch card can say what is happening. On "Processing Vulkan shaders" it shows the
   * progress and lets A skip it (or skips straight away with the setting on).
   * Returns a function that stops following.
   */
  followSteamLaunch(game, appid) {
    let stopped = false;
    let skipped = false;
    let last = '';
    const began = Date.now();
    const tick = async () => {
      if (stopped) return;
      const res = await steamClient.gameActions();
      if (stopped) return;
      if (!res.ok) { if (res.offline) return; }
      const a = (res.actions || []).find((x) => x.appid === String(appid) && x.action === 'LaunchApp');
      const task = a ? a.task : '';
      const shaders = task === 'ProcessingShaderCache';
      const percent = shaders && a.total > 0 ? Math.min(100, Math.floor((a.done * 100) / a.total)) : null;
      const sig = `${task}|${percent}`;
      if (sig !== last) {
        last = sig;
        this.notify({ type: 'steamTask', id: game.id, task, percent, actionId: a ? a.id : 0 });
      }
      if (shaders && !skipped && this.library.config.settings.steamSkipShaders) {
        skipped = true;
        const res = await steamClient.skipShaders(a.id);
        if (res.ok) { last = 'skipped'; this.notify({ type: 'steamTask', id: game.id, task: 'ShadersSkipped', percent: null, actionId: 0 }); }
      }
      if (Date.now() - began > 20 * 60 * 1000) stopped = true;
    };
    const timer = setInterval(() => tick().catch(() => {}), 700);
    timer.unref();
    tick().catch(() => {});
    return () => { stopped = true; clearInterval(timer); };
  }

  /**
   * With the Big Picture setting on, put Steam into Big Picture before handing it a request,
   * so whatever Steam shows next (shader processing with its Skip button, install prompts,
   * the store) can be driven with the controller. Returns true when Big Picture is in use.
   */
  async bigPicture(target) {
    if (!this.library.config.settings.steamBigPicture) return false;
    const install = target || (this.library.raw.steam.installs || [])[0] || {};
    const argv = steam.clientCommand(install.kind, install.root, 'steam://open/bigpicture');
    if (!argv) return false;
    const wasOpen = this.bigPictureOpen;
    this.bigPictureOpen = true;
    if (process.env.HALCYON_DRY_RUN) { console.log('[dry-run] would run:', JSON.stringify(argv)); return true; }
    await run(argv);
    // Give Steam a moment to switch modes before the next request arrives.
    await new Promise((r) => setTimeout(r, wasOpen ? 600 : 2500));
    return true;
  }

  /** The game is over: take Steam back out of Big Picture so the dashboard is in front again. */
  async leaveBigPicture(target) {
    if (!this.bigPictureOpen) return { ok: true, wasOpen: false };
    this.bigPictureOpen = false;
    if (process.env.HALCYON_DRY_RUN && !process.env.HALCYON_STEAM_CEF_PORT) return { ok: true, dryRun: true };
    // With Steam's controls on, leave without Steam's desktop window popping up over things.
    const quiet = await steamClient.leaveBigPicture();
    if (quiet.ok) return quiet;
    const install = target || (this.library.raw.steam.installs || [])[0] || {};
    const argv = steam.clientCommand(install.kind, install.root, 'steam://close/bigpicture');
    if (!argv) return { ok: false, error: 'Steam is not installed.' };
    return this.steamUrl(argv);
  }

  /** Hand a steam:// request to the client (install, uninstall, store page). */
  async steamUrl(argv, extra = {}) {
    if (process.env.HALCYON_DRY_RUN) {
      console.log('[dry-run] would run:', JSON.stringify(argv));
      return { ok: true, dryRun: true, ...extra };
    }
    const result = await run(argv);
    return result.ok ? { ok: true, ...extra } : result;
  }

  /** Any steam:// page for an app: 'store', 'uninstall', 'install'. */
  async steamAction(action, appid) {
    if (action === 'storefront' || action === 'downloads') appid = '';
    else if (!/^\d+$/.test(String(appid)) || !['store', 'uninstall', 'install'].includes(action)) return { ok: false, error: 'Unknown Steam request.' };
    const install = (this.library.raw.steam.installs || [])[0];
    const argv = steam.clientCommand(install && install.kind, install && install.root, action === 'storefront' ? 'steam://store' : action === 'downloads' ? 'steam://open/downloads' : `steam://${action}/${appid}`);
    if (!argv) return { ok: false, error: 'Steam is not installed.' };
    const bigPicture = action === 'uninstall' ? false : await this.bigPicture(install);
    return this.steamUrl(argv, { ...(action === 'install' ? { installing: true } : {}), bigPicture });
  }

  /** Open an emulator's own UI (no ROM) so it can be configured. */
  async openEmulator(emulatorId) {
    const cmd = emulators.buildCommand(this.library.config, null, null, emulatorId);
    if (cmd.error) return { ok: false, error: cmd.error };
    if (process.env.HALCYON_DRY_RUN) { console.log('[dry-run] would open:', JSON.stringify(cmd.argv)); return { ok: true, dryRun: true }; }
    return run(cmd.argv);
  }

  async openSteam() {
    const install = (this.library.raw.steam.installs || [])[0];
    const argv = steam.clientCommand(install && install.kind, install && install.root, 'steam://open/games');
    if (!argv) return { ok: false, error: 'Steam is not installed.' };
    return this.steamUrl(argv);
  }
}

module.exports = { Launcher };
