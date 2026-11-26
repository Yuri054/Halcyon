'use strict';
// Local stand-ins for GitHub releases, SteamGridDB and the Steam store, so the
// UI test never downloads real software or needs a real API key.
const http = require('http');
const zlib = require('zlib');

const KEY = 'test-key';
const STEAM_KEY = 'steam-test-key';
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const APPIMAGE = Buffer.concat([Buffer.from('#!/bin/sh\nexit 0\n'), Buffer.alloc(3 * 1024 * 1024, 0x20)]);

/** A minimal stored (uncompressed) zip holding one file. */
function zipOf(name, data) {
  const crc = zlib.crc32(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}
const ZIP = zipOf('melonDS-x86_64.AppImage', APPIMAGE.subarray(0, 200000));

function start() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const base = `http://127.0.0.1:${server.address().port}`;
      const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const p = url.pathname;
      let m;

      // ---- GitHub
      if ((m = /^\/gh\/repos\/([^/]+)\/([^/]+)\/releases\/latest$/.exec(p))) {
        const repo = m[2];
        if (repo === 'RetroArch') return json(200, { tag_name: 'v1.0', assets: [{ name: 'RetroArch.7z', size: 1, browser_download_url: `${base}/dl/x` }] });
        if (repo === 'dolphin') return json(404, { message: 'Not Found' });
        if (repo === 'melonDS') return json(200, { tag_name: '1.1', assets: [
          { name: 'melonDS-1.1-appimage-aarch64.zip', size: 1, browser_download_url: `${base}/dl/wrong` },
          { name: 'melonDS-1.1-appimage-x86_64.zip', size: ZIP.length, browser_download_url: `${base}/dl/zip` }] });
        return json(200, { tag_name: '9.9', assets: [
          { name: `${repo}-9.9-appimage-arm64.appimage`, size: 1, browser_download_url: `${base}/dl/wrong` },
          { name: `${repo}-9.9-appimage-x64.appimage`, size: APPIMAGE.length, browser_download_url: `${base}/dl/appimage${url.searchParams.get('slow') ? '?slow=1' : ''}` }] });
      }
      if (p === '/dl/zip') { res.writeHead(200, { 'content-length': ZIP.length }); return res.end(ZIP); }
      if (p === '/dl/appimage') {
        res.writeHead(200, { 'content-length': APPIMAGE.length });
        const step = 256 * 1024;
        for (let i = 0; i < APPIMAGE.length; i += step) {
          if (res.destroyed) return;
          res.write(APPIMAGE.subarray(i, i + step));
          await new Promise((r) => setTimeout(r, process.env.MOCK_SLOW ? 400 : 60));
        }
        return res.end();
      }

      // ---- SteamGridDB
      if (p.startsWith('/sgdb/')) {
        if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { success: false, errors: ['Unauthorized'] });
        if ((m = /^\/sgdb\/search\/autocomplete\/(.+)$/.exec(p))) {
          const term = decodeURIComponent(m[1]);
          return json(200, { success: true, data: /nothing/i.test(term) ? [] : [{ id: 42, name: term }] });
        }
        if (/^\/sgdb\/(grids|heroes)\/(game|steam)\/\d+$/.test(p)) return json(200, { success: true, data: [{ id: 1, url: `${base}/img/${p.includes('grids') ? 'grid' : 'hero'}.png` }] });
        return json(404, { success: false });
      }
      if (p.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }

      // ---- Steam Web API: owned games (one is installed nowhere, so it shows as "not installed")
      if (p === '/steamapi/IPlayerService/GetOwnedGames/v1/') {
        if (req.headers['x-webapi-key'] !== STEAM_KEY) return json(403, {});
        return json(200, { response: { game_count: 3, games: [
          { appid: 900010, name: 'Owned Game A', playtime_forever: 120, rtime_last_played: 1700000000 },
          { appid: 900030, name: 'Owned Game B', playtime_forever: 0 },
          { appid: 228980, name: 'Steamworks Common Redistributables' },
        ] } });
      }

      // ---- Steam storefront
      if (p === '/store/api/featuredcategories') {
        const item = (id, name, cut) => ({ id, type: 0, name, discounted: cut > 0, discount_percent: cut, original_price: 3999, final_price: Math.round(3999 * (1 - cut / 100)), currency: 'USD', large_capsule_image: `${base}/img/grid.png`, linux_available: id % 20 === 0, controller_support: 'full' });
        return json(200, {
          specials: { id: 'cat_specials', name: 'Specials', items: [item(900010, 'Owned Game A', 80), item(900110, 'Sale Game', 50), { id: 5, type: 1, name: 'A Package' }] },
          top_sellers: { id: 'cat_topsellers', name: 'Top Sellers', items: [item(900210, 'Top Seller', 0), item(900210, 'Top Seller', 0)] },
          new_releases: { id: 'cat_new', name: 'New Releases', items: [{ ...item(900310, 'Free Thing', 0), original_price: 0, final_price: 0 }] },
          coming_soon: { id: 'cat_soon', name: 'Coming Soon', items: [{ ...item(900410, 'Future Game', 0), original_price: null, final_price: 0 }] },
        });
      }
      if (p === '/store/api/storesearch/') {
        const term = url.searchParams.get('term');
        return json(200, { total: 1, items: /nothing/i.test(term) ? [] : [
          { type: 'app', name: `Found: ${term}`, id: 900510, price: { currency: 'USD', initial: 2000, final: 1500 }, tiny_image: `${base}/img/grid.png`, platforms: { windows: true, linux: true }, controller_support: 'partial' },
          { type: 'sub', name: 'Not an app', id: 7 }] });
      }

      // ---- Steam store: app ids with an odd tens digit have no controller support
      if (p === '/store/api/appdetails') {
        const id = url.searchParams.get('appids');
        if (url.searchParams.get('filters') !== 'categories') {
          if (id === '900999') return json(200, { [id]: { success: false } });
          return json(200, { [id]: { success: true, data: {
            name: `Game ${id}`, steam_appid: Number(id), is_free: false, short_description: 'A <b>fine</b> game &amp; then some.',
            header_image: `${base}/img/grid.png`, developers: ['Test Studio'], price_overview: { currency: 'USD', initial: 3999, final: 1999, discount_percent: 50 },
            platforms: { windows: true, linux: false }, metacritic: { score: 88 }, categories: [{ id: 2 }, { id: 18 }], genres: [{ description: 'Strategy' }, { description: 'Indie' }],
            screenshots: [], release_date: { coming_soon: false, date: 'Jan 1, 2024' },
          } } });
        }
        const none = Math.floor(Number(id) / 10) % 2 === 1;
        return json(200, { [id]: { success: true, data: { categories: none ? [{ id: 2 }] : [{ id: 2 }, { id: 28 }] } } });
      }
      json(404, {});
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, key: KEY }));
  });
}

