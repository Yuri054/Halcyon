'use strict';
// YouTube's TV app gets its ads from its own API replies: the player and "next" payloads
// say which ad to play and where the breaks are. Halcyon takes those bookings out of the
// replies before the TV app reads them, so it never asks for an ad in the first place.
// The ad/tracking endpoints are stopped as well. This is deliberately done quietly at the
// network layer, before the TV app sees the reply, so YouTube has nothing to notice and
// there is no "ad blocker detected" screen to get past.
const log = require('./log');

// Keys that hold an ad booking, an ad renderer or the player's ad state. Anything whose
// name starts with "ad" followed by a capital ("adPlacements", "adSlots", "adBreak…") is
// pruned too; that rule does not touch fields such as "adaptiveFormats" or "addToPlaylist".
const AD_KEYS = new Set([
  'ad',
  'ads',
  'advert',
  'isAd',
  'playerAd',
  'playerAds',
  'playerAdPlacements',
  'playerAdSlots',
  'videoAd',
  'videoAds',
  'serverAd',
  'serverAds',
  'serverAdPlacements',
  'serverAdSlots',
  'serverAdParams',
  'adClientParams',
  'adBreakHeartbeatParams',
  'adBreakParams',
  'adPlacements',
  'adSlots',
  'adVideoId',
  'adVideo',
  'adDurationRemaining',
  'promotedVideoRenderer',
  'promotedSparklesTextSearchRenderer',
  'promotedSparklesWebRenderer',
  'searchPyvRenderer',
  'displayAdRenderer',
  'inFeedAdLayoutRenderer',
  'playerAdRenderer',
  'playerLegacyAdRenderer',
  'adSlotRenderer',
  'adPlacementRenderer',
  'adBreakRenderer',
  'adBreakServiceRenderer',
  'adThumbnailRenderer',
  'adsEngagementPanelRenderer',
]);
const AD_KEY = /^(?:ads?|advert)[A-Z0-9_]/;

// Ad renderers can turn up as entries in a list. Remove the entry as a whole rather than
// leaving an empty shell the app may still treat as a video.
const AD_RENDERER_KEYS = new Set([
  'adSlotRenderer',
  'adPlacementRenderer',
  'adBreakRenderer',
  'adBreakServiceRenderer',
  'adThumbnailRenderer',
  'displayAdRenderer',
  'inFeedAdLayoutRenderer',
  'playerAdRenderer',
  'playerLegacyAdRenderer',
  'promotedVideoRenderer',
  'promotedSparklesTextSearchRenderer',
  'promotedSparklesWebRenderer',
  'searchPyvRenderer',
  'adsEngagementPanelRenderer',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAdKey = (key) => AD_KEYS.has(key) || AD_KEY.test(key);

const flaggedAd = (obj) => isObject(obj) && (obj.isAd === true || (isObject(obj.adClientParams) && obj.adClientParams.isAd === true));

/**
 * True if this list entry is an ad: it is an ad renderer ({ adSlotRenderer: ... }), or it (or
 * the renderer it wraps, one level down: { tileRenderer: { isAd: true } }) says it is one.
 * A field merely named "ad..." or an "isAd": false does not make an entry an ad.
 */
function isAdEntry(obj) {
  if (!isObject(obj)) return false;
  if (flaggedAd(obj)) return true;
  return Object.keys(obj).some((key) => AD_RENDERER_KEYS.has(key) || flaggedAd(obj[key]));
}

/** Remove ad bookings/state from a decoded Innertube reply, in place. Returns true if changed. */
function stripAds(value) {
  // Entries are removed only from lists inside the reply, never the reply itself (a batched
  // reply is an array of whole replies).
  function walk(node, root) {
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (!root && isAdEntry(node[i])) { node.splice(i, 1); changed = true; continue; }
        if (walk(node[i], false)) changed = true;
      }
      return changed;
    }
    if (!isObject(node)) return false;
    for (const key of Object.keys(node)) {
      // "isAd": false is left alone; only real ad bookings and ad state are taken out.
      if (isAdKey(key) && !(key === 'isAd' && node[key] === false)) { delete node[key]; changed = true; continue; }
      if (walk(node[key], false)) changed = true;
    }
    return changed;
  }
  return walk(value, true);
}

/**
 * Patch one Innertube JSON reply. Returns the new text, or null when there was nothing
 * to remove (so an unchanged reply is passed straight through).
 */
function patchReply(text) {
  if (typeof text !== 'string' || !text) return null;
  // YouTube's JSON replies sometimes start with an anti-JSON-hijacking prefix. Keep it.
  let prefix = '';
  let json = text;
  if (json.startsWith(")]}'")) {
    const end = json.indexOf('\n');
    if (end === -1) return null;
    prefix = json.slice(0, end + 1);
    json = json.slice(end + 1);
  }
  let data;
  try { data = JSON.parse(json); } catch { return null; }   // not JSON: leave it alone
  if (!stripAds(data)) return null;
  return prefix + JSON.stringify(data);
}

const header = (headers, name) => (headers || []).find((h) => String(h.name).toLowerCase() === name)?.value;

/** Continue a paused request/response without changing it. */
async function release(dbg, params) {
  const requestId = params.requestId;
  if (params.responseStatusCode) {
    try { await dbg.sendCommand('Fetch.continueResponse', { requestId }); return; } catch { /* older protocol */ }
  }
  await dbg.sendCommand('Fetch.continueRequest', { requestId });
}

