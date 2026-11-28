'use strict';
// YouTube, the way a TV shows it: YouTube's own TV interface (youtube.com/tv) in a window of
// its own, fullscreen on Halcyon's screen. It is only served to TVs, so the window says it is
// one. Signing in happens the TV way (a code entered on a phone), so no password is typed here;
// the sign-in is kept in its own storage, apart from the rest of Halcyon.
// The controller drives it like a TV remote: yt-preload.js reads the pad and Halcyon sends the
// matching keys. Halcyon treats the window like a running game: the Guide (Home) can resume or
// close it, and Halcyon comes back when it closes.
const path = require('path');
const { BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const diary = require('./log');

const ID = 'app:youtube';
const URL_TV = 'https://www.youtube.com/tv';
// A Samsung (Tizen) TV's browser: what YouTube's TV interface expects.
const TV_AGENT = 'Mozilla/5.0 (Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|google\.com|googlevideo\.com|ytimg\.com|gstatic\.com|youtu\.be)(\/|$)/;
// Pad buttons (standard mapping) to the keys a TV remote sends.
const KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', accept: 'Enter', back: 'Escape', playpause: 'MediaPlayPause' };

class YouTube {
  /**
   * opts: { launcher, title, chosenDisplay: () => display|null, boundsOn: (display) => rect,
   *         place: async (title) => void, onClosed: () => void }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.win = null;
    this.awake = null;
    ipcMain.on('yt:key', (e, name) => {
      if (!this.win || this.win.isDestroyed() || e.sender !== this.win.webContents) return;
      const keyCode = KEYS[name];
      if (!keyCode) return;
      this.win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      this.win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    });
  }

  get open() { return Boolean(this.win && !this.win.isDestroyed()); }

  /** Open it, or bring it back if it is already open. Resolves { ok, reopened }. */
  async show() {
    if (this.open) {
      this.win.show();
      this.win.focus();
      return { ok: true, already: true };
    }
    const there = this.chosenDisplay();
    const w = new BrowserWindow({
      ...(there ? this.boundsOn(there) : { width: 1600, height: 900 }),
      fullscreen: true,
      frame: false,
      backgroundColor: '#000000',
      title: this.title,
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:youtube',
        preload: path.join(__dirname, 'yt-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win = w;
    w.webContents.setUserAgent(TV_AGENT);
    w.on('page-title-updated', (e) => e.preventDefault());
    // Only YouTube and Google's sign-in pages, in this one window.
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e, url) => { if (!ALLOWED.test(url)) { diary.log('youtube: kept from', url); e.preventDefault(); } });
    w.webContents.session.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'fullscreen'));
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { w.setFullScreen(!w.isFullScreen()); e.preventDefault(); }
    });
    w.on('closed', () => {
      if (this.win === w) this.win = null;
      if (this.awake != null) { powerSaveBlocker.stop(this.awake); this.awake = null; }
      this.launcher.endedApp(ID);
      diary.log('youtube: closed');
      this.onClosed();
    });
    // While it is open the screen stays on (videos play there).
    this.awake = powerSaveBlocker.start('prevent-display-sleep');
    this.launcher.startedApp({ id: ID, name: 'YouTube', close: () => this.close() });
    w.webContents.once('did-finish-load', () => { this.place(this.title).catch(() => {}); });
    w.loadURL(URL_TV).catch((err) => diary.log('youtube: load failed', err.message));
    diary.log('youtube: opened');
    return { ok: true };
  }

  close() {
    if (this.open) this.win.close();
    return { ok: true };
  }

  /** Forget the YouTube sign-in (its cookies and storage). */
  async signOut() {
    if (this.open) this.win.destroy();
    const { session } = require('electron');
    await session.fromPartition('persist:youtube').clearStorageData();
    return { ok: true };
  }
}

module.exports = { YouTube, YOUTUBE_ID: ID };
