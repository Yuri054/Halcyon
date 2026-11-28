// The Jellyfin player: full screen, driven by the controller.
//   A pause / play · left / right skip back 10 s / forward 30 s (hold to keep going)
//   right stick: volume (up / down and every other button bring the bar up) · X subtitles · Y audio track and subtitles
//   LB / RB previous / next · B stop
// Music gets a now-playing screen: the cover, the song, the album and what plays next.
// B on music leaves it playing in the background (a "now playing" note sits by the
// clock); the Guide and the music page bring the screen back. X stops it.
// The bar and the button prompts fade out while the picture plays.
// Jellyfin hears where you are (start, every 10 s, stop), so it remembers the place.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api } from '../core/state.js';
import { app } from '../core/bus.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/dialog.js';
import { artImg } from '../ui/art.js';
import { img, episodeCode } from './tile.js';

const TICKS = 10000000;
let Hls = null;   // loaded the first time something needs HLS

// Music left playing in the background: { title, artist, show(), stop(), toggle(), paused() }.
let background = null;
const listeners = new Set();
const announce = () => { for (const fn of listeners) fn(background); };

/** What plays in the background now, or null. */
export const nowPlaying = () => background;
/** fn(nowPlaying) whenever background music starts, changes or stops. */
export function onNowPlaying(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Stop background music (a game or a video is starting). */
export function stopBackground() { if (background) background.stop(); }

function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const hrs = Math.floor(sec / 3600);
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** queue: item ids to play in order; start: index in it. Resolves when playback ends. */
export function openPlayer({ queue, start = 0, fromStart = false }) {
  stopBackground();
  return new Promise((done) => {
    let index = start;
    let session = null;      // the current playback from Jellyfin
    let hls = null;
    let reportTimer = null;
    let osdTimer = null;
    let closed = false;
    let subIndex = -1;
    let subLabel = null;       // the subtitles chosen, kept when the stream is reloaded
    let audioIndex = null;     // the audio track chosen (Jellyfin's stream index)
    let menuOpen = false;
    let offset = 0;            // seconds before the stream's own start (a transcode that starts mid-film)

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
    // Music: the cover and the song, big, in the middle.
    const cover = h('div', { class: 'player__cover' });
    const songTitle = h('div', { class: 'player__song' });
    const songArtist = h('div', { class: 'player__artist' });
    const songAlbum = h('div', { class: 'player__album' });
    const upNext = h('div', { class: 'player__next' });
    // Lyrics beside the song, when Jellyfin has them: timed ones follow the music.
    const lyricsList = h('div', { class: 'player__lyricslist' });
    const lyricsBox = h('div', { class: 'player__lyrics' }, lyricsList);
    const nowPlaying = h('div', { class: 'player__now' }, cover, h('div', { class: 'player__info' }, h('div', { class: 'player__eyebrow' }, 'now playing'), songTitle, songArtist, songAlbum, upNext), lyricsBox);
    const el = h('div', { class: 'layer layer--player' }, poster, video, nowPlaying, spinner, osd, vol);
    document.getElementById('layers').append(el);

    // The bar and the prompts come up on any press and go away again while it plays.
    const quiet = (on) => document.body.classList.toggle('player-quiet', on);
    const showOsd = (ms = 3200) => {
      el.classList.add('is-osd');
      quiet(false);
      clearTimeout(osdTimer);
      osdTimer = setTimeout(() => { if (!video.paused && !closed && !menuOpen && !inBackground) { el.classList.remove('is-osd'); quiet(true); } }, ms);
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
    // ---- lyrics: [{ at, text, el }]; `picked` is a line chosen with up / down (A jumps there)
    let lyrics = { synced: false, lines: [] };
    let lyricAt = -1;
    let picked = -1;
    let pickTimer = null;
    async function loadLyrics(item) {
      lyrics = { synced: false, lines: [] };
      lyricAt = -1;
      picked = -1;
      lyricsList.replaceChildren();
      el.classList.remove('has-lyrics', 'has-synced-lyrics');
      const r = await api.jellyfin.lyrics(item.id).catch(() => null);
      if (closed || session?.item.id !== item.id || !r?.ok || !r.data?.lines?.length) return;
      lyrics = { synced: r.data.synced, lines: r.data.lines.map((l, n) => {
        const line = h('div', { class: `player__lyric${l.text ? '' : ' is-gap'}` }, l.text || '♪');
        if (r.data.synced && l.at != null) line.addEventListener('click', () => jumpToLyric(n));
        return { at: l.at, text: l.text, el: line };
      }) };
      lyricsList.replaceChildren(...lyrics.lines.map((l) => l.el));
      el.classList.add('has-lyrics');
      el.classList.toggle('has-synced-lyrics', lyrics.synced);
      followLyrics(true);
      app.refreshChrome();
    }
    /** Light the line being sung and keep it in the middle of the box. */
    function followLyrics(instant = false) {
      if (!lyrics.synced || !lyrics.lines.length) return;
      const t = position() + 0.15;
      let n = -1;
      for (let k = 0; k < lyrics.lines.length; k++) if (lyrics.lines[k].at != null && lyrics.lines[k].at <= t) n = k;
      if (n === lyricAt && !instant) return;
      lyricAt = n;
      lyrics.lines.forEach((l, k) => { l.el.classList.toggle('is-now', k === n); l.el.classList.toggle('is-past', k < n); });
      if (picked < 0) centreLyric(Math.max(0, n), instant);
    }
    function centreLyric(n, instant) {
      const line = lyrics.lines[n]?.el;
      if (!line) return;
      lyricsBox.scrollTo({ top: line.offsetTop - lyricsBox.clientHeight / 2 + line.offsetHeight / 2, behavior: instant ? 'instant' : 'smooth' });
    }
    /** Up / down: choose a line (timed lyrics), or just scroll (plain ones). */
    function pickLyric(step) {
      if (!lyrics.lines.length) return false;
      if (!lyrics.synced) { lyricsBox.scrollBy({ top: step * lyricsBox.clientHeight * 0.4, behavior: 'smooth' }); return true; }
      const from = picked >= 0 ? picked : Math.max(0, lyricAt);
      picked = Math.max(0, Math.min(lyrics.lines.length - 1, from + step));
      lyrics.lines.forEach((l, k) => l.el.classList.toggle('is-picked', k === picked));
      centreLyric(picked);
      // Left alone for a few seconds, the lyrics go back to following the song.
      clearTimeout(pickTimer);
      pickTimer = setTimeout(clearPick, 5000);
      app.refreshChrome();
      return true;
    }
    function clearPick() {
      clearTimeout(pickTimer);
      if (picked < 0) return;
      picked = -1;
      lyrics.lines.forEach((l) => l.el.classList.remove('is-picked'));
      followLyrics(true);
      app.refreshChrome();
    }
    /** Go to the moment a line is sung. */
    function jumpToLyric(n) {
      const at = lyrics.lines[n]?.at;
      if (at == null || !Number.isFinite(video.duration)) return;
      video.currentTime = Math.max(0, Math.min(video.duration - 0.5, at - offset));
      if (video.paused) video.play().catch(() => {});
      picked = -1;
      lyrics.lines.forEach((l) => l.el.classList.remove('is-picked'));
      lyricAt = -2;
      followLyrics(false);
      sfx.select();
      app.refreshChrome();
    }

    const paint = () => {
      const d = Number.isFinite(video.duration) ? video.duration + offset : NaN;
      now.textContent = clock(position());
      total.textContent = clock(d);
      fill.style.width = d ? `${(position() / d) * 100}%` : '0%';
      try { const b = video.buffered; buffered.style.width = d && b.length ? `${((b.end(b.length - 1) + offset) / d) * 100}%` : '0%'; } catch { /* nothing yet */ }
      state.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    };
    video.addEventListener('timeupdate', paint);
    video.addEventListener('timeupdate', () => followLyrics());
    video.addEventListener('seeked', () => followLyrics(true));
    video.addEventListener('play', () => { paint(); app.refreshChrome(); showOsd(); report('progress'); });
    video.addEventListener('pause', () => { paint(); app.refreshChrome(); el.classList.add('is-osd'); quiet(false); clearTimeout(osdTimer); report('progress'); });
    video.addEventListener('waiting', () => el.classList.add('is-loading'));
    video.addEventListener('playing', () => el.classList.remove('is-loading'));
    video.addEventListener('ended', () => next(1, true));
    // Keep the screen on while a video plays (music may let it sleep).
    const awake = () => api.system.keepAwake(Boolean(!closed && session && !session.audio && !video.paused && !video.ended)).catch(() => {});
    for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied']) video.addEventListener(ev, awake);
    video.addEventListener('error', () => { if (!closed && session) toast('Jellyfin could not stream this file.', { type: 'error', title: session.item.name }); });

    function position() { return (Number.isFinite(video.currentTime) ? video.currentTime : 0) + offset; }
    function report(event) {
      if (!session) return;
      api.jellyfin.report(event, { itemId: session.item.id, mediaSourceId: session.mediaSourceId, playSessionId: session.playSessionId, method: session.method, position: position(), paused: video.paused });
    }

    async function load(i, opts = {}) {
      if (session) { report('stop'); session = null; }
      if (hls) { hls.destroy(); hls = null; }
      clearInterval(reportTimer);
      el.classList.add('is-loading', 'is-osd');
      const res = await api.jellyfin.playback(queue[i], { fromStart: opts.fromStart, startTicks: opts.startTicks ?? null, audioIndex: opts.audioIndex ?? null });
      if (closed) return;
      if (!res.ok) { toast(res.error, { type: 'error', title: 'Can’t play this' }); close(); return; }
      session = res.data;
      const it = session.item;
      title.textContent = it.type === 'Episode' ? it.series : it.name;
      sub.textContent = it.type === 'Episode' ? [episodeCode(it), it.name].filter(Boolean).join(' · ') : [it.albumArtist, it.year].filter(Boolean).join(' · ');
      audioIndex = session.audioIndex;
      el.classList.toggle('is-audio', Boolean(session.audio));
      if (background) announce();
      if (session.audio) {
        cover.replaceChildren(artImg([img(it.images.primaryOf, 'Primary', 800)], 'player__cover-img', { lazy: false }) || icon('music'));
        songTitle.textContent = it.name;
        songArtist.textContent = it.albumArtist || '';
        songAlbum.textContent = [it.album, it.year].filter(Boolean).join(' · ');
        upNext.textContent = '';
        loadLyrics(it);
        const following = queue[i + 1];
        if (following) api.jellyfin.details(following).then((r) => { if (r.ok && !closed && index === i) upNext.textContent = `Next: ${r.data.name}`; }).catch(() => {});
      }
      poster.style.backgroundImage = `url("${img(session.audio ? it.images.primaryOf : it.images.backdropOf, session.audio ? 'Primary' : 'Backdrop', 1280)}")`;
      [...video.querySelectorAll('track')].forEach((t) => t.remove());
      subIndex = -1;
      for (const s of session.subtitles) video.append(h('track', { kind: 'subtitles', label: s.label, srclang: s.lang || 'und', src: `jf://stream${s.path}` }));
      if (subLabel) showSubtitles([...video.textTracks].findIndex((t) => t.label === subLabel));
      const startAt = session.startTicks / TICKS;
      offset = 0;
      if (session.hls) {
        if (!Hls) Hls = (await import('../../../../node_modules/hls.js/dist/hls.mjs')).default;
        hls = new Hls({ enableWorker: false, startPosition: 0 });
        hls.loadSource(session.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) { toast('The stream stopped.', { type: 'error', title: it.name }); close(); } });
      } else {
        video.src = session.url;
      }
      // A transcode either covers the whole film (seek to the place) or starts at the place
      // already (count from there); the file as it is always needs the seek.
      video.addEventListener('loadedmetadata', () => {
        const whole = it.runtimeMin && Number.isFinite(video.duration) && Math.abs(video.duration - it.runtimeMin * 60) < 90;
        if (session.method === 'Transcode' && !whole) offset = startAt;
        else if (startAt > 0) video.currentTime = startAt;
        paint();
      }, { once: true });
      video.play().catch(() => {});
      report('start');
      reportTimer = setInterval(() => report('progress'), 10000);
      showOsd(5000);
      app.refreshChrome();
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

    function showSubtitles(i) {
      const tracks = [...video.textTracks];
      subIndex = i >= 0 && i < tracks.length ? i : -1;
      subLabel = subIndex < 0 ? null : tracks[subIndex].label;
      tracks.forEach((t, n) => { t.mode = n === subIndex ? 'showing' : 'disabled'; });
    }

    function cycleSubtitles() {
      const tracks = [...video.textTracks];
      if (!tracks.length) { toast('No subtitles for this.', { title: 'Subtitles' }); return; }
      showSubtitles(subIndex + 1 >= tracks.length ? -1 : subIndex + 1);
      toast(subIndex < 0 ? 'Off' : tracks[subIndex].label, { title: 'Subtitles' });
    }

    /** Y: pick the audio track (a film's languages, commentary) and the subtitles. */
    async function chooseTracks() {
      if (!session) return;
      const audios = session.audioTracks || [];
      const subs = [...video.textTracks];
      if (audios.length < 2 && !subs.length) { toast(session.audio ? 'Nothing to choose for this song.' : 'This has one audio track and no subtitles.', { title: 'Audio and subtitles' }); return; }
      menuOpen = true;
      clearTimeout(osdTimer);
      quiet(false);
      el.classList.add('is-osd');
      const pick = await menu({
        title: 'Audio and subtitles',
        subtitle: session.item.type === 'Episode' ? `${session.item.series} · ${session.item.name}` : session.item.name,
        selected: `a:${audioIndex}`,
        items: [
          { heading: 'Audio' },
          ...audios.map((a) => ({ label: a.label, value: `a:${a.index}`, iconName: 'sound', checked: a.index === audioIndex, sub: a.isDefault ? 'Default' : null })),
          { heading: 'Subtitles' },
          { label: 'Off', value: 's:-1', iconName: 'eyeOff', checked: subIndex < 0 },
          ...subs.map((t, n) => ({ label: t.label || `Subtitles ${n + 1}`, value: `s:${n}`, iconName: 'captions', checked: n === subIndex })),
        ],
      });
      menuOpen = false;
      if (closed) return;
      if (pick?.startsWith('s:')) showSubtitles(Number(pick.slice(2)));
      if (pick?.startsWith('a:')) {
        const want = Number(pick.slice(2));
        if (want !== audioIndex) {
          const a = audios.find((x) => x.index === want);
          const at = position();
          await load(index, { startTicks: Math.round(at * TICKS), audioIndex: want });
          return;
        }
      }
      showOsd();
    }

    // Music: B keeps it playing and hands the screen back.
    let inBackground = false;
    function toBackground() {
      inBackground = true;
      focus.popLayer(layer);
      el.classList.add('is-background');
      clearTimeout(osdTimer);
      quiet(false);
      background = {
        get title() { return session?.item.name || ''; },
        get artist() { return session?.item.albumArtist || ''; },
        get item() { return session?.item || null; },
        paused: () => video.paused,
        toggle: () => { if (video.paused) video.play().catch(() => {}); else video.pause(); announce(); },
        stop: () => close(),
        show: () => {
          if (closed || !inBackground) return;
          inBackground = false;
          background = null;
          announce();
          el.classList.remove('is-background');
          layer = focus.pushLayer(layerSpec);
          showOsd();
          app.refreshChrome();
        },
      };
      announce();
      app.refreshChrome();
      done();
    }

    function close() {
      if (closed) return;
      closed = true;
      if (inBackground) { inBackground = false; background = null; announce(); }
      report('stop');
      clearInterval(reportTimer);
      clearTimeout(osdTimer);
      quiet(false);
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      api.system.keepAwake(false).catch(() => {});
      focus.popLayer(layer);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 350);
      app.refreshChrome();
      done();
    }

    const layerSpec = {
      root: el,
      current: null,
      onAction(action, _t, repeat) {
        if (action !== 'rup' && action !== 'rdown') showOsd();
        if (action === 'accept' && !repeat && picked >= 0) jumpToLyric(picked);
        else if (action === 'accept' && !repeat) { if (video.paused) video.play().catch(() => {}); else video.pause(); sfx.select(); }
        else if ((action === 'up' || action === 'down') && session?.audio && lyrics.lines.length) { if (pickLyric(action === 'up' ? -1 : 1)) sfx.move(); }
        else if (action === 'left') seek(repeat ? -30 : -10);
        else if (action === 'right') seek(repeat ? 60 : 30);
        else if (action === 'rup') changeVolume(5);
        else if (action === 'rdown') changeVolume(-5);
        else if (action === 'x' && !repeat && session?.audio) { sfx.back(); close(); }
        else if (action === 'x' && !repeat) cycleSubtitles();
        else if (action === 'y' && !repeat) chooseTracks();
        else if (action === 'lb' && !repeat) next(-1);
        else if (action === 'rb' && !repeat) next(1);
        else if (action === 'back' && !repeat && picked >= 0) { sfx.back(); clearPick(); }
        else if (action === 'back' && !repeat) { sfx.back(); if (session?.audio && !video.paused) toBackground(); else close(); }
        return true;
      },
      hints: () => [
        picked >= 0 ? { a: 'accept', label: 'Jump to this line' } : { a: 'accept', label: video.paused ? 'Play' : 'Pause' },
        session?.audio && lyrics.lines.length > 0 && { a: 'up', b: 'down', label: lyrics.synced ? 'Lyrics' : 'Scroll lyrics' }, { a: 'left', label: '−10 s' }, { a: 'right', label: '+30 s' }, { a: 'rup', b: 'rdown', label: 'Volume' },
        session?.audio ? { a: 'x', label: 'Stop' } : { a: 'x', label: 'Subtitles' }, !session?.audio && { a: 'y', label: 'Audio & subtitles' }, queue.length > 1 && { a: 'lb', b: 'rb', label: 'Previous / next' },
        { a: 'back', label: picked >= 0 ? 'Back to the song' : session?.audio && !video.paused ? 'Keep playing' : 'Stop' },
      ].filter(Boolean),
    };
    let layer = focus.pushLayer(layerSpec);
    app.refreshChrome();
    load(index, { fromStart });
  });
}
