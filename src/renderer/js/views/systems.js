// Systems: emulator detection and configuration, platforms and ROM folders.
import { h } from '../core/dom.js';
import { api, state, fmt } from '../core/state.js';
import { app } from '../core/bus.js';
import { actionTile } from '../ui/tile.js';
import { openPanel, confirm } from '../ui/dialog.js';
import { keyboard } from '../ui/osk.js';
import { browse } from '../ui/browser.js';
import { report } from '../ui/gamemenu.js';
import { toast } from '../ui/toast.js';

const VIA = { system: 'Installed', flatpak: 'Flatpak', appimage: 'AppImage', custom: 'Custom path' };

let onInstallProgress = null;
api.on('install:progress', (p) => { if (onInstallProgress) onInstallProgress(p); });

const mb = (bytes) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

function installDone(name, result) {
  if (result.ok) toast(result.note || `${name} is ready to use`, { title: `${name} installed`, iconName: 'download', ms: result.note ? 8000 : 3600 });
  else if (!result.cancelled) toast(result.error, { type: 'error', title: `Couldn’t install ${name}` });
}

/** Offer the ways to get an emulator, then run the chosen one with live progress. */
async function installEmulator(e, panel) {
  let plan = null;
  const waiting = panel.ask({ title: `Install ${e.name}`, subtitle: 'Looking for the latest release…', items: [{ label: 'Checking GitHub', disabled: true, iconName: 'cloud' }] });
  api.emulators.plan(e.id).then((p) => { plan = p; panel.cancel(); });
  await waiting;
  if (!plan) return;                       // backed out while checking
  if (!plan.ok) { toast(plan.error, { type: 'error' }); return; }

  const gh = plan.github;
  const fp = plan.flatpak;
  const method = await panel.ask({
    title: `Install ${e.name}`,
    subtitle: plan.repo ? `github.com/${plan.repo}` : (plan.page || '').replace(/^https?:\/\//, ''),
    items: [
      gh && { label: `Download ${gh.tag && gh.tag !== 'latest' ? gh.tag : 'the latest build'}`, value: 'github', iconName: 'download', sub: `${gh.name} · ${mb(gh.size)} · saved to ~/Applications` },
      !gh && plan.githubNote && { label: plan.githubNote, disabled: true },
      fp && fp.available && !fp.installed && { label: 'Install from Flathub', value: 'flatpak', iconName: 'layers', sub: `${fp.id} · for your user only` },
      fp && !fp.available && !gh && { label: 'Flatpak is not installed, so the Flathub build is unavailable', disabled: true },
      plan.page && { label: 'Open the project page', value: 'page', iconName: 'link', sub: plan.page.replace(/^https?:\/\//, '') },
    ],
  });
  if (method == null) return;
  if (method === 'page') { await report(api.emulators.openPage(e.id), 'Opened in your browser'); return; }

  let finished = false;
  const run = api.emulators.install(e.id, method).then((r) => { finished = true; panel.cancel(); return r; });
  const asking = panel.ask({
    title: `Installing ${e.name}`,
    subtitle: method === 'github' ? `From github.com/${plan.repo}` : `From Flathub · ${fp.id}`,
    items: [
      { label: method === 'github' ? 'Downloading' : 'Installing from Flathub. This can take a few minutes.', key: 'progress', disabled: true, hint: method === 'github' ? '0%' : '', meter: method === 'github' ? 0 : null },
      { label: 'Cancel', value: 'cancel', iconName: 'up' },
    ],
  });
  onInstallProgress = (p) => {
    if (p.id !== e.id) return;
    const row = panel.el.querySelector('[data-key="row:progress"]');
    if (!row) return;
    if (p.phase === 'download' && p.total) {
      const pct = Math.min(100, Math.round((p.received / p.total) * 100));
      row.querySelector('.row__hint').textContent = `${pct}%`;
      row.querySelector('.row__meter i').style.width = `${pct}%`;
      row.querySelector('.row__label').textContent = `Downloading · ${mb(p.received)} of ${mb(p.total)}`;
    } else if (p.phase === 'unpack') {
      row.querySelector('.row__label').textContent = 'Unpacking';
    }
  };
  const pick = await asking;
  if (pick === 'cancel') api.emulators.cancelInstall(e.id);
  if (finished || pick === 'cancel') {
    const result = await run;
    onInstallProgress = null;
    if (pick === 'cancel' && !result.ok) toast('Nothing was installed.', { title: 'Install cancelled', iconName: 'up' });
    else installDone(e.name, result);
  } else {
    // Backed out with B: let it finish in the background.
    toast(`${e.name} keeps installing in the background`, { iconName: 'download' });
    run.then((result) => { onInstallProgress = null; installDone(e.name, result); });
  }
}

export function createSystems() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--systems' }, scroller);

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` },
    h('h3', { class: 'block__title' }, title), h('div', { class: 'block__tiles' }, tiles));

  function render() {
    let i = 0;
    const emus = [...state.lib.emulators].sort((a, b) => Number(b.found) - Number(a.found) || b.gameCount - a.gameCount);
    const systems = [...state.lib.systems].sort((a, b) => b.count - a.count || Number(b.userDirs.length + b.autoDirs.length > 0) - Number(a.userDirs.length + a.autoDirs.length > 0));

    const emuTiles = emus.map((e) => actionTile({
      key: `e:${e.id}`, size: 'wide', index: i++,
      tone: e.found ? 'slate' : 'ghost',
      iconName: 'chip',
      label: e.name,
      sub: e.found ? `${VIA[e.via] || 'Ready'} · ${e.systems.join(', ')}` : (e.customPath ? 'Path not found' : 'Not installed'),
      count: e.found && e.gameCount ? e.gameCount : null,
      onSelect: () => emulatorMenu(e.id),
    }));

    const sysTiles = systems.map((s) => actionTile({
      key: `s:${s.id}`, size: 'square', index: i++,
      tone: s.count ? (s.issue ? 'gold' : 'violet') : 'ghost',
      label: s.short,
      sub: s.count ? fmt.count(s.count, 'game') : s.emulatorName,
      count: s.count || null,
      onSelect: () => systemMenu(s.id),
    }));

    const tools = [
      ...(state.lib.userRomRoots || []).map((root) => actionTile({
        key: `r:${root}`, size: 'wide', index: i++, tone: 'slate', iconName: 'folder', label: root.split('/').pop() || root, sub: root,
        onSelect: async () => {
          if (await confirm({ title: 'Remove this ROM library?', subtitle: `${root}\nThe files stay on disk.`, yes: 'Remove', danger: true, iconName: 'trash' })) {
            await report(api.emulators.removeRoot(root), 'ROM library removed');
          }
        },
      })),
      actionTile({ key: 'x:root', size: 'wide', index: i++, tone: 'accent', iconName: 'folder', label: 'Add ROM library', sub: 'A folder with one sub-folder per platform', onSelect: addRoot }),
      actionTile({ key: 'x:scan', size: 'wide', index: i++, tone: 'glass', iconName: 'refresh', label: 'Rescan everything', sub: 'Steam, emulators and ROM folders', onSelect: async () => { await report(api.library.rescan(), 'Library rescanned'); } }),
    ];

    scroller.replaceChildren(
      block('emulators', 'block--wide', emuTiles),
      block('platforms', 'block--quick', sysTiles),
      block('folders', 'block--wide', tools));
  }

  async function addRoot() {
    const dir = await browse({ mode: 'dir', title: 'Choose your ROM library folder', start: '~' });
    if (!dir) return;
    await report(api.emulators.addRoot(dir), 'ROM library added');
  }

  async function emulatorMenu(id) {
    const panel = openPanel();
    let selected = null;
    for (;;) {
      const e = state.lib.emulators.find((x) => x.id === id);
      if (!e) break;
      const choice = await panel.ask({
        title: e.name,
        subtitle: e.found ? `${VIA[e.via] || 'Ready'} · runs ${e.systems.join(', ')}` : (e.issue || 'Not installed'),
        selected,
        items: [
          { heading: 'Executable' },
          { label: e.display, value: 'noop', disabled: true },
          e.found && { label: `Open ${e.name}`, value: 'open', iconName: 'screen', sub: 'Configure controls, graphics and BIOS files' },
          !e.found && { label: `Install ${e.name}`, value: 'install', iconName: 'download', sub: e.repo ? `Latest release from github.com/${e.repo}` : 'From Flathub' },
          e.found && e.via === 'appimage' && e.repo && { label: 'Check for a newer build', value: 'install', iconName: 'download', sub: `github.com/${e.repo}` },
          { label: 'Set executable path', value: 'path', iconName: 'folder', sub: 'Point to a binary, script or AppImage' },
          { label: 'Launch arguments', value: 'args', iconName: 'terminal', sub: e.customArgs || `${e.defaultArgs}  (default)` },
          (e.customPath || e.customArgs) && { label: 'Reset to automatic', value: 'reset', iconName: 'refresh' },
          e.page && { label: 'Project page', value: 'page', iconName: 'link', sub: e.page.replace(/^https?:\/\//, '') },
        ],
      });
      if (choice == null) break;
      selected = choice;
      if (choice === 'install') await installEmulator(e, panel);
      if (choice === 'page') await report(api.emulators.openPage(id), 'Opened in your browser');
      if (choice === 'open') await report(api.emulators.open(id), `Opening ${e.name}`);
      if (choice === 'path') {
        const file = await browse({ mode: 'exec', title: `Locate ${e.name}`, start: e.customPath ? e.customPath.replace(/\/[^/]*$/, '') : '~' });
        if (file) await report(api.emulators.configure(id, { path: file }), `${e.name} path saved`);
      }
      if (choice === 'args') {
        const args = await keyboard({ title: `${e.name} launch arguments — {rom} is the game file`, value: e.customArgs || e.defaultArgs, placeholder: e.defaultArgs });
        if (args != null) await report(api.emulators.configure(id, { args: args.trim() === e.defaultArgs ? '' : args.trim() }));
      }
      if (choice === 'reset') await report(api.emulators.configure(id, { path: '', args: '' }), 'Back to automatic detection');
    }
    await panel.close();
  }

  async function systemMenu(id) {
    const panel = openPanel();
    let selected = null;
    for (;;) {
      const s = state.lib.systems.find((x) => x.id === id);
      if (!s) break;
      const choice = await panel.ask({
        title: s.name,
        subtitle: s.issue ? s.issue : `${fmt.count(s.count, 'game')} · plays with ${s.emulatorName}`,
        selected,
        items: [
          s.count > 0 && { label: `Browse ${fmt.count(s.count, 'game')}`, value: 'browse', iconName: 'grid' },
          { label: 'Emulator', value: 'emulator', iconName: 'chip', hint: s.emulatorName + (s.emulatorFound ? '' : ' (missing)') },
          { label: 'Add ROM folder', value: 'add', iconName: 'plus' },
          (s.userDirs.length || s.autoDirs.length) ? { heading: 'ROM folders' } : null,
          ...s.userDirs.map((d) => ({ label: d, value: `rm:${d}`, iconName: 'folder', sub: 'Added by you · select to remove', verb: 'Remove' })),
          ...s.autoDirs.map((d) => ({ label: d, value: 'noop', iconName: 'folder', sub: 'Detected automatically', disabled: true })),
        ],
      });
      if (choice == null) break;
      selected = choice;
      if (choice === 'browse') { await panel.close(); app.go('games', { filter: `sys:${id}`, enter: true }); return; }
      if (choice === 'add') {
        const dir = await browse({ mode: 'dir', title: `Where are your ${s.short} games?`, start: s.userDirs[0] || s.autoDirs[0] || '~' });
        if (dir) await report(api.emulators.configureSystem(id, { romDirs: [...new Set([...s.userDirs, dir])] }), 'Folder added');
      }
      if (choice.startsWith('rm:')) {
        await report(api.emulators.configureSystem(id, { romDirs: s.userDirs.filter((d) => d !== choice.slice(3)) }), 'Folder removed');
        selected = 'add';
      }
      if (choice === 'emulator') {
        const pick = await panel.ask({
          title: `${s.short} emulator`,
          subtitle: 'Choose what launches these games',
          selected: s.emulator,
          items: [
            { label: 'Automatic', value: '', iconName: 'refresh', sub: 'Use the first one that is installed' },
            ...s.candidates.map((cid) => {
              const e = state.lib.emulators.find((x) => x.id === cid);
              return { label: e.name, value: cid, iconName: 'chip', sub: e.found ? VIA[e.via] : 'Not installed', checked: s.emulator === cid };
            }),
          ],
        });
        if (pick != null) await report(api.emulators.configureSystem(id, { emulator: pick }));
      }
    }
    await panel.close();
  }

  return {
    id: 'systems',
    label: 'systems',
    el,
    render,
    defaultFocus: () => scroller.querySelector('[data-focus]'),
    onAction: () => false,
    hints: () => [{ a: 'accept', label: 'Configure' }],
    context(target) {
      const key = target?.dataset.key || '';
      if (key.startsWith('e:')) {
        const e = state.lib.emulators.find((x) => x.id === key.slice(2));
        return e && { title: e.name, meta: [e.found ? e.display : { warn: e.issue || 'Not installed' }, e.gameCount ? fmt.count(e.gameCount, 'game') : null].filter(Boolean) };
      }
      if (key.startsWith('s:')) {
        const s = state.lib.systems.find((x) => x.id === key.slice(2));
        return s && { title: s.name, meta: [s.issue && s.count ? { warn: s.issue } : `Plays with ${s.emulatorName}`, fmt.count(s.count, 'game'), [...s.userDirs, ...s.autoDirs][0]].filter(Boolean) };
      }
      const label = target?.querySelector('.tile__label');
      return label ? { title: label.firstChild?.textContent || '', meta: [label.querySelector('small')?.textContent].filter(Boolean) } : null;
    },
    backdrop: () => [],
  };
}
