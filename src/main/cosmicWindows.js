// Put a window on a chosen monitor under COSMIC.
//
// Wayland doesn't let an app place its own windows (Electron's setBounds and fullscreen
// requests land on whichever screen the window is already on), but COSMIC offers its own
// window-management protocols to apps on the desktop. This is a small Wayland client that
// speaks just enough of the wire protocol to find a window by its title, move it to the
// active workspace of the chosen output and fullscreen it there, then confirm where it is.
//
// Protocols: wayland core (wl_registry; wl_output v4 for connector names like "HDMI-A-2"),
// ext_foreign_toplevel_list_v1 (the windows), zcosmic_toplevel_info_v1 v2+ (a COSMIC handle
// per window: which outputs it is on, its state), zcosmic_toplevel_manager_v1 v4
// (set_fullscreen, unset_fullscreen, move_to_ext_workspace) and ext_workspace_manager_v1
// (each output's workspaces and which one is showing).
const net = require('net');
const path = require('path');

const pad4 = (n) => (n + 3) & ~3;
function str(s) {
  const b = Buffer.from(`${s}\0`, 'utf8');
  const out = Buffer.alloc(4 + pad4(b.length));
  out.writeUInt32LE(b.length, 0);
  b.copy(out, 4);
  return out;
}
function u32(...vals) { const b = Buffer.alloc(4 * vals.length); vals.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4)); return b; }
function readStr(body, at) {
  const len = body.readUInt32LE(at);
  return { value: len ? body.toString('utf8', at + 4, at + 4 + len - 1) : '', next: at + 4 + pad4(len) };
}
function readArray(body, at) { const len = body.readUInt32LE(at); return body.subarray(at + 4, at + 4 + len); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE_FULLSCREEN = 3;
const WS_ACTIVE = 1;

/** Is this a COSMIC session we can talk to? */
function available() {
  return Boolean(process.env.WAYLAND_DISPLAY && process.env.XDG_RUNTIME_DIR && /cosmic/i.test(`${process.env.XDG_CURRENT_DESKTOP || ''} ${process.env.XDG_SESSION_DESKTOP || ''}`));
}

/** Talk to the compositor. Resolves a session object once outputs, windows and workspaces are known. */
function connect(timeout = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(path.join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY));
    let nextId = 2;
    const objects = new Map([[1, 'wl_display']]);
    const globals = [];
    const outputs = new Map();     // wl_output id -> { id, name }
    const toplevels = new Map();   // foreign handle id -> { id, title, appId, cosmic, outputs:Set, fullscreen }
    const cosmic = new Map();      // cosmic handle id -> toplevel
    const groups = new Map();      // workspace group id -> { outputs:Set, workspaces:Set }
    const workspaces = new Map();  // workspace id -> { id, active }
    const syncs = new Map();
    let buf = Buffer.alloc(0);
    let registry = 0;
    let infoId = 0;
    let managerId = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('The desktop did not answer.')); }, timeout);

    const send = (obj, op, payload = Buffer.alloc(0)) => {
      const head = Buffer.alloc(8);
      head.writeUInt32LE(obj, 0);
      head.writeUInt32LE(((8 + payload.length) << 16) | op, 4);
      sock.write(Buffer.concat([head, payload]));
    };
    const newId = (type) => { const id = nextId++; objects.set(id, type); return id; };
    const sync = () => new Promise((done) => { const cb = newId('wl_callback'); syncs.set(cb, done); send(1, 0, u32(cb)); });
    const bind = (g, version) => {
      const id = newId(g.iface);
      send(registry, 0, Buffer.concat([u32(g.name), str(g.iface), u32(Math.min(version, g.version)), u32(id)]));
      return id;
    };

    function onEvent(obj, op, body) {
      const type = objects.get(obj);
      if (type === 'wl_display' && op === 0) throw new Error(`Wayland error: ${readStr(body, 8).value}`);
      if (type === 'wl_callback' && op === 0) { const fn = syncs.get(obj); syncs.delete(obj); objects.delete(obj); if (fn) fn(); return; }
      if (type === 'wl_registry' && op === 0) {
        const name = body.readUInt32LE(0);
        const s = readStr(body, 4);
        globals.push({ name, iface: s.value, version: body.readUInt32LE(s.next) });
        return;
      }
      if (type === 'wl_output' && op === 4) { outputs.get(obj).name = readStr(body, 0).value; return; }
      if (type === 'ext_foreign_toplevel_list_v1' && op === 0) {
        const id = body.readUInt32LE(0);
        objects.set(id, 'ext_foreign_toplevel_handle_v1');
        toplevels.set(id, { id, title: '', appId: '', identifier: '', cosmic: 0, outputs: new Set(), fullscreen: false });
        return;
      }
      if (type === 'ext_foreign_toplevel_handle_v1') {
        const t = toplevels.get(obj);
        if (op === 0) toplevels.delete(obj);
        else if (op === 2 && t) t.title = readStr(body, 0).value;
        else if (op === 3 && t) t.appId = readStr(body, 0).value;
        else if (op === 4 && t) t.identifier = readStr(body, 0).value;   // stable for the window's life
        return;
      }
      if (type === 'zcosmic_toplevel_handle_v1') {
        const t = cosmic.get(obj);
        if (!t) return;
        if (op === 4) t.outputs.add(body.readUInt32LE(0));            // output_enter
        else if (op === 5) t.outputs.delete(body.readUInt32LE(0));    // output_leave
        else if (op === 8) {                                          // state
          const a = readArray(body, 0);
          const states = [];
          for (let i = 0; i + 4 <= a.length; i += 4) states.push(a.readUInt32LE(i));
          t.fullscreen = states.includes(STATE_FULLSCREEN);
          t.minimized = states.includes(1);                         // minimized
          t.activated = states.includes(2);                         // has the keyboard
        }
        return;
      }
      if (type === 'ext_workspace_manager_v1') {
        if (op === 0) { const id = body.readUInt32LE(0); objects.set(id, 'ext_workspace_group_handle_v1'); groups.set(id, { outputs: new Set(), workspaces: new Set() }); }
        if (op === 1) { const id = body.readUInt32LE(0); objects.set(id, 'ext_workspace_handle_v1'); workspaces.set(id, { id, active: false }); }
        return;
      }
      if (type === 'ext_workspace_group_handle_v1') {
        const g = groups.get(obj);
        if (!g) return;
        if (op === 1) g.outputs.add(body.readUInt32LE(0));
        else if (op === 2) g.outputs.delete(body.readUInt32LE(0));
        else if (op === 3) g.workspaces.add(body.readUInt32LE(0));
        else if (op === 4) g.workspaces.delete(body.readUInt32LE(0));
        return;
      }
      if (type === 'ext_workspace_handle_v1') {
        const w = workspaces.get(obj);
        if (w && op === 3) w.active = Boolean(body.readUInt32LE(0) & WS_ACTIVE);
      }
    }

    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        while (buf.length >= 8) {
          const obj = buf.readUInt32LE(0);
          const word = buf.readUInt32LE(4);
          const size = word >>> 16;
          if (buf.length < size) break;
          const body = buf.subarray(8, size);
          buf = buf.subarray(size);
          onEvent(obj, word & 0xffff, body);
        }
      } catch (err) { clearTimeout(timer); sock.destroy(); reject(err); }
    });

    sock.on('connect', async () => {
      try {
        registry = newId('wl_registry');
        send(1, 1, u32(registry));
        await sync();
        const find = (iface) => globals.find((g) => g.iface === iface);
        const list = find('ext_foreign_toplevel_list_v1');
        const info = find('zcosmic_toplevel_info_v1');
        const manager = find('zcosmic_toplevel_manager_v1');
        const ws = find('ext_workspace_manager_v1');
        if (!list || !info || !manager || info.version < 2) throw new Error('This desktop does not let Halcyon move its window.');
        for (const g of globals.filter((x) => x.iface === 'wl_output')) { const id = bind(g, 4); outputs.set(id, { id, name: '' }); }
        bind(list, 1);
        infoId = bind(info, 3);
        managerId = bind(manager, 4);
        if (ws) bind(ws, 1);
        const seatG = globals.find((x) => x.iface === 'wl_seat');
        const seatId = seatG ? bind(seatG, 1) : 0;
        await sync();
        await sync();
        clearTimeout(timer);

        const handleOf = async (t) => {
          if (!t.cosmic) {
            t.cosmic = newId('zcosmic_toplevel_handle_v1');
            cosmic.set(t.cosmic, t);
            send(infoId, 1, u32(t.cosmic, t.id));   // get_cosmic_toplevel
            // Its outputs and state follow a moment later.
            for (let i = 0; i < 10 && !t.outputs.size; i++) { await sync(); await sleep(50); }
          }
          return t.cosmic;
        };
        const activeWorkspaceOn = (outputId) => {
          for (const g of groups.values()) {
            if (!g.outputs.has(outputId)) continue;
            for (const id of g.workspaces) if (workspaces.get(id)?.active) return id;
            return [...g.workspaces][0] || 0;
          }
          return 0;
        };

        resolve({
          outputs: () => [...outputs.values()],
          toplevels: () => [...toplevels.values()],
          /** Which outputs (connector names) a window is on, and whether it is fullscreen. */
          async where(t) {
            await handleOf(t);
            await sync();
            return { outputs: [...t.outputs].map((id) => outputs.get(id)?.name).filter(Boolean), fullscreen: t.fullscreen, minimized: Boolean(t.minimized), activated: Boolean(t.activated) };
          },
          /** Keep the connection's view current (new windows, their states). */
          refresh: () => sync(),
          /** Move a window to an output's showing workspace, fullscreen it there, and wait until it is. */
          async moveTo(t, outputId, { fullscreen = true, wait = 2500 } = {}) {
            const h = await handleOf(t);
            const already = t.outputs.has(outputId) && t.outputs.size === 1;
            if (!already) {
              if (t.fullscreen) { send(managerId, 8, u32(h)); await sync(); await sleep(150); }   // unset_fullscreen
              const wsId = activeWorkspaceOn(outputId);
              if (wsId && manager.version >= 4) send(managerId, 13, u32(h, wsId, outputId));    // move_to_ext_workspace
              await sync();
              await sleep(150);
            }
            if (fullscreen) send(managerId, 7, u32(h, outputId));                               // set_fullscreen
            await sync();
            const until = Date.now() + wait;
            while (Date.now() < until) {
              await sleep(100);
              await sync();
              if (t.outputs.has(outputId) && (!fullscreen || t.fullscreen)) return true;
            }
            return t.outputs.has(outputId);
          },
          /** Minimize a window. */
          async minimize(t) {
            const h = await handleOf(t);
            send(managerId, 5, u32(h));                                                     // set_minimized
            await sync();
            return true;
          },
          /** Bring a window to the front and give it the keyboard. */
          async activate(t) {
            if (!seatId) return false;
            const h = await handleOf(t);
            send(managerId, 2, u32(h, seatId));                                              // activate
            await sync();
            return true;
          },
          close() { sock.end(); },
        });
      } catch (err) { clearTimeout(timer); sock.destroy(); reject(err); }
    });
  });
}