/**
 * Remove ads from the TV app's API replies, for the lifetime of this webContents.
 * Resolves { ok, stop } once replies are being watched (ok: false if they can't be).
 * hooks.onLost(): the debugger went away by itself (renderer gone, DevTools took over).
 * hooks.onSkipped(): a reply couldn't be rewritten and went through as it was.
 */
async function installResponseScrubber(webContents, hooks = {}) {
  const dbg = webContents.debugger;
  let disposed = false;
  try { dbg.attach('1.3'); } catch (err) {
    log.log('youtube: adblock could not attach', err.message);
    return { ok: false, stop: () => {} };
  }

  const onMessage = async (_event, method, params) => {
    if (disposed || method !== 'Fetch.requestPaused') return;
    const requestId = params.requestId;
    try {
      if (!params.responseStatusCode) {
        await dbg.sendCommand('Fetch.continueRequest', { requestId });
        return;
      }
      const type = header(params.responseHeaders, 'content-type');
      if (type && !/json|javascript|text\/plain/i.test(type)) {
        await release(dbg, params);
        return;
      }
      const body = await dbg.sendCommand('Fetch.getResponseBody', { requestId });
      const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const patched = patchReply(text);
      if (patched == null) {
        await release(dbg, params);
        return;
      }
      // The body is plain text now, so content length and encoding no longer describe it.
      const responseHeaders = (params.responseHeaders || []).filter((h) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name));
      if (!responseHeaders.some((h) => /^content-type$/i.test(h.name))) responseHeaders.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
      await dbg.sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: params.responseStatusCode,
        responseHeaders,
        body: Buffer.from(patched, 'utf8').toString('base64'),
      });
      log.log('youtube: removed ads from a reply');
    } catch (err) {
      // Fail open: a reply Halcyon cannot rewrite still reaches the TV app.
      if (disposed) return;
      const benign = /No resource with given identifier|Invalid InterceptionId/i.test(err.message);
      if (!benign) log.log('youtube: adblock skipped a reply:', err.message);
      try { await release(dbg, params); } catch { /* the app already moved on */ }
      if (!benign && hooks.onSkipped) hooks.onSkipped();
    }
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    dbg.removeListener('message', onMessage);
    dbg.removeListener('detach', onDetach);
    try { dbg.sendCommand('Fetch.disable').catch(() => {}); } catch { /* detached */ }
    try { if (dbg.isAttached()) dbg.detach(); } catch { /* window already gone */ }
  };
  // Detached by something else: nothing is being scrubbed any more, so say so.
  function onDetach(_event, reason) {
    if (disposed) return;
    log.log('youtube: adblock lost its debugger:', reason);
    stop();
    if (hooks.onLost) hooks.onLost();
  }

  dbg.on('message', onMessage);
  dbg.on('detach', onDetach);
  try {
    await dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*youtubei/v1/*', requestStage: 'Response' }] });
  } catch (err) {
    log.log('youtube: adblock could not watch replies', err.message);
    stop();
    return { ok: false, stop: () => {} };
  }
  return { ok: true, stop };
}

// Ad/tracking requests that only exist for advertising. Video data itself comes from
// googlevideo.com and is left alone.
const AD_URLS = [
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/youtubei/v1/player/ad_break*',
  '*://*.youtube.com/get_midroll_info*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.moatads.com/*',
  '*://*.2mdn.net/*',
  '*://*.serving-sys.com/*',
  '*://*.adsafeprotected.com/*',
];

/** Stop the TV app's ad-decision and ad-tracking requests in its own session. */
function blockAdRequests(session) {
  const listener = (_details, callback) => callback({ cancel: true });
  session.webRequest.onBeforeRequest({ urls: AD_URLS }, listener);
  // If the adblock is turned off, put a pass-through listener in the same slot.
  return () => {
    try { session.webRequest.onBeforeRequest({ urls: AD_URLS }, (_details, callback) => callback({ cancel: false })); } catch { /* session gone */ }
  };
}

const PAUSE_BLOCKING_MS = 2 * 60 * 1000;

/**
 * Turn both layers on for a YouTube window. Resolves a function that turns them off, or null
 * when replies can't be scrubbed (then nothing is blocked either: with ad bookings left in
 * place, blocked ad requests could leave the player stuck at an ad break).
 * onLost(): the scrubber stopped by itself; both layers are off again.
 */
async function install(webContents, { onLost } = {}) {
  let unblock = null;
  let resume = null;
  const lift = () => { clearTimeout(resume); resume = null; if (unblock) { unblock(); unblock = null; } };
  const scrub = await installResponseScrubber(webContents, {
    onLost: () => { lift(); if (onLost) onLost(); },
    // A reply went through with its ads: let ad requests through for a while so the player
    // can play an ad it was told about instead of waiting on a blocked one.
    onSkipped: () => {
      if (unblock) { unblock(); unblock = null; log.log('youtube: ad requests allowed for a while (a reply kept its ads)'); }
      clearTimeout(resume);
      resume = setTimeout(() => { resume = null; if (!webContents.isDestroyed()) unblock = blockAdRequests(webContents.session); }, PAUSE_BLOCKING_MS);
    },
  });
  if (!scrub.ok) return null;
  unblock = blockAdRequests(webContents.session);
  return () => { scrub.stop(); lift(); };
}

module.exports = { install, blockAdRequests, installResponseScrubber, stripAds, patchReply, AD_URLS };
