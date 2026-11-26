(async () => {
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const focus = await import('./js/core/focus.js');
  (await import('./js/core/input.js')).setAlwaysLive(true);   // do not depend on owning desktop focus
  const volumeAtStart = (await window.halcyon.system.status()).volume;
  const mk = () => ({ pressed: false, value: 0 });
  const pad = { index: 0, id: 'Test Pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk) };
  navigator.getGamepads = () => [pad];
  const press = async (b, hold = 80) => { pad.buttons[b] = { pressed: true, value: 1 }; await sleep(hold); pad.buttons[b] = mk(); await sleep(140); };
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const toasts = [];
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => toasts.push(n.textContent)))).observe(document.getElementById('toasts'), { childList: true });
  const cur = () => focus.current()?.dataset.key;
  const section = () => document.querySelector('.tab.is-active').textContent;
  const overlay = () => document.querySelector('.layer--launch:not(.is-closing) .launch__status')?.textContent || null;
  const panel = () => document.querySelector('.layer--panel:not(.is-closing) .panel__title')?.textContent || null;
  const check = (name, ok, extra = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  const ids = {};
  try {
  for (const [k, g] of Object.entries({ fail: { name: 'Fail Test', command: "sh -c 'exit 3'" }, nodir: { name: 'Missing Dir', command: 'true', cwd: '/nope' }, sleeper: { name: 'Sleeper', command: 'sleep 2' }, nocmd: { name: 'Ghost', command: '/nope/ghost-bin' } })) {
    ids[k] = (await window.halcyon.custom.save(g)).id;
  }
  document.querySelector('[data-key="tab:home"]').click();
  await sleep(600);
  check('pad detected + toast', document.querySelectorAll('#pads .pad:not(.pad--none)').length === 1 && toasts.some((t) => t.includes('Controller connected')), toasts.join(' / '));

  // d-pad + analog stick + held repeat on home
  focus.focus(document.querySelector('.view--home [data-focus]'));
  const start = cur();
  await press(B.RIGHT); const a = cur();
  pad.axes[0] = 0.9; await sleep(80); pad.axes[0] = 0; await sleep(140); const b = cur();
  check('d-pad right moves', a !== start, `${start} -> ${a}`);
  check('left stick right moves', b !== a, `${a} -> ${b}`);
  await press(B.LEFT, 1200); check('held d-pad repeats back to first tile', cur() === start, cur());
  check('pad mode glyphs', document.body.dataset.input === 'pad' && document.querySelector('#hints .glyph--accept').textContent === 'A');

  // bumpers
  await press(B.RB); await sleep(500); check('RB -> games', section() === 'games', cur());
  const pause = () => sleep(420);   // section switches have a 500 ms cooldown
  for (let i = 0; i < 6; i++) { await press(B.RB); await pause(); }
  await sleep(200); check('RB clamps at settings', section() === 'settings');
  for (let i = 0; i < 4; i++) { await press(B.LB); await pause(); }
  await sleep(200); check('LB x4 -> games', section() === 'games');
  await sleep(600); await press(B.RB, 40); await press(B.RB, 40); await sleep(300);
  check('a fast double RB moves one section only', section() === 'store', section());
  await sleep(600); await press(B.LB); await sleep(400);

  // triggers page in grid, cycle category on chips
  document.querySelector('[data-key="f:all"]').click(); await sleep(300);
  focus.focus(document.querySelector('.wall .tile'));
  const g0 = cur(); await press(B.RT); const g1 = cur();
  const idx = (k) => [...document.querySelectorAll('.wall .tile')].findIndex((t) => t.dataset.key === k);
  check('RT pages 5 columns', idx(g1) - idx(g0) === 10, `${idx(g0)} -> ${idx(g1)}`);
  await press(B.DOWN); const g2 = cur(); check('down moves to second row', idx(g2) === idx(g1) + 1);
  await press(B.X); await sleep(400); check('X favorites game', document.querySelector(`[data-key="${g2}"] .badge--fav`) != null && cur() === g2);
  await press(B.X); await sleep(400); check('X unfavorites', document.querySelector(`[data-key="${g2}"] .badge--fav`) == null);
  await press(B.UP); await press(B.UP); check('up reaches chips', cur()?.startsWith('f:') || cur()?.startsWith('t:'), cur());
  await press(B.RT); await sleep(300); check('RT on chips cycles category', document.querySelector('.chip.is-active').dataset.key !== 'f:all', document.querySelector('.chip.is-active').dataset.key);

  // options blade + collections + OSK via pad
  document.querySelector('[data-key="f:custom"]').click(); await sleep(300);
  focus.focusKey(`g:${ids.sleeper}`);
  await press(B.Y); await sleep(500); check('Y opens options blade', panel() === 'Sleeper');
  await press(B.DOWN); await press(B.DOWN); await press(B.A); await sleep(400); check('collections picker', panel() === 'Collections');
  await press(B.A); await sleep(500); check('OSK opens', !!document.querySelector('.layer--osk'));
  focus.focusKey('k:1:0'); await press(B.A); focus.focusKey('k:1:1'); await press(B.A); await press(B.Y); await press(B.LT); await sleep(100); focus.focusKey('k:2:0'); await press(B.A); await press(B.X); await press(B.LT); focus.focusKey('k:2:0'); await press(B.A);
  const typed = document.querySelector('.osk__field span').textContent;
  check('OSK typing/space/shift/delete', typed === 'qw A', JSON.stringify(typed));
  await press(B.START); await sleep(700);
  const lib = await window.halcyon.library.get();
  const col = lib.collections.find((c) => c.name === 'qw A');
  check('collection created + game added', !!col && lib.games.find((g) => g.id === ids.sleeper).collections.includes(col?.id));
  await press(B.B); await sleep(300); await press(B.B); await sleep(500); check('B closes blades', panel() === null && cur() === `g:${ids.sleeper}`, cur());

  // launching
  toasts.length = 0;
  await press(B.A); await sleep(1000); check('A launches: overlay up', overlay() !== null, overlay());
  await press(B.Y); await sleep(300); check('input swallowed while launching', panel() === null);
  await sleep(2600); check('overlay closes when game exits', overlay() === null);
  check('played game recorded', (await window.halcyon.library.get()).games.find((g) => g.id === ids.sleeper).lastPlayed > 0);

  focus.focusKey(`g:${ids.fail}`); await press(B.A); await sleep(1800);
  check('instant crash reported', toasts.some((t) => t.includes('exited immediately (code 3)')) && overlay() === null, toasts.join(' / '));
  await sleep(6500); toasts.length = 0;
  focus.focusKey(`g:${ids.nodir}`); await press(B.A); await sleep(1500);
  check('bad working dir reported', toasts.some((t) => t.includes('Working directory does not exist')), toasts.join(' / '));
  check('missing command flagged on tile', !!document.querySelector(`[data-key="g:${ids.nocmd}"] .badge--warn`));

  await sleep(6500); toasts.length = 0;
  document.querySelector('[data-key="f:sys:gba"]').click(); await sleep(300);
  focus.focus(document.querySelector('.wall .tile')); await press(B.A); await sleep(1500);
  if ((await window.halcyon.library.get()).systems.find((x) => x.id === 'gba').emulatorFound) {
    check('GBA launch resolves (dry run)', overlay() === 'Now playing', String(overlay())); await press(B.B); await sleep(600);
  } else {
    check('missing emulator reported', toasts.some((t) => t.includes('mGBA was not found')), toasts.join(' / '));
  }
  document.querySelector('[data-key="f:sys:wiiu"]').click(); await sleep(300);
  focus.focus(document.querySelector('.wall .tile')); await press(B.A); await sleep(1300);
  check('Wii U launch resolves (dry run)', overlay() === 'Now playing', String(overlay()));
  await press(B.B); await sleep(600); check('B dismisses now-playing card', overlay() === null);
  document.querySelector('[data-key="f:steam"]').click(); await sleep(300);
  focus.focus(document.querySelector('.wall .tile')); await press(B.A); await sleep(1300);
  check('Steam launch resolves (dry run), waiting on Steam', /Starting in Steam|Now playing/.test(String(overlay())), String(overlay())); await press(B.B); await sleep(600);

  // back stack + exit dialog
  await press(B.B); await sleep(300); check('B from grid -> category chips', cur()?.startsWith('f:'), cur());
  await press(B.B); await sleep(600); check('B -> home', section() === 'home');
  await press(B.B); await sleep(700); check('B on home -> guide', panel() === 'guide');
  const row = (k) => document.querySelector(`.layer--left [data-key="row:${k}"]`);
  const blade = () => document.querySelector('.layer--guide:not(.is-closing)')?.dataset.blade;
  const spines = () => [...document.querySelectorAll('.layer--guide .guide__blade, .layer--guide .guide__spine')].map((n) => n.textContent).join('|');
  check('guide opens on the home blade with the others beside it', blade() === 'home' && spines() === 'games & apps|home|downloads|settings' && !!row('go:home') && !!row('search'), spines());
  await press(B.LB); await sleep(450);
  check('LB moves to games & apps (recent games)', blade() === 'games' && !!document.querySelector('.layer--left [data-key^="row:play:"]') && !!row('go:games'));
  await press(B.LEFT); await sleep(300);
  check('no blade past the first', blade() === 'games');
  for (let i = 0; i < 3; i++) { await press(B.RIGHT); await sleep(450); }
  check('right moves blade by blade to settings (volume and power)', blade() === 'system' && !!row('volume') && !!row('power:shutdown'), blade());
  const vol0 = (await window.halcyon.system.status()).volume;
  focus.focus(row('volume'));
  await press(B.RIGHT); await sleep(400);
  const vol1 = (await window.halcyon.system.status()).volume;
  check('guide volume up changes system volume', vol1.level > vol0.level || vol0.level >= 100, `${vol0.level} -> ${vol1.level}`);
  check('volume row repaints', row('volume').querySelector('.row__hint').textContent === `${vol1.level}%`);
  await press(B.A); await sleep(400);
  check('A on volume mutes', (await window.halcyon.system.status()).volume.muted === true && row('volume').querySelector('.row__hint').textContent === 'Muted');
  await window.halcyon.system.setVolume({ level: vol0.level, muted: vol0.muted }); await sleep(200);
  const vol2 = (await window.halcyon.system.status()).volume;
  check('volume restored', vol2.level === vol0.level && vol2.muted === vol0.muted, `${vol2.level} ${vol2.muted}`);
  toasts.length = 0;
  focus.focus(row('power:shutdown')); await press(B.A); await sleep(400);
  check('shut down asks first, Cancel selected', panel() === 'Shut down the system?' && focus.current()?.textContent.includes('Cancel'));
  await press(B.A); await sleep(400); check('cancel returns to guide on same row', panel() === 'guide' && cur() === 'row:power:shutdown', cur());
  await press(B.A); await sleep(300); await press(B.UP); await press(B.A); await sleep(900);
  check('confirmed shut down reaches system (dry run)', toasts.some((t) => t.includes('Dry run')) && panel() === null, toasts.join(' / '));
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(600);
  check('Guide button opens guide', panel() === 'guide');
  focus.focus(row('search')); await press(B.A); await sleep(900);
  check('guide search opens keyboard on games', section() === 'games' && !!document.querySelector('.layer--osk'));
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(600);
  check('guide over keyboard offers only settings', panel() === 'guide' && !row('go:home') && !!row('volume') && spines() === 'settings', spines());
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(600);
  check('Guide button closes guide', panel() === null && !!document.querySelector('.layer--osk'));
  await press(B.B); await sleep(500);

  // idle dimming: any input wakes the screen without acting on it
  const bus = await import('./js/core/bus.js');
  const beforeIdle = cur();
  bus.app.idleMs = 300; await sleep(2600);
  check('screen dims when idle', document.body.classList.contains('is-idle'));
  bus.app.idleMs = 300000; await press(B.RIGHT);
  check('first press only wakes', !document.body.classList.contains('is-idle') && cur() === beforeIdle, cur());

  // autostart toggle writes and removes the desktop entry
  const had = (await window.halcyon.system.status()).autostart;
  await window.halcyon.system.setAutostart(!had);
  const flipped = (await window.halcyon.system.status()).autostart;
  await window.halcyon.system.setAutostart(had);
  check('start-on-login toggles', flipped === !had && (await window.halcyon.system.status()).autostart === had);

  // ---- sound packs: levelled on load, leading silence skipped
  const packs = await window.halcyon.sounds.list();
  check('test sound pack is listed', packs.packs.some((p) => p.id === 'test-pack' && p.name === 'Test Pack'), JSON.stringify(packs.packs));
  await window.halcyon.settings.set({ soundPack: 'test-pack' });
  const sfxMod = await import('./js/core/sfx.js');
  let levelsOk = false;
  for (let t = 0; t < 30 && !levelsOk; t++) { levelsOk = Object.keys(sfxMod.packLevels()).length >= 3; if (!levelsOk) await sleep(150); }
  const lv = sfxMod.packLevels();
  check('loud click is turned down, quiet whoosh turned up', levelsOk && lv.move.gain < 0.2 && lv.sectionRight.gain > 2, JSON.stringify(lv));
  check('silence before the whoosh is skipped', Math.abs(lv.sectionRight.offsetMs - 195) <= 10 && lv.move.offsetMs === 0, JSON.stringify(lv));
  await window.halcyon.settings.set({ soundPack: '' }); await sleep(300);
  check('built-in tones come back', Object.keys(sfxMod.packLevels()).length === 0);

  // ---- Steam store (mock storefront)
  const waitUntil = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(120); } return false; };
  document.querySelector('[data-key="tab:store"]').click();
  check('store loads its rails', await waitUntil(() => document.querySelectorAll('.view--store .tile--store').length === 5), `${document.querySelectorAll('.view--store .tile--store').length} tiles`);
  const titles = [...document.querySelectorAll('.view--store .block__title')].map((n) => n.textContent.trim());
  check('rails are named and packages / duplicates dropped', ['on sale', 'top sellers', 'new releases', 'coming soon'].every((t) => titles.includes(t)) && !document.body.textContent.includes('A Package'), titles.join(','));
  const sale = document.querySelector('[data-key="st:specials:900110"]');
  check('sale price shows discount and both prices', sale.querySelector('.price__cut').textContent === '-50%' && /39\.99/.test(sale.querySelector('.price__was').textContent) && /20\.00|19\.99/.test(sale.querySelector('.price__now').textContent), sale.querySelector('.price').textContent);
  check('free and unpriced games', document.querySelector('[data-key="st:new_releases:900310"] .price__now').textContent === 'Free' && !document.querySelector('[data-key="st:coming_soon:900410"] .price'));
  focus.focus(sale); await sleep(300);
  check('store context line', document.querySelector('.context__title').textContent === 'Sale Game' && /50% off/.test(document.querySelector('.context__meta').textContent), document.querySelector('.context__meta').textContent);
  toasts.length = 0;
  await press(B.A);
  check('store page opens with details', await waitUntil(() => panel() === 'Game 900110' && [...document.querySelectorAll('.layer--panel .row__label')].some((n) => n.textContent === 'A fine game & then some.')), String(panel()));
  const labels = () => [...document.querySelectorAll('.layer--panel .row__label')].map((n) => n.textContent);
  check('details list controller and Proton info', labels().includes('Partial controller support') && labels().includes('Windows game: runs through Proton') && labels().includes('Strategy, Indie') && labels().includes('Buy in Steam'), labels().join(' | '));
  await press(B.A); await sleep(700);
  check('Buy hands off to Steam (dry run)', toasts.some((t) => t.includes('Opening the store page in Steam')) && panel() === 'Game 900110', toasts.join(' / '));
  await press(B.B); await sleep(500);
  await press(B.START); await sleep(600);
  focus.focusKey('k:1:0'); await press(B.A); focus.focusKey('k:1:1'); await press(B.A); await press(B.START);
  check('store search shows results', await waitUntil(() => !!document.querySelector('[data-key="st:search:900510"]')) && document.querySelector('[data-key="st:search:900510"] .tile__title').textContent === 'Found: qw' && document.querySelectorAll('.view--store .tile--store').length === 1);
  await sleep(300); await press(B.B); await sleep(500);
  check('B clears the search', !document.querySelector('[data-key="st:search:900510"]') && document.querySelectorAll('.view--store .tile--store').length === 5 && section() === 'store');
  const missing = await window.halcyon.store.details('900999');
  check('a missing store page is reported', missing.ok === false && /no store page/.test(missing.error));

  // ---- owned-but-uninstalled games (mock Steam Web API)
  const badSteam = await window.halcyon.steam.setKey('nope');
  check('bad Steam key is rejected and not saved', badSteam.ok === false && /rejected/.test(badSteam.error) && !(await window.halcyon.library.get()).steamAccount.hasKey, badSteam.error);
  const goodSteam = await window.halcyon.steam.setKey('steam-test-key'); await sleep(500);
  let libS = await window.halcyon.library.get();
  const notInstalled = libS.games.filter((g) => !g.installed);
  check('owned games appear as not installed (tools filtered)', goodSteam.ok && goodSteam.count === 3 && notInstalled.length === 2 && notInstalled.every((g) => g.source === 'steam') && libS.steamAccount.hasKey && !JSON.stringify(libS).includes('steam-test-key'), notInstalled.map((g) => g.name).join(','));
  document.querySelector('[data-key="tab:home"]').click(); await sleep(400);
  check('home only offers installed games', !document.querySelector('.view--home .tile--uninstalled'));
  document.querySelector('[data-key="tab:games"]').click(); await sleep(400);
  document.querySelector('[data-key="f:uninstalled"]').click(); await sleep(400);
  check('“Not installed” category', document.querySelectorAll('.wall .tile--uninstalled').length === 2 && document.querySelectorAll('.wall .tile').length === 2);
  focus.focus(document.querySelector('[data-key="g:steam:900010"]')); await sleep(200);
  check('hint says Install', [...document.querySelectorAll('#hints .hint__label')].some((n) => n.textContent === 'Install') && /Not installed/.test(document.querySelector('.context__meta').textContent));
  toasts.length = 0; await press(B.A); await sleep(900);
  check('A asks Steam to install (dry run), no launch card', toasts.some((t) => t.includes('Installing Owned Game A')) && overlay() === null, toasts.join(' / '));
  check('uninstalled game was not marked as played', (await window.halcyon.library.get()).games.find((g) => g.id === 'steam:900010').playCount === 0);
  document.querySelector('[data-key="tab:store"]').click(); await sleep(500);
  check('store marks games you own', !!document.querySelector('[data-key="st:specials:900010"] .badge') && !document.querySelector('[data-key="st:specials:900110"] .badge'));
  await window.halcyon.settings.set({ showUninstalled: false }); await sleep(400);
  check('uninstalled games can be turned off', (await window.halcyon.library.get()).games.every((g) => g.installed));
  await window.halcyon.settings.set({ showUninstalled: true }); await sleep(300);

  // ---- download progress (a stand-in Steam library with one game mid-download)
  const steamlib = (await window.halcyon.app.info()).configFile.replace(/config\/config\.json$/, 'steamlib');
  const manifest = `${steamlib}/steamapps/appmanifest_900050.acf`;
  const rewrite = async (from, to) => { const c = await window.halcyon.custom.save({ name: 'Edit manifest', command: `sed -i 's/${from}/${to}/' '${manifest}'` }); await window.halcyon.game.launch(c.id); await sleep(300); await window.halcyon.custom.remove(c.id); };
  check('stand-in Steam library is accepted', (await window.halcyon.steam.addRoot(steamlib)).ok === true);
  await sleep(500);
  const dl = (await window.halcyon.library.get()).games.find((g) => g.id === 'steam:900050');
  check('downloading game reports phase and percent', !!dl && dl.installed && dl.download.phase === 'downloading' && dl.download.percent === 43, JSON.stringify(dl && dl.download));
  document.querySelector('[data-key="tab:games"]').click(); await sleep(400);
  document.querySelector('[data-key="f:downloads"]').click(); await sleep(400);
  const dlTile = document.querySelector('[data-key="g:steam:900050"]');
  check('tile shows a progress strip', dlTile.querySelector('.tile__progress-label').textContent === 'Downloading 43%' && dlTile.querySelector('.tile__progress i').style.width === '43%');
  await rewrite('"BytesDownloaded"\\t\\t"430"', '"BytesDownloaded"\\t\\t"800"');
  check('progress updates live', await waitUntil(() => document.querySelector('[data-key="g:steam:900050"] .tile__progress-label')?.textContent === 'Downloading 80%', 6000), document.querySelector('[data-key="g:steam:900050"] .tile__progress-label')?.textContent);
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(700);
  check('home blade counts downloads', row('downloads')?.querySelector('.row__hint')?.textContent === '1', row('downloads')?.textContent);
  await press(B.RB); await sleep(500);
  check('Guide shows a live download card', panel() === 'guide' && document.querySelector('.layer--left .dlcard__pct')?.textContent === '80%' && document.querySelector('.layer--left .dlcard__title')?.textContent === 'Download Test' && /of/.test(document.querySelector('.layer--left .dlcard__line')?.textContent || ''), document.querySelector('.layer--left .dlcard')?.textContent);
  await press(B.B); await sleep(500);

  // ---- download manager (stand-in Steam debugging port; the real Steam folder is never touched)
  const dlRow = (k) => document.querySelector(`.layer--panel [data-key="row:${k}"]`);
  const st0 = await window.halcyon.downloads.status();
  check('download controls start off', st0.enabled === false && st0.connected === false);
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(700);
  await press(B.RB); await sleep(500);
  focus.focus(document.querySelector('.layer--left [data-key="row:dlcard"]')); await press(B.A);
  check('Guide › Downloads opens the manager (read-only, with the progress card)', await waitUntil(() => panel() === 'downloads' && !!dlRow('enable') && document.querySelector('.layer--panel .dlcard__pct')?.textContent === '80%'), String(panel()));
  focus.focus(dlRow('enable')); await press(B.A); await sleep(500);
  const topPanel = () => [...document.querySelectorAll('.layer--panel:not(.is-closing) .panel__title')].pop()?.textContent || null;
  check('turning on asks first, Cancel selected', topPanel() === 'Turn on download controls?' && focus.current()?.textContent.includes('Cancel'));
  toasts.length = 0; await press(B.UP); await press(B.A);
  check('confirmed: controls on and connected', await waitUntil(async () => { const st = await window.halcyon.downloads.status(); return st.enabled && st.connected; }) && toasts.some((t) => t.includes('Restart Steam')), toasts.join(' / '));
  check('connected: card shows the active game, up next in Steam’s order', await waitUntil(() => document.querySelector('.layer--panel .dlcard__title')?.textContent === 'Download Test' && !!dlRow('item:900070')) && /5\.0 MB\/s/.test(document.querySelector('.layer--panel .dlcard__line').textContent) && dlRow('item:900060').querySelector('.row__hint').textContent === '#1' && dlRow('item:900070').querySelector('.row__hint').textContent === '#2' && !dlRow('item:900050'), document.querySelector('.layer--panel .dlcard')?.textContent);
  check('finished downloads listed separately', !!dlRow('clear:900080'));
  check('scheduled updates show when they will run', /^Scheduled for /.test(dlRow('sched:900090')?.querySelector('.row__sub')?.textContent || '') && !dlRow('item:900090'), dlRow('sched:900090')?.querySelector('.row__sub')?.textContent);
  focus.focus(dlRow('item:900070')); await press(B.A); await sleep(500);
  check('a queued game offers its actions', /^(Steam app 900070|Game 900070)$/.test(panel()) && [...document.querySelectorAll('.layer--panel .row__label')].map((n) => n.textContent).join('|') === 'Download now|Move to the top|Move up|Remove from the queue', [...document.querySelectorAll('.layer--panel .row__label')].map((n) => n.textContent).join('|'));
  focus.focus([...document.querySelectorAll('.layer--panel .row')].find((r) => r.textContent.includes('Move to the top'))); await press(B.A);
  check('move to the top: next after the active download', await waitUntil(async () => { const its = (await window.halcyon.downloads.status()).items.filter((i) => !i.completed && !i.scheduled); return its[0].appid === '900050' && its[1].appid === '900070'; }) && await waitUntil(() => dlRow('item:900070')?.querySelector('.row__hint')?.textContent === '#1', 4000));
  focus.focus(dlRow('sched:900090')); await press(B.A); await sleep(500);
  check('a scheduled update offers Update now', /900090/.test(panel()) && focus.current()?.textContent.includes('Update now'), panel());
  await press(B.A);
  check('Update now makes it the active download', await waitUntil(async () => { const st = await window.halcyon.downloads.status(); const it = st.items.find((i) => i.appid === '900090'); return it && !it.scheduled && it.position === 0; }) && await waitUntil(() => /900090/.test(document.querySelector('.layer--panel .dlcard__title')?.textContent || ''), 5000), document.querySelector('.layer--panel .dlcard__title')?.textContent);
  focus.focus(dlRow('pauseAll')); await press(B.A);
  check('pause all', await waitUntil(async () => (await window.halcyon.downloads.status()).paused === true) && await waitUntil(() => !!dlRow('resumeAll'), 4000));
  focus.focus(dlRow('resumeAll')); await press(B.A);
  check('resume all', await waitUntil(async () => (await window.halcyon.downloads.status()).paused === false));
  focus.focus(dlRow('clear:900080')); await press(B.A);
  check('clear a finished download', await waitUntil(async () => !(await window.halcyon.downloads.status()).items.some((i) => i.appid === '900080')));
  const fail = await window.halcyon.downloads.control('pause', 'nope');
  check('bad requests are refused before reaching Steam', fail.ok === false && /Unknown download/.test(fail.error));
  await press(B.B); await sleep(500);

  // ---- Steam's shader processing, shown on Halcyon's launch card (stand-in Steam)
  (await import('./js/core/bus.js')).app.launch('steam:900050');
  const card = () => document.querySelector('.layer--launch:not(.is-closing) .launch__status')?.textContent || '';
  check('launch card shows Steam processing shaders', await waitUntil(() => /Processing Vulkan shaders\s+43%/.test(card()), 6000) && document.querySelector('.layer--launch .launch__bar.is-determinate i')?.style.width === '43%', card());
  check('A to skip is offered', [...document.querySelectorAll('#hints .hint__label')].some((n) => n.textContent === 'Skip shader processing'));
  await press(B.A);
  check('A skips shader processing in Steam', await waitUntil(() => /Skipping shader processing|Starting/.test(card()) && ![...document.querySelectorAll('#hints .hint__label')].some((n) => n.textContent === 'Skip shader processing'), 4000), card());
  await waitUntil(() => [...document.querySelectorAll('#hints .hint__label')].some((n) => n.textContent === 'Return to dashboard'), 5000);
  await press(B.B); await sleep(600);
  check('B returns to the dashboard', !document.querySelector('.layer--launch:not(.is-closing)'), card());
  focus.focus(dlRow('pauseAll') || document.querySelector('.layer--panel .row'));
  await press(B.B); await sleep(500);
  check('manager closes', panel() === null, String(panel()));
  await window.halcyon.downloads.enable(false);
  check('turning off removes the switch', (await window.halcyon.downloads.status()).enabled === false);
  toasts.length = 0;
  await rewrite('"StateFlags"\\t\\t"1026"', '"StateFlags"\\t\\t"4"');
  check('finished download is announced', await waitUntil(() => toasts.some((t) => t.includes('Download Test is ready to play')), 20000), toasts.join(' / '));
  check('finished game has no progress left', (await window.halcyon.library.get()).games.find((g) => g.id === 'steam:900050').download === null);
  await window.halcyon.steam.removeRoot(steamlib); await sleep(500);
  await window.halcyon.steam.setKey(''); await sleep(300);
  check('removing the key removes uninstalled games', (await window.halcyon.library.get()).games.every((g) => g.installed) && !(await window.halcyon.library.get()).steamAccount.hasKey);
  document.querySelector('[data-key="f:all"]').click(); await sleep(300);

  // ---- Steam Big Picture option (dry run: nothing is sent to Steam)
  const aSteamGame = (await window.halcyon.library.get()).games.find((g) => g.source === 'steam' && g.installed);
  const plain = await window.halcyon.game.launch(aSteamGame.id);
  check('Big Picture is off by default', plain.ok && plain.bigPicture === false && (await window.halcyon.system.status()).bigPictureOpen === false);
  await window.halcyon.settings.set({ steamBigPicture: true }); await sleep(300);
  const viaBpm = await window.halcyon.game.launch(aSteamGame.id);
  check('games start without Big Picture even with the option on', viaBpm.ok && viaBpm.bigPicture === false && (await window.halcyon.system.status()).bigPictureOpen === false);
  check('store hand-off also uses Big Picture', (await window.halcyon.steam.action('store', aSteamGame.id.slice(6))).bigPicture === true);
  document.querySelector('[data-key="tab:home"]').click(); await sleep(400);
  pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(700);
  const leave = document.querySelector('.layer--left [data-key="row:leavebpm"]');
  check('Guide offers a way out of Big Picture', panel() === 'guide' && !!leave);
  if (leave) { focus.focus(leave); await press(B.A); await sleep(700); }
  check('closing Big Picture is recorded', (await window.halcyon.system.status()).bigPictureOpen === false && panel() === null);
  await window.halcyon.settings.set({ steamBigPicture: false }); await sleep(300);

  // ---- in-game menu: Home while a game Halcyon started is running
  const long = await window.halcyon.custom.save({ name: 'Long Game', command: 'sleep 60' }); await sleep(400);
  await window.halcyon.game.launch(long.id); await sleep(600);
  const np = (await window.halcyon.system.status()).nowPlaying;
  check('running game is tracked as quittable', np.length === 1 && np[0].quittable === true && np[0].name === 'Long Game');
  const home = async () => { pad.buttons[16] = { pressed: true, value: 1 }; await sleep(80); pad.buttons[16] = mk(); await sleep(700); };
  await home();
  const grow = (k) => document.querySelector(`.layer--left [data-key="row:${k}:${long.id}"]`);
  check('Home shows Resume and Quit for the running game', panel() === 'guide' && !!grow('resume') && !!grow('quit') && grow('resume').textContent.includes('Resume Long Game'));
  focus.focus(grow('quit')); await press(B.A); await sleep(400);
  check('quit asks first', panel() === 'Quit Long Game?');
  await press(B.DOWN); await press(B.A); await sleep(500);
  check('“Keep playing” leaves the game running', (await window.halcyon.system.status()).nowPlaying.length === 1 && panel() === null);
  await home(); focus.focus(grow('quit')); await press(B.A); await sleep(400); await press(B.A);
  const gone = await (async () => { const t = Date.now(); while (Date.now() - t < 6000) { if (!(await window.halcyon.system.status()).nowPlaying.length) return true; await sleep(150); } return false; })();
  check('Quit game closes it', gone);
  await sleep(600); check('menu closes itself when the game ends', panel() === null, String(panel()));
  // the overlay window that opens over a game: driven by its own keystroke script (Down, Enter, Enter)
  await window.halcyon.game.launch(long.id); await sleep(500);
  const opened = await window.halcyon.game.summon(true);
  const sawMenu = await (async () => { const t = Date.now(); while (Date.now() - t < 3000) { if ((await window.halcyon.system.status()).gameMenuOpen) return true; await sleep(100); } return false; })();
  check('Home over a game opens the menu window', opened.opened === true && sawMenu);
  const quitFromOverlay = await (async () => { const t = Date.now(); while (Date.now() - t < 12000) { const st = await window.halcyon.system.status(); if (!st.nowPlaying.length && !st.gameMenuOpen) return true; await sleep(150); } return false; })();
  check('Quit from the menu window closes the game and the menu', quitFromOverlay);
  check('quitting an already closed game explains itself', (await window.halcyon.game.quit(long.id)).ok === false);
  await window.halcyon.custom.remove(long.id); await sleep(300);

  // ---- themes
  await window.halcyon.settings.set({ theme: 'classic' }); await sleep(400);
  document.querySelector('[data-key="tab:home"]').click(); await sleep(400);
  check('Classic theme applies', document.body.dataset.theme === 'classic' && getComputedStyle(document.querySelector('.tile__body')).borderRadius === '0px' && getComputedStyle(document.querySelector('.bg__img')).display === 'none');
  document.querySelector('[data-key="tab:settings"]').click(); await sleep(400);
  focus.focusKey('theme'); await press(B.A); await sleep(400);
  check('Theme row cycles to the next theme', document.body.dataset.theme === 'midnight' && document.querySelector('[data-key="theme"] .row__hint').textContent === 'Midnight');
  await window.halcyon.settings.set({ theme: 'halcyon' }); await sleep(300);
  check('default theme restores', document.body.dataset.theme === 'halcyon' && getComputedStyle(document.querySelector('.bg__img')).display !== 'none');

  // ---- controller filter (mock store: an odd tens digit means no controller support)
  const api = window.halcyon;
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; };
  const steamGames = (await api.library.get()).games.filter((g) => g.source === 'steam');
  const oddCount = steamGames.filter((g) => Math.floor(Number(g.id.slice(6)) / 10) % 2 === 1).length;
  toasts.length = 0;
  await api.settings.set({ controllerOnly: true });
  await waitFor(async () => (await api.library.get()).games.filter((g) => g.source === 'steam').every((g) => g.controller !== 'unknown'));
  const lib2 = await api.library.get();
  check('controller support looked up for every Steam game', lib2.games.filter((g) => g.controller === 'none').length === oddCount && oddCount > 0, `${oddCount} of ${steamGames.length} without`);
  await sleep(500);
  document.querySelector('[data-key="tab:games"]').click(); await sleep(400);
  document.querySelector('[data-key="f:all"]').click(); await sleep(400);
  const shownIds = () => [...document.querySelectorAll('.wall .tile[data-game]')].map((t) => t.dataset.game);
  const noneIds = lib2.games.filter((g) => g.controller === 'none').map((g) => g.id);
  check('games without controller support are hidden', shownIds().length === lib2.games.filter((g) => !g.hidden).length - oddCount && !shownIds().some((id) => noneIds.includes(id)), `${shownIds().length} shown`);
  check('hidden count announced', await waitFor(() => toasts.some((t) => t.includes('without controller support')), 4000), toasts.join(' / '));
  document.querySelector('[data-key="f:nopad"]').click(); await sleep(400);
  check('“No controller” category lists them', shownIds().length === oddCount && shownIds().every((id) => noneIds.includes(id)));
  // manual override through the options blade
  focus.focus(document.querySelector('.wall .tile')); const flipId = focus.current().dataset.game;
  await press(B.Y); await sleep(500);
  focus.focus(document.querySelector('.layer--panel [data-key="row:11"], .layer--panel .row[data-verb="Change"]')); await press(B.A); await sleep(500);
  check('override: “works” brings a game back', (await api.library.get()).games.find((g) => g.id === flipId).controller === 'full');
  await api.game.patch(flipId, { controller: null }); await press(B.B); await sleep(400);
  await api.settings.set({ controllerOnly: false }); await sleep(400);
  document.querySelector('[data-key="f:all"]').click(); await sleep(400);
  check('turning the filter off shows everything', shownIds().length === lib2.games.filter((g) => !g.hidden).length);

  // ---- artwork scraping (mock SteamGridDB)
  const bad = await api.scraper.setKey('wrong-key');
  check('bad API key is rejected and not saved', bad.ok === false && /rejected/.test(bad.error) && !(await api.library.get()).scraper.hasKey, bad.error);
  const noKey = await api.scraper.run([ids.sleeper]);
  check('scraping without a key explains itself', noKey.ok === false && /API key/.test(noKey.error));
  check('good API key is saved, never sent to the page', (await api.scraper.setKey('test-key')).ok && (await api.library.get()).scraper.hasKey && !JSON.stringify(await api.library.get()).includes('test-key'));
  const one = await api.scraper.run([ids.sleeper]); await sleep(300);
  const sl = (await api.library.get()).games.find((g) => g.id === ids.sleeper);
  check('scrape saves cover and background', one.ok && one.found === 1 && sl.hasScrapedArt && sl.art.cover[0].startsWith('media://') && sl.art.hero[0].startsWith('media://'), JSON.stringify(one));
  check('scraped cover loads on its tile', await waitFor(() => { const img = document.createElement('img'); img.src = sl.art.cover[0]; return new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); }); }, 3000));
  const none = await api.custom.save({ name: 'Nothing Here', command: 'true' });
  const miss = await api.scraper.run([none.id]);
  check('no match is reported, not invented', miss.ok && miss.found === 0 && miss.tried === 1);
  await api.custom.remove(none.id);
  const bulk = await api.scraper.run();
  check('bulk run only touches games with no local art', bulk.ok && bulk.tried === (await api.library.get()).games.filter((g) => !g.art.cover.some((u) => u.startsWith('media://'))).length + bulk.found, JSON.stringify(bulk));

  // ---- emulator install (mock GitHub)
  const emuNow = (await api.library.get()).emulators;
  const T = ['mgba', 'flycast', 'ppsspp', 'pcsx2', 'duckstation'].map((id) => emuNow.find((e) => e.id === id)).find((e) => e && !e.found);   // one that is not installed here
  const plan = await api.emulators.plan(T.id);
  check('install plan picks the x86-64 AppImage', plan.ok && plan.github && /x64\.appimage$/.test(plan.github.name) && plan.repo === T.repo, JSON.stringify(plan.github));
  const ra = await api.emulators.plan('retroarch'); const dol = await api.emulators.plan('dolphin');
  check('projects without an AppImage fall back to Flathub', !ra.github && /no Linux AppImage/.test(ra.githubNote) && ra.flatpak.id === 'org.libretro.RetroArch' && !dol.github && !!dol.page, ra.githubNote);
  document.querySelector('[data-key="tab:systems"]').click(); await sleep(500);
  focus.focus(document.querySelector(`[data-key="e:${T.id}"]`)); await press(B.A); await sleep(500);
  check('emulator menu offers install + project page', panel() === T.name && !!document.querySelector('.layer--panel .row .row__label') && [...document.querySelectorAll('.layer--panel .row__label')].some((n) => n.textContent === `Install ${T.name}`) && [...document.querySelectorAll('.layer--panel .row__sub')].some((n) => n.textContent === `github.com/${T.repo}`));
  focus.focus([...document.querySelectorAll('.layer--panel .row')].find((r) => r.textContent.includes(`Install ${T.name}`))); await press(B.A);
  check('install options appear', await waitFor(() => [...document.querySelectorAll('.layer--panel .row__label')].some((n) => n.textContent.startsWith('Download 9.9')), 5000), panel());
  toasts.length = 0;
  await press(B.A); await sleep(350);
  const midway = document.querySelector('.layer--panel [data-key="row:progress"] .row__label')?.textContent || '';
  check('download shows live progress', panel() === `Installing ${T.name}` && /Downloading/.test(midway), midway);
  check('install completes and is announced', await waitFor(() => toasts.some((t) => t.includes(`${T.name} installed`)), 15000), toasts.join(' / '));
  await sleep(800);
  const mg = (await api.library.get()).emulators.find((e) => e.id === T.id);
  check('installed emulator is detected and executable', mg.found && mg.via === 'appimage' && /-9\.9-appimage-x64\.AppImage$/.test(mg.display), mg.display);
  await press(B.B); await sleep(400);
  const gbaGame = (await api.library.get()).games.find((g) => g.system === 'gba');
  if (gbaGame && T.id === 'mgba') { const r = await api.game.launch(gbaGame.id); check('GBA games launch with the new emulator (dry run)', r.ok === true, JSON.stringify(r)); }
  const zipped = await api.emulators.install('melonds', 'github'); await sleep(500);
  const md = (await api.library.get()).emulators.find((e) => e.id === 'melonds');
  check('zipped release is unpacked', zipped.ok && md.found && /melonDS.*\.AppImage$/.test(md.display), JSON.stringify(zipped));
  const racing = api.emulators.install('rpcs3', 'github'); await sleep(150); await api.emulators.cancelInstall('rpcs3'); const cancelled = await racing;
  check('cancelled download leaves nothing behind', cancelled.ok === false && cancelled.cancelled === true && !(await api.library.get()).emulators.find((e) => e.id === 'rpcs3').display.includes('9.9'), JSON.stringify(cancelled));
  document.querySelector('[data-key="tab:home"]').click(); await sleep(400);

  // hot-unplug
  toasts.length = 0; navigator.getGamepads = () => [];
  check('unplug detected + toast', await waitFor(() => !!document.querySelector('#pads .pad--none') && toasts.some((t) => t.includes('Controller disconnected')), 20000), toasts.join(' / '));

  document.querySelector('[data-key="tab:home"]').click(); await sleep(300);
  for (const id of Object.values(ids)) await window.halcyon.custom.remove(id);
  if (col) await window.halcyon.collections.remove(col.id);
  } catch (err) {
    log.push(`ABORTED  ${err.stack || err}`);
  }
  // Whatever happened above, hand the system volume back exactly as it was.
  if (volumeAtStart.ok) await window.halcyon.system.setVolume({ level: volumeAtStart.level, muted: volumeAtStart.muted });
  return log.join('\n');
})()