/** The newest window with this title (and app id, if given). */
const pick = (list, title, appId) => list.filter((t) => t.title === title && (!appId || t.appId === appId)).pop();

/**
 * Put the window titled `title` on the output whose connector is `port` ("HDMI-A-2"),
 * fullscreen. Resolves { ok, on } or { ok: false, error }.
 */
async function moveWindow(title, port, { appId = null, fullscreen = true } = {}) {
  if (!available()) return { ok: false, error: 'not a COSMIC session' };
  let c;
  try {
    c = await connect();
    const out = c.outputs().find((o) => o.name === port);
    if (!out) return { ok: false, error: `no output ${port}` };
    const win = pick(c.toplevels(), title, appId);
    if (!win) return { ok: false, error: `no window titled ${title}` };
    const moved = await c.moveTo(win, out.id, { fullscreen });
    const now = await c.where(win);
    return { ok: moved, on: now.outputs, fullscreen: now.fullscreen, error: moved ? undefined : `the desktop left it on ${now.outputs.join(', ') || 'no screen'}` };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (c) c.close();
  }
}

/** Which outputs the window titled `title` is on now ([] if unknown). */
async function windowOutputs(title, appId = null) {
  if (!available()) return [];
  let c;
  try {
    c = await connect();
    const win = pick(c.toplevels(), title, appId);
    return win ? (await c.where(win)).outputs : [];
  } catch { return []; } finally { if (c) c.close(); }
}

