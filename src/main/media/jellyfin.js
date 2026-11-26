'use strict';
// Jellyfin: sign in, browse libraries, and get something playable for an item.
// All requests go from here (the main process) with the session token, so the token
// never reaches the page; images and streams reach the page through the jf:// protocol.
const crypto = require('crypto');

const CLIENT = 'Halcyon';
const VERSION = '1.0.0';
const TICKS = 10000000;   // Jellyfin counts time in 100 ns ticks

class Jellyfin {
  /** store: the JSON store; settings live in data.jellyfin, the token in data.secrets. */
  constructor(store) {
    this.store = store;
    const j = this.cfg;
    if (!j.deviceId) { j.deviceId = crypto.randomUUID(); store.save(); }
  }

  get cfg() {
    const d = this.store.data;
    d.jellyfin = d.jellyfin || { server: '', userId: '', userName: '', serverName: '', deviceId: '' };
    return d.jellyfin;
  }

  get token() { return this.store.data.secrets.jellyfinToken || ''; }
  get connected() { return Boolean(this.cfg.server && this.cfg.userId && this.token); }

  authHeader(token = this.token) {
    const parts = [`Client="${CLIENT}"`, `Device="Halcyon"`, `DeviceId="${this.cfg.deviceId}"`, `Version="${VERSION}"`];
    if (token) parts.push(`Token="${token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  async request(path, { method = 'GET', body, server = this.cfg.server, token = this.token, timeout = 15000 } = {}) {
    let res;
    try {
      res = await fetch(`${server}${path}`, {
        method,
        headers: { Authorization: this.authHeader(token), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new Error(`Could not reach the Jellyfin server (${err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message}).`);
    }
    if (res.status === 401) throw Object.assign(new Error('Jellyfin did not accept the sign-in. Sign in again under Media.'), { auth: true });
    if (!res.ok) throw Object.assign(new Error(`Jellyfin answered with an error (HTTP ${res.status}).`), { status: res.status });
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  static normalise(server) {
    let s = String(server || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
    return s;
  }

  /** Check the server and sign in. The password is used once and never stored. */
  async connect(server, username, password) {
    const base = Jellyfin.normalise(server);
    if (!base) return { ok: false, error: 'Enter the server address, such as 192.168.1.20:8096.' };
    try {
      const info = await this.request('/System/Info/Public', { server: base, token: '' });
      const auth = await this.request('/Users/AuthenticateByName', { method: 'POST', server: base, token: '', body: { Username: String(username || ''), Pw: String(password || '') } });
      if (!auth || !auth.AccessToken) return { ok: false, error: 'Jellyfin did not return a session.' };
      Object.assign(this.cfg, { server: base, userId: auth.User.Id, userName: auth.User.Name, serverName: info?.ServerName || '' });
      this.store.data.secrets.jellyfinToken = auth.AccessToken;
      this.store.save();
      return { ok: true, userName: auth.User.Name, serverName: info?.ServerName || base };
    } catch (err) {
      return { ok: false, error: err.auth ? 'Wrong user name or password.' : err.message };
    }
  }

  async disconnect() {
    if (this.connected) await this.request('/Sessions/Logout', { method: 'POST' }).catch(() => {});
    Object.assign(this.cfg, { userId: '', userName: '' });
    this.store.data.secrets.jellyfinToken = '';
    this.store.save();
    return { ok: true };
  }

  status() {
    return { connected: this.connected, server: this.cfg.server, serverName: this.cfg.serverName, userName: this.cfg.userName };
  }

  // ------------------------------------------------------------- browsing

  /**
   * Episodes Jellyfin could not identify keep their file name ("ulysses.31.05.the.eternal.punishment").
   * Turn that into a title: drop the series' words and the numbers in front, and space it out.
   */
  static tidyName(name, series) {
    if (!name || /\s/.test(name) || (name.match(/[._]/g) || []).length < 2) return name;
    const words = name.replace(/\.(mkv|mp4|avi|m4v|webm)$/i, '').split(/[._]+/).filter(Boolean);
    const seriesWords = new Set(String(series || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    let i = 0;
    while (i < words.length - 1 && (seriesWords.has(words[i].toLowerCase()) || /^(s\d+e\d+|\d+|e\d+|s\d+|\d+x\d+)$/i.test(words[i]))) i++;
    const rest = words.slice(i).filter((w) => !/^(\d{3,4}p|x26[45]|h26[45]|hevc|web|webrip|bluray|dvdrip|aac|ac3)$/i.test(w));
    if (!rest.length) return name;
    return rest.map((w, n) => (n > 0 && /^(of|the|a|an|and|in|on|to|at|for)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
  }

  /** A compact item the page can show. */
  static item(i) {
    const ud = i.UserData || {};
    const progress = ud.PlayedPercentage != null ? Math.round(ud.PlayedPercentage) : 0;
    return {
      id: i.Id,
      type: i.Type,                                 // Movie, Series, Season, Episode, MusicAlbum, Audio, CollectionFolder...
      name: i.Type === 'Episode' ? Jellyfin.tidyName(i.Name, i.SeriesName) : i.Name,
      series: i.SeriesName || '',
      seriesId: i.SeriesId || '',
      seasonId: i.SeasonId || '',
      index: i.IndexNumber ?? null,
      season: i.ParentIndexNumber ?? null,
      year: i.ProductionYear || null,
      overview: i.Overview || '',
      runtimeMin: i.RunTimeTicks ? Math.round(i.RunTimeTicks / TICKS / 60) : null,
      runtimeSec: i.RunTimeTicks ? Math.round(i.RunTimeTicks / TICKS) : null,
      rating: i.OfficialRating || '',
      community: i.CommunityRating || null,
      genres: (i.Genres || []).slice(0, 3),
      tagline: (i.Taglines || [])[0] || '',
      studio: (i.Studios || [])[0]?.Name || '',
      cast: (i.People || []).filter((p) => p.Type === 'Actor').slice(0, 5).map((p) => p.Name),
      director: (i.People || []).find((p) => p.Type === 'Director')?.Name || '',
      ends: i.EndDate ? new Date(i.EndDate).getFullYear() : null,
      status: i.Status || '',
      collection: i.CollectionType || '',
      albumArtist: i.AlbumArtist || (i.Artists || [])[0] || '',
      played: Boolean(ud.Played),
      progress,
      resumeTicks: ud.PlaybackPositionTicks || 0,
      unplayed: ud.UnplayedItemCount || 0,
      childCount: i.ChildCount ?? null,
      album: i.Album || '',
      albumId: i.AlbumId || '',
      images: {
        primary: Boolean(i.ImageTags && i.ImageTags.Primary),
        backdrop: Boolean(i.BackdropImageTags && i.BackdropImageTags.length) || Boolean(i.ParentBackdropItemId),
        thumb: Boolean(i.ImageTags && i.ImageTags.Thumb) || Boolean(i.ParentThumbItemId),
        // Episodes borrow their series' art for posters and backdrops.
        primaryOf: i.ImageTags && i.ImageTags.Primary ? i.Id : (i.SeriesId || i.AlbumId || i.Id),
        backdropOf: i.BackdropImageTags && i.BackdropImageTags.length ? i.Id : (i.ParentBackdropItemId || i.SeriesId || i.Id),
        thumbOf: i.ImageTags && i.ImageTags.Thumb ? i.Id : (i.ParentThumbItemId || i.SeriesId || i.Id),
        logo: Boolean(i.ImageTags && i.ImageTags.Logo) || Boolean(i.ParentLogoItemId),
        logoOf: i.ImageTags && i.ImageTags.Logo ? i.Id : (i.ParentLogoItemId || i.SeriesId || i.Id),
        seriesPrimary: i.SeriesId || null,
      },
    };
  }

  get uid() { return this.cfg.userId; }
  static fields = 'Fields=Overview,Genres,ProductionYear,PrimaryImageAspectRatio,CommunityRating,OfficialRating&EnableImageTypes=Primary,Backdrop,Thumb&ImageTypeLimit=1';

  /** The front page of one side of the server: kind 'video' (tv & movies) or 'music'. */
  async home(kind = 'video') {
    const views = await this.request(`/Users/${this.uid}/Views`);
    const libraries = (views?.Items || []).filter((v) => ['movies', 'tvshows', 'music', 'homevideos', 'musicvideos', 'mixed', ''].includes(v.CollectionType || ''))
      .filter((v) => (kind === 'music') === (v.CollectionType === 'music'))
      .map(Jellyfin.item);
    if (kind === 'music') {
      const [recent, lists, latest] = await Promise.all([
        this.request(`/Users/${this.uid}/Items?IncludeItemTypes=Audio&Recursive=true&SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&Limit=16&${Jellyfin.fields}`).catch(() => ({ Items: [] })),
        this.playlists('Audio').catch(() => ({ items: [] })),
        Promise.all(libraries.slice(0, 3).map(async (lib) => {
          const items = await this.request(`/Users/${this.uid}/Items/Latest?ParentId=${lib.id}&IncludeItemTypes=MusicAlbum&Limit=20&${Jellyfin.fields}`).catch(() => []);
          return { library: lib, items: (items || []).map(Jellyfin.item).filter((x) => x.type === 'MusicAlbum') };
        })),
      ]);
      return { libraries, resume: [], nextUp: [], recent: (recent?.Items || []).map(Jellyfin.item).filter((x) => x.type === 'Audio'), playlists: lists.items, latest: latest.filter((l) => l.items.length) };
    }
    const [resume, nextUp] = await Promise.all([
      this.request(`/Users/${this.uid}/Items/Resume?Limit=12&MediaTypes=Video&${Jellyfin.fields}`),
      this.request(`/Shows/NextUp?UserId=${this.uid}&Limit=12&${Jellyfin.fields}`).catch(() => ({ Items: [] })),
    ]);
    const latest = await Promise.all(libraries.slice(0, 4).map(async (lib) => {
      const items = await this.request(`/Users/${this.uid}/Items/Latest?ParentId=${lib.id}&Limit=16&${Jellyfin.fields}`).catch(() => []);
      return { library: lib, items: (items || []).map(Jellyfin.item) };
    }));
    return {
      libraries,
      resume: (resume?.Items || []).map(Jellyfin.item),
      nextUp: (nextUp?.Items || []).map(Jellyfin.item),
      latest: latest.filter((l) => l.items.length),
    };
  }

  /** Everything in a library: movies, shows or albums, A to Z. */
  async library(id, start = 0, genreId = '') {
    const genre = genreId ? `&GenreIds=${encodeURIComponent(genreId)}` : '';
    const r = await this.request(`/Users/${this.uid}/Items?ParentId=${encodeURIComponent(id)}&Recursive=true&IncludeItemTypes=Movie,Series,MusicAlbum,Video&SortBy=SortName&SortOrder=Ascending&StartIndex=${start}&Limit=300${genre}&${Jellyfin.fields}`);
    return { items: (r?.Items || []).map(Jellyfin.item), total: r?.TotalRecordCount || 0 };
  }

  async details(id) {
    return Jellyfin.item(await this.request(`/Users/${this.uid}/Items/${encodeURIComponent(id)}?${Jellyfin.fields},Taglines,Studios,People`));
  }

  /** The genres in a library, for filtering it. */
  async genres(parentId) {
    const r = await this.request(`/Genres?ParentId=${encodeURIComponent(parentId)}&UserId=${this.uid}&SortBy=SortName&SortOrder=Ascending`);
    return (r?.Items || []).map((g) => ({ id: g.Id, name: g.Name }));
  }

  /** Try each request in turn until one exists on this server (endpoints moved between versions). */
  async attempt(list) {
    let last = null;
    for (const [path, opts] of list) {
      try { return await this.request(path, opts); } catch (err) { last = err; if (err.status !== 404 && err.status !== 405) throw err; }
    }
    throw last || new Error('Jellyfin does not support that.');
  }

  /** Mark an item (or a whole series or season) watched or unwatched. */
  async markPlayed(id, played) {
    const method = played ? 'POST' : 'DELETE';
    const e = encodeURIComponent(id);
    await this.attempt([[`/UserPlayedItems/${e}?userId=${this.uid}`, { method }], [`/Users/${this.uid}/PlayedItems/${e}`, { method }]]);
    return { ok: true };
  }

  /** Take something off "continue watching" (as Jellyfin's own apps do), keeping it unwatched. */
  async hideFromResume(id) {
    const e = encodeURIComponent(id);
    await this.attempt([
      [`/Users/${this.uid}/Items/${e}/HideFromResume?hide=true`, { method: 'POST' }],
      [`/UserItems/${e}/UserData?userId=${this.uid}`, { method: 'POST', body: { PlaybackPositionTicks: 0 } }],
      [`/Users/${this.uid}/Items/${e}/UserData`, { method: 'POST', body: { PlaybackPositionTicks: 0 } }],
    ]);
    return { ok: true };
  }

  async seasons(seriesId) {
    const r = await this.request(`/Shows/${encodeURIComponent(seriesId)}/Seasons?UserId=${this.uid}&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  async episodes(seriesId, seasonId) {
    const r = await this.request(`/Shows/${encodeURIComponent(seriesId)}/Episodes?UserId=${this.uid}&SeasonId=${encodeURIComponent(seasonId)}&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  async tracks(albumId) {
    const r = await this.request(`/Users/${this.uid}/Items?ParentId=${encodeURIComponent(albumId)}&SortBy=ParentIndexNumber,IndexNumber,SortName&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  /** The artists in a music library (album artists, as Jellyfin's own apps list them). */
  async artists(parentId) {
    const r = await this.request(`/Artists/AlbumArtists?ParentId=${encodeURIComponent(parentId)}&UserId=${this.uid}&SortBy=SortName&SortOrder=Ascending&Limit=1000&${Jellyfin.fields}`);
    return { items: (r?.Items || []).map(Jellyfin.item), total: r?.TotalRecordCount || (r?.Items || []).length };
  }

  /** Every playlist the user can see (Jellyfin keeps them outside the libraries). */
  async playlists(kind = 'Audio') {
    const r = await this.request(`/Users/${this.uid}/Items?IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&SortOrder=Ascending&Fields=ChildCount,Overview&EnableImageTypes=Primary&ImageTypeLimit=1${kind ? `&MediaTypes=${kind}` : ''}`);
    const items = (r?.Items || []).map(Jellyfin.item);
    return { items, total: items.length };
  }

  /** An artist's albums, newest first. */
  async artistAlbums(artistId) {
    const r = await this.request(`/Users/${this.uid}/Items?AlbumArtistIds=${encodeURIComponent(artistId)}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=ProductionYear,SortName&SortOrder=Descending&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  /** An artist's songs, shuffled by the server (for "shuffle artist"). */
  async artistTracks(artistId) {
    const r = await this.request(`/Users/${this.uid}/Items?ArtistIds=${encodeURIComponent(artistId)}&IncludeItemTypes=Audio&Recursive=true&SortBy=Random&Limit=300&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  async playlistTracks(playlistId) {
    const r = await this.request(`/Playlists/${encodeURIComponent(playlistId)}/Items?UserId=${this.uid}&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  async search(term) {
    const r = await this.request(`/Users/${this.uid}/Items?SearchTerm=${encodeURIComponent(term)}&Recursive=true&IncludeItemTypes=Movie,Series,Episode,MusicAlbum,MusicArtist,Playlist,Audio&Limit=60&${Jellyfin.fields}`);
    return (r?.Items || []).map(Jellyfin.item);
  }

  // -------------------------------------------------------------- playback

  /** What this player can play as it is (Chromium); anything else Jellyfin transcodes to HLS. */
  static profile() {
    return {
      MaxStreamingBitrate: 120000000,
      MaxStaticBitrate: 120000000,
      DirectPlayProfiles: [
        { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264,vp9,av1', AudioCodec: 'aac,mp3,opus,flac' },
        { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
        { Container: 'mp3', Type: 'Audio' }, { Container: 'flac', Type: 'Audio' }, { Container: 'ogg,oga,opus', Type: 'Audio', AudioCodec: 'opus,vorbis' },
        { Container: 'm4a,aac,mp4', Type: 'Audio', AudioCodec: 'aac' }, { Container: 'webm', Type: 'Audio', AudioCodec: 'opus,vorbis' },
      ],
      TranscodingProfiles: [
        { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Context: 'Streaming', Protocol: 'hls', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true },
        { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '2' },
      ],
      ContainerProfiles: [],
      CodecProfiles: [],
      SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }, { Format: 'srt', Method: 'External' }, { Format: 'ass', Method: 'External' }],
    };
  }

  /**
   * How to play an item: { url (jf:// path), hls, playSessionId, mediaSourceId, method, startTicks,
   * subtitles, audioTracks, audioIndex }.
   * fromStart ignores the saved position; startTicks starts somewhere else (switching tracks);
   * audioIndex picks an audio track. A track other than the file's default is played through
   * Jellyfin (a remux or transcode with that track), as the browser can't switch tracks itself.
   */
  async playback(id, { fromStart = false, startTicks: at = null, audioIndex = null } = {}) {
    const item = await this.details(id);
    const startTicks = at != null ? Math.max(0, Math.round(at)) : fromStart ? 0 : item.resumeTicks || 0;
    const ask = async (extra) => this.request(`/Items/${encodeURIComponent(id)}/PlaybackInfo?UserId=${this.uid}&StartTimeTicks=${startTicks}&IsPlayback=true&AutoOpenLiveStream=true&MaxStreamingBitrate=120000000${audioIndex != null ? `&AudioStreamIndex=${audioIndex}` : ''}`, {
      method: 'POST', body: { DeviceProfile: Jellyfin.profile(), ...(audioIndex != null ? { AudioStreamIndex: audioIndex } : {}), ...extra },
    });
    let info = await ask({});
    let src = info?.MediaSources?.[0];
    if (!src) throw new Error(info?.ErrorCode ? `Jellyfin cannot play this (${info.ErrorCode}).` : 'Jellyfin has nothing playable for this.');
    const streams = src.MediaStreams || [];
    const audioStreams = streams.filter((s) => s.Type === 'Audio');
    const defaultAudio = src.DefaultAudioStreamIndex ?? audioStreams.find((s) => s.IsDefault)?.Index ?? audioStreams[0]?.Index ?? null;
    // Another track than the default: have Jellyfin serve it (the file as it is would play the default).
    if (audioIndex != null && audioIndex !== defaultAudio && src.SupportsDirectPlay && audioStreams.length > 1) {
      info = await ask({ EnableDirectPlay: false, EnableDirectStream: false, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true });
      src = info?.MediaSources?.[0] || src;
    }
    const audio = item.type === 'Audio';
    let path;
    let method;
    if (src.SupportsDirectPlay || (src.SupportsDirectStream && !src.TranscodingUrl)) {
      method = src.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream';
      path = `/${audio ? 'Audio' : 'Videos'}/${id}/stream?static=true&mediaSourceId=${encodeURIComponent(src.Id)}&deviceId=${encodeURIComponent(this.cfg.deviceId)}&playSessionId=${encodeURIComponent(info.PlaySessionId || '')}`;
    } else if (src.TranscodingUrl) {
      method = 'Transcode';
      path = src.TranscodingUrl;
    } else {
      throw new Error('Jellyfin cannot stream this to Halcyon.');
    }
    const subtitles = streams.filter((s) => s.Type === 'Subtitle' && (s.IsExternal || s.SupportsExternalStream || s.DeliveryMethod === 'External'))
      .map((s) => ({ index: s.Index, label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`, lang: s.Language || '', isDefault: Boolean(s.IsDefault),
        path: `/Videos/${id}/${encodeURIComponent(src.Id)}/Subtitles/${s.Index}/0/Stream.vtt` }));
    const audioTracks = audioStreams.map((s) => ({
      index: s.Index, lang: s.Language || '', isDefault: s.Index === defaultAudio,
      label: s.DisplayTitle || [s.Language, s.Codec && s.Codec.toUpperCase(), s.Channels && `${s.Channels} ch`].filter(Boolean).join(' · ') || `Track ${s.Index}`,
    }));
    return {
      ok: true, item, method, startTicks, audio,
      url: `jf://stream${path.startsWith('/') ? '' : '/'}${path}`,
      hls: method === 'Transcode' && /\.m3u8/i.test(path),
      playSessionId: info.PlaySessionId || '', mediaSourceId: src.Id, subtitles,
      audioTracks, audioIndex: audioIndex ?? defaultAudio,
    };
  }

  /** Tell Jellyfin where playback is: event = start | progress | stop. */
  async report(event, p) {
    const body = {
      ItemId: p.itemId, MediaSourceId: p.mediaSourceId, PlaySessionId: p.playSessionId, PlayMethod: p.method || 'DirectPlay',
      PositionTicks: Math.max(0, Math.round((p.position || 0) * TICKS)), IsPaused: Boolean(p.paused), CanSeek: true,
    };
    const path = event === 'start' ? '/Sessions/Playing' : event === 'stop' ? '/Sessions/Playing/Stopped' : '/Sessions/Playing/Progress';
    try {
      await this.request(path, { method: 'POST', body });
      // A transcode keeps running on the server until it is told to stop.
      if (event === 'stop' && p.method === 'Transcode' && p.playSessionId) {
        await this.request(`/Videos/ActiveEncodings?deviceId=${encodeURIComponent(this.cfg.deviceId)}&playSessionId=${encodeURIComponent(p.playSessionId)}`, { method: 'DELETE' }).catch(() => {});
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  /** For the jf:// protocol: the real URL of a path on the server, signed with the token. */
  resolve(path) {
    if (!this.connected) return null;
    const sep = path.includes('?') ? '&' : '?';
    return `${this.cfg.server}${path}${/[?&]api_key=/.test(path) ? '' : `${sep}api_key=${encodeURIComponent(this.token)}`}`;
  }
}

module.exports = { Jellyfin, TICKS };