// ---- A stand-in for Steam's debugging port: a /json target list and a WebSocket that
// runs Runtime.evaluate against a fake SteamClient.Downloads, so the real expressions are exercised.
const crypto = require('crypto');
const vm = require('vm');

function fakeSteam(seed) {
  const state = {
    paused: false,
    items: seed || [
      { appid: 900050, queue_index: 0, active: true, paused: false, completed: false },
      { appid: 900060, queue_index: 1, active: false, paused: false, completed: false },
      { appid: 900070, queue_index: 2, active: false, paused: false, completed: false },
      { appid: 900080, queue_index: -1, active: false, paused: false, completed: true },
      { appid: 900090, queue_index: -1, active: false, paused: false, completed: false, deferred_time: 1893456000 },
    ],
    calls: [],
  };
  const reindex = () => state.items.filter((i) => !i.completed && (i.queue_index >= -0.5)).sort((a, b) => a.queue_index - b.queue_index).forEach((i, n) => { i.queue_index = n; i.active = n === 0 && !i.paused && !state.paused; });
  const find = (id) => state.items.find((i) => i.appid === Number(id));
  const Downloads = {
    RegisterForDownloadOverview(cb) {
      const top = state.items.find((i) => i.active);
      setTimeout(() => cb({
        paused: state.paused, update_appid: top ? top.appid : 0, update_network_bytes_per_second: top ? 5242880 : 0, update_state: top ? 'Updating' : 'None',
        overall_percent_complete: top ? 43 : 0, overall_estimated_time_remaining_sec: top ? 125 : -1, update_is_install: false,
        progress: [{ bytes_in_progress: 0, bytes_total: 0 }, { bytes_in_progress: top ? 430 * 1048576 : 0, bytes_total: top ? 1000 * 1048576 : 0 }],
      }), 5);
      return { unregister() {} };
    },
    RegisterForDownloadItems(cb) {
      setTimeout(() => cb(true, [{ remote_client_id: '0', item_data: JSON.parse(JSON.stringify(state.items)) }]), 5);
      return { unregister() {} };
    },
    PauseAppUpdate(id, client) { if (client !== '0') return; state.calls.push(['pause', id]); const i = find(id); if (i) i.paused = true; reindex(); },
    ResumeAppUpdate(id, client) { if (client !== '0') return; state.calls.push(['resume', id]); const i = find(id); if (i) { i.paused = false; i.queue_index = -0.5; i.deferred_time = 0; } reindex(); },
    QueueAppUpdate(id, client) { if (client !== '0') return; state.calls.push(['update', id]); const i = find(id); if (i) { i.queue_index = 99; i.deferred_time = 0; } else state.items.push({ appid: Number(id), queue_index: 99, active: false, paused: false, completed: false }); reindex(); },
    SetQueueIndex(id, idx, client) { if (client !== '0') return; state.calls.push(['move', id, idx]); const i = find(id); if (i) i.queue_index = idx < i.queue_index ? idx - 0.5 : idx + 0.5; reindex(); },
    RemoveFromDownloadList(id, client) { if (client !== '0') return; state.calls.push(['remove', id]); state.items = state.items.filter((i) => i.appid !== Number(id)); reindex(); },
    EnableAllDownloads(on, client) { if (client !== '0') return; state.calls.push(['all', on]); state.paused = !on; reindex(); },
  };
  // One game (900050) is mid-launch, processing Vulkan shaders, until something presses Skip.
  state.shaders = { nGameActionID: 77, gameid: '900050', strActionName: 'LaunchApp', strTaskName: 'ProcessingShaderCache', strTaskDetails: '', numDone: 43, numTotal: 100 };
  const Apps = {
    // A launch prompt listener, as Steam's own interface registers one.
    RegisterForGameActionUserRequest(cb) { state.userRequestListeners = (state.userRequestListeners || []).concat(cb); return { unregister() {} }; },
    GetActiveGameActions: async () => (state.shaders ? [state.shaders] : []),
    ContinueGameAction(id, what) {
      state.calls.push(['continue', id, what]);
      if (state.shaders && id === state.shaders.nGameActionID && what === 'SkipShaders') {
        const was = state.shaders;
        state.shaders = null;
        setTimeout(() => { state.shaders = { ...was, nGameActionID: was.nGameActionID + 1 }; }, 4000);   // ready for the next launch
      }
    },
  };
  const context = vm.createContext({ SteamClient: { Downloads, Apps }, setTimeout, Promise, JSON, String, Boolean });
  context.window = context;   // Steam's pages have a window object
  return { state, context };
}