/**
 * While a game starts, bring every new window to the screen Halcyon is on: COSMIC opens new
 * windows on the screen the pointer is on, which isn't Halcyon's after Halcyon has moved.
 * Fullscreen windows stay fullscreen there. Returns { stop }; it also stops by itself after ms.
 */
async function followNewWindows(port, { ms = 90000, skipTitles = [], onMove = () => {}, onNew = () => {}, focusIf = () => false, hideIf = () => false, log = () => {} } = {}) {
  if (!available() || !port) return { stop() {} };
  let c;
  try { c = await connect(); } catch { return { stop() {} }; }
  const out = c.outputs().find((o) => o.name === port);
  if (!out) { c.close(); return { stop() {} }; }
  const known = new Set(c.toplevels().map((t) => t.id));
  // Windows already moved, checked again for a while: a game going fullscreen (or setting
  // its own position) can put itself back on the screen it started on.
  const watched = new Map();   // toplevel id -> { t, until }
  let stopped = false;
  let errors = 0;
  const stop = () => { if (!stopped) { stopped = true; c.close(); } };
  const end = Date.now() + ms;
  const bring = async (t, why) => {
    const now = await c.where(t);
    if (now.outputs.length === 1 && now.outputs[0] === port) return now;
    const moved = await c.moveTo(t, out.id, { fullscreen: now.fullscreen, wait: 1500 });
    onMove({ title: t.title, from: now.outputs, to: port, ok: moved, why });
    return now;
  };
  (async () => {
    while (!stopped && Date.now() < end) {
      await sleep(400);
      if (stopped) break;
      try {
        await c.refresh();
        for (const t of c.toplevels()) {
          if (known.has(t.id) || !t.title) continue;
          known.add(t.id);
          if (skipTitles.includes(t.title)) continue;
          const info = { identifier: t.identifier, title: t.title, appId: t.appId };
          // Windows that only get in the way (Steam's own, while a game starts): never brought
          // over, and put away if they opened on this screen anyway.
          if (hideIf(info)) {
            const at = await c.where(t);
            const here = at.outputs.includes(port);
            if (here) await c.minimize(t);
            log(`new window "${t.title}" (${t.appId || 'no app id'}) opened on ${at.outputs.join(', ') || '?'}: ${here ? 'minimized' : 'left there'}`);
            continue;
          }
          onNew(info);
          const now = await bring(t, 'opened');
          log(`new window "${t.title}" (${t.appId || 'no app id'}) opened on ${now.outputs.join(', ') || '?'}${now.fullscreen ? ', fullscreen' : ''}`);
          watched.set(t.id, { t, until: Date.now() + 20000 });
          // The game itself gets the keyboard and controller, so it can be played straight away.
          if (focusIf(info)) { await sleep(300); await c.activate(t); }
        }
        for (const [id, w] of watched) {
          if (!c.toplevels().includes(w.t) || Date.now() > w.until) { watched.delete(id); continue; }
          const before = await c.where(w.t);
          if (before.outputs.length === 1 && before.outputs[0] === port) continue;
          await bring(w.t, 'went back');
          if (focusIf({ identifier: w.t.identifier, title: w.t.title, appId: w.t.appId })) await c.activate(w.t);
        }
        errors = 0;
      } catch (err) {
        log(`window follow: ${err.message}`);
        if (++errors >= 5) stop();
      }
    }
    stop();
  })();
  return { stop };
}

