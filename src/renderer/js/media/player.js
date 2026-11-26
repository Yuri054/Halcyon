// The Jellyfin player: full screen, driven by the controller.
//   A pause / play · left / right skip back 10 s / forward 30 s (hold to keep going)
//   up / down or the right stick: volume · X subtitles · LB / RB previous / next · B stop
// The bar and the button prompts fade out while the picture plays.
// Jellyfin hears where you are (start, every 10 s, stop), so it remembers the place.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api } from '../core/state.js';
import { app } from '../core/bus.js';
import { toast } from '../ui/toast.js';
import { img, episodeCode } from './tile.js';

const TICKS = 10000000;
let Hls = null;   // loaded the first time something needs HLS

function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const hrs = Math.floor(sec / 3600);
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** queue: item ids to play in order; start: index in it. Resolves when playback ends. */
export function openPlayer({ queue, start = 0, fromStart = false }) {
  return new Promise((done) => {
    let index = start;
    let session = null;      // the current playback from Jellyfin
    let hls = null;
    let reportTimer = null;
    let osdTimer = null;
    let closed = false;
    let subIndex = -1;

    const video = h('video', { class: 'player__video', playsinline: true, preload: 'auto' });
    const poster = h('div', { class: 'player__poster' });
    const title = h('div', { class: 'player__title' });
    const sub = h('div', { class: 'player__sub' });
    const fill = h('i');
    const buffered = h('b');
    const bar = h('div', { class: 'player__bar' }, buffered, fill);
    const now = h('span', { class: 'player__time' }, '0:00');
    const total = h('span', { class: 'player__time' }, '0:00');
    const state = h('div', { class: 'player__state' }, icon('play'));
    const osd = h('div', { class: 'player__osd' },
      h('div', { class: 'player__titles' }, title, sub),
      h('div', { class: 'player__row' }, state, now, bar, total));
    const spinner = h('div', { class: 'player__spinner' });
    const volFill = h('i');
    const volText = h('span', null, '');
    const vol = h('div', { class: 'player__volume' }, icon('sound'), h('div', { class: 'player__volbar' }, volFill), volText);
    const el = h('div', { class: 'layer layer--player' }, poster, video, spinner, osd, vol);
    document.getElementById('layers').append(el);

    // The bar and the prompts come up on any press and go away again while it plays.
    const quiet = (on) => document.body.classList.toggle('player-quiet', on);
    const showOsd = (ms = 3200) => {
      el.classList.add('is-osd');
      quiet(false);
      clearTimeout(osdTimer);
      osdTimer = setTimeout(() => { if (!video.paused && !closed) { el.classList.remove('is-osd'); quiet(true); } }, ms);
    };

    // ---- volume (the system's, as the Guide sets it)
    let volume = null;
    let volTimer = null;
    api.system.status().then((st) => { if (st?.volume?.ok) volume = { level: st.volume.level, muted: st.volume.muted }; }).catch(() => {});
    function changeVolume(step) {
      if (!volume) return;
      volume.level = Math.max(0, Math.min(100, Math.round(volume.level / 5) * 5 + step));
      volume.muted = false;
      volFill.style.width = `${volume.level}%`;
      volText.textContent = `${volume.level}`;
      vol.classList.add('is-on');
      clearTimeout(volTimer);
      volTimer = setTimeout(() => vol.classList.remove('is-on'), 1400);
      api.system.setVolume({ level: volume.level, muted: false });
    }
    const paint = () => {
      const d = video.duration;
      now.textContent = clock(video.currentTime);
      total.textContent = clock(d);
      fill.style.width = d ? `${(video.currentTime / d) * 100}%` : '0%';
      try { const b = video.buffered; buffered.style.width = d && b.length ? `${(b.end(b.length - 1) / d) * 100}%` : '0%'; } catch { /* nothing yet */ }
      state.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    };
    video.addEventListener('timeupdate', paint);
    video.addEventListener('play', () => { paint(); showOsd(); report('progress'); });
    video.addEventListener('pause', () => { paint(); el.classList.add('is-osd'); quiet(false); clearTimeout(osdTimer); report('progress'); });
    video.addEventListener('waiting', () => el.classList.add('is-loading'));
    video.addEventListener('playing', () => el.classList.remove('is-loading'));
    video.addEventListener('ended', () => next(1, true));
    video.addEventListener('error', () => { if (!closed && session) toast('Jellyfin could not stream this file.', { type: 'error', title: session.item.name }); });

    const position = () => (Number.isFinite(video.currentTime) ? video.currentTime : 0);
    function report(event) {
      if (!session) return;
      api.jellyfin.report(event, { itemId: session.item.id, mediaSourceId: session.mediaSourceId, playSessionId: session.playSessionId, method: session.method, position: position(), paused: video.paused });
    }

    async function load(i, opts = {}) {
      if (session) { report('stop'); session = null; }
      if (hls) { hls.destroy(); hls = null; }
      clearInterval(reportTimer);
      el.classList.add('is-loading', 'is-osd');
      const res = await api.jellyfin.playback(queue[i], { fromStart: opts.fromStart });
      if (closed) return;
      if (!res.ok) { toast(res.error, { type: 'error', title: 'Can’t play this' }); close(); return; }
      session = res.data;
      const it = session.item;
      title.textContent = it.type === 'Episode' ? it.series : it.name;
      sub.textContent = it.type === 'Episode' ? [episodeCode(it), it.name].filter(Boolean).join(' · ') : [it.albumArtist, it.year].filter(Boolean).join(' · ');
      el.classList.toggle('is-audio', Boolean(session.audio));
      poster.style.backgroundImage = `url("${img(session.audio ? it.images.primaryOf : it.images.backdropOf, session.audio ? 'Primary' : 'Backdrop', 1280)}")`;
      [...video.querySelectorAll('track')].forEach((t) => t.remove());
      subIndex = -1;
      for (const s of session.subtitles) video.append(h('track', { kind: 'subtitles', label: s.label, srclang: s.lang || 'und', src: `jf://stream${s.path}` }));
      const startAt = session.method === 'Transcode' ? 0 : session.startTicks / TICKS;   // transcodes already start there
      if (session.hls) {
        if (!Hls) Hls = (await import('../../../../node_modules/hls.js/dist/hls.mjs')).default;
        hls = new Hls({ enableWorker: false, startPosition: 0 });
        hls.loadSource(session.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) { toast('The stream stopped.', { type: 'error', title: it.name }); close(); } });
      } else {
        video.src = session.url;
      }
      video.addEventListener('loadedmetadata', () => { if (startAt > 0) video.currentTime = startAt; }, { once: true });
      video.play().catch(() => {});
      report('start');
      reportTimer = setInterval(() => report('progress'), 10000);
      showOsd(5000);
    }

    function next(step, auto = false) {
      const i = index + step;
      if (i < 0 || i >= queue.length) { if (auto) close(); else sfx.edge(); return; }
      index = i;
      load(index, { fromStart: true });
    }

    function seek(sec) {
      if (!Number.isFinite(video.duration)) return;
      video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + sec));
      paint();
      showOsd();
    }

    function cycleSubtitles() {
      const tracks = [...video.textTracks];
      if (!tracks.length) { toast('No subtitles for this.', { title: 'Subtitles' }); return; }
      subIndex = subIndex + 1 >= tracks.length ? -1 : subIndex + 1;
      tracks.forEach((t, i) => { t.mode = i === subIndex ? 'showing' : 'disabled'; });
      toast(subIndex < 0 ? 'Off' : tracks[subIndex].label, { title: 'Subtitles' });
    }

    function close() {
      if (closed) return;
      closed = true;
      report('stop');
      clearInterval(reportTimer);
      clearTimeout(osdTimer);
      quiet(false);
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      focus.popLayer(layer);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 350);
      app.refreshChrome();
      done();
    }

    const layer = focus.pushLayer({
      root: el,
      current: null,
      onAction(action, _t, repeat) {
        if (action !== 'up' && action !== 'down' && action !== 'rup' && action !== 'rdown') showOsd();
        if (action === 'accept' && !repeat) { if (video.paused) video.play().catch(() => {}); else video.pause(); sfx.select(); }
        else if (action === 'left') seek(repeat ? -30 : -10);
        else if (action === 'right') seek(repeat ? 60 : 30);
        else if (action === 'up' || action === 'rup') changeVolume(5);
        else if (action === 'down' || action === 'rdown') changeVolume(-5);
        else if (action === 'x' && !repeat) cycleSubtitles();
        else if (action === 'lb' && !repeat) next(-1);
        else if (action === 'rb' && !repeat) next(1);
        else if (action === 'back' && !repeat) { sfx.back(); close(); }
        return true;
      },
      hints: () => [
        { a: 'accept', label: video.paused ? 'Play' : 'Pause' }, { a: 'left', label: '−10 s' }, { a: 'right', label: '+30 s' }, { a: 'up', b: 'down', label: 'Volume' },
        { a: 'x', label: 'Subtitles' }, queue.length > 1 && { a: 'lb', b: 'rb', label: 'Previous / next' }, { a: 'back', label: 'Stop' },
      ].filter(Boolean),
    });
    app.refreshChrome();
    load(index, { fromStart });
  });
}