function startSteamDebug(port, seed) {
  const steam = fakeSteam(seed);
  const server = http.createServer((req, res) => {
    if (req.url === '/json' || req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([
        { title: 'Steam', url: 'https://steamloopback.host/index.html', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/MAIN` },
        { title: 'SharedJSContext', url: 'https://steamloopback.host/index.html', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/SHARED` },
      ]));
    }
    if (req.url === '/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(steam.state)); }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => {
    if (!req.url.endsWith('/SHARED')) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (obj) => {
      const body = Buffer.from(JSON.stringify(obj));
      const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
      socket.write(Buffer.concat([head, body]));
    };
    let buf = Buffer.alloc(0);
    socket.on('data', async (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let at = 2;
        if (len === 126) { len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const mask = buf.subarray(at, at + 4);
        const data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((b, i) => b ^ mask[i % 4]);
        buf = buf.subarray(at + 4 + len);
        if (op === 8) { socket.end(); return; }
        if (op !== 1) continue;
        const msg = JSON.parse(data.toString());
        try {
          const value = await vm.runInContext(msg.params.expression, steam.context);
          send({ id: msg.id, result: { result: { type: typeof value, value } } });
        } catch (err) {
          send({ id: msg.id, result: { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: String(err) } } } });
        }
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port || 0, '127.0.0.1', () => resolve({ server, port: server.address().port, steam })));
}

module.exports = { start, startSteamDebug };