/**
 * Move every window that pick(window) accepts to the output `port`, keeping fullscreen ones
 * fullscreen. pick gets { identifier, title, appId }. Resolves [{ title, ok, from }].
 */
async function moveWindows(pick, port) {
  if (!available()) return [];
  let c;
  try {
    c = await connect();
    const out = c.outputs().find((o) => o.name === port);
    if (!out) return [];
    const moved = [];
    for (const t of c.toplevels()) {
      if (!pick({ identifier: t.identifier, title: t.title, appId: t.appId })) continue;
      const now = await c.where(t);
      if (now.outputs.length === 1 && now.outputs[0] === port) { moved.push({ title: t.title, ok: true, from: now.outputs }); continue; }
      const ok = await c.moveTo(t, out.id, { fullscreen: now.fullscreen, wait: 2000 });
      moved.push({ title: t.title, ok, from: now.outputs });
    }
    return moved;
  } catch { return []; } finally { if (c) c.close(); }
}

/** Bring the newest window that pick(window) accepts to the front. Resolves its title or ''. */
async function activateWindow(pick) {
  if (!available()) return '';
  let c;
  try {
    c = await connect();
    const t = c.toplevels().filter((x) => pick({ identifier: x.identifier, title: x.title, appId: x.appId })).pop();
    if (!t) return '';
    return (await c.activate(t)) ? t.title : '';
  } catch { return ''; } finally { if (c) c.close(); }
}

module.exports = { available, connect, moveWindow, windowOutputs, followNewWindows, moveWindows, activateWindow };
