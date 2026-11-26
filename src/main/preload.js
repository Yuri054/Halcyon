'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('halcyon', {
  library: {
    get: call('library:get'),
    rescan: call('library:rescan'),
  },
  game: {
    launch: call('game:launch'),
    patch: call('game:patch'),
    summon: call('game:summon'),
    quit: call('game:quit'),
    resume: call('game:resume'),
  },
  custom: {
    save: call('custom:save'),
    remove: call('custom:remove'),
  },
  collections: {
    create: call('collections:create'),
    rename: call('collections:rename'),
    remove: call('collections:remove'),
  },
  emulators: {
    configure: call('emulators:configure'),
    configureSystem: call('systems:configure'),
    open: call('emulators:open'),
    plan: call('emulators:plan'),
    install: call('emulators:install'),
    cancelInstall: call('emulators:cancelInstall'),
    openPage: call('emulators:openPage'),
    addRoot: call('roms:addRoot'),
    removeRoot: call('roms:removeRoot'),
  },
  steam: {
    open: call('steam:open'),
    action: call('steam:action'),
    leaveBigPicture: call('steam:leaveBigPicture'),
    skipShaders: call('steam:skipShaders'),
    hookStatus: call('steam:hookStatus'),
    setKey: call('steam:setKey'),
    addRoot: call('steam:addRoot'),
    removeRoot: call('steam:removeRoot'),
  },
  settings: { set: call('settings:set') },
  ui: { set: call('ui:set') },
  files: { list: call('files:list') },
  sounds: {
    list: call('sounds:list'),
    load: call('sounds:load'),
    import: call('sounds:import'),
  },
  app: {
    quit: call('app:quit'),
    setFullscreen: call('app:setFullscreen'),
    info: call('app:info'),
    pendingNav: call('app:pendingNav'),
  },
  store: {
    featured: call('store:featured'),
    search: call('store:search'),
    details: call('store:details'),
  },
  dashboard: { show: call('dashboard:show') },
  home: { status: call('home:status') },
  downloads: {
    status: call('downloads:status'),
    enable: call('downloads:enable'),
    control: call('downloads:control'),
  },
  scraper: {
    setKey: call('scraper:setKey'),
    run: call('scraper:run'),
  },
  system: {
    status: call('system:status'),
    setVolume: call('system:setVolume'),
    power: call('system:power'),
    setAutostart: call('system:setAutostart'),
  },
  on(channel, handler) {
    const allowed = ['library:changed', 'launch:event', 'window:focus', 'system:batteries', 'app:notice', 'install:progress', 'scrape:progress', 'steam:downloads', 'dashboard:navigate'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => handler(payload));
  },
});
