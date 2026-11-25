'use strict';
// Runs the simulated-gamepad UI test against the real library, but with a
// throwaway config folder and local stand-ins for every online service.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./mock-services');

(async () => {
  const { server, port } = await mock.start();
  const steamDebug = await mock.startSteamDebug();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-test-'));
  fs.mkdirSync(path.join(tmp, 'steam-marker'), { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  // A tiny sound pack in the Steam Deck layout: one very loud short click for moving,
  // and one quiet whoosh that starts after 200 ms of silence for switching sections.
  const wav = (seconds, amp, silence = 0) => {
    const rate = 22050;
    const n = Math.round(rate * seconds);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const v = t < silence ? 0 : amp * Math.sin(2 * Math.PI * 440 * t);
      data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
    head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
    head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
    head.write('data', 36); head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  };
  const packDir = path.join(tmp, 'config', 'sounds', 'test-pack');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'Loud.wav'), wav(0.1, 0.95));
  fs.writeFileSync(path.join(packDir, 'Quiet.wav'), wav(0.6, 0.03, 0.2));
  fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({ name: 'Test Pack', mappings: {
    'deck_ui_navigation.wav': ['Loud.wav'], 'deck_ui_tab_transition_01.wav': ['Quiet.wav'], 'deck_ui_side_menu_fly_out.wav': ['Quiet.wav'],
  } }));
  // A stand-in Steam library whose one game is mid-download; the test edits this manifest.
  const steamapps = path.join(tmp, 'steamlib', 'steamapps');
  fs.mkdirSync(steamapps, { recursive: true });
  fs.writeFileSync(path.join(steamapps, 'appmanifest_900050.acf'),
    '"AppState"\n{\n\t"appid"\t\t"900050"\n\t"name"\t\t"Download Test"\n\t"StateFlags"\t\t"1026"\n\t"installdir"\t\t"DownloadTest"\n\t"SizeOnDisk"\t\t"0"\n\t"BytesToDownload"\t\t"1000"\n\t"BytesDownloaded"\t\t"430"\n}\n');
  // Keystrokes for the in-game menu window: look, move to Quit, confirm.
  const shots = process.env.HALCYON_TEST_SHOTS || tmp;
  const menuScript = path.join(tmp, 'menu-steps.json');
  fs.writeFileSync(menuScript, JSON.stringify([
    { wait: 700 }, { shot: path.join(shots, 'gamemenu.png') },
    { key: 'Down' }, { wait: 200 }, { key: 'Enter' }, { wait: 600 }, { shot: path.join(shots, 'gamemenu-quit.png') },
    { key: 'Enter' },
  ]));
  const child = spawn(require('electron'), ['.', '--windowed'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      HALCYON_DRY_RUN: '1',
      HALCYON_DEV_SCRIPT: 'scripts/ui-test.js',
      HALCYON_DEV_MENU_SCRIPT: menuScript,
      HALCYON_CONFIG_DIR: path.join(tmp, 'config'),
      HALCYON_INSTALL_DIR: path.join(tmp, 'apps'),
      HALCYON_GITHUB_API: `${base}/gh`,
      HALCYON_SGDB_URL: `${base}/sgdb`,
      HALCYON_STEAM_STORE_URL: `${base}/store`,
      HALCYON_STEAM_API_URL: `${base}/steamapi`,
      HALCYON_POLL_MS: '700',
      HALCYON_STEAM_CEF_PORT: String(steamDebug.port),
      HALCYON_STEAM_MARKER_DIR: path.join(tmp, 'steam-marker'),
      HALCYON_STEAM_DEBUG_STATE: `http://127.0.0.1:${steamDebug.port}/state`,
    },
  });
  child.on('exit', (code) => {
    server.close();
    steamDebug.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(code || 0);
  });
})();
