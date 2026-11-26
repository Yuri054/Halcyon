// Sound follows the monitor: when Halcyon is on a screen with its own HDMI / DisplayPort
// audio (a TV, a receiver), the system's output switches to that screen, and goes back to
// what it was when Halcyon moves to another screen or closes.
//
// Which output is which screen: the graphics card's HDMI audio pins carry the monitor's
// name in their ELD ("HISENSE-TV"), read with amixer. PipeWire's own labels for these
// outputs can name the wrong monitor, so they are not trusted.
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');
const diary = require('./log');

const DRY = Boolean(process.env.HALCYON_DRY_RUN);
const run = (cmd, args, timeout = 5000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout }, (err, out) => resolve(err ? null : String(out)));
});
const json = async (args) => { try { return JSON.parse((await run('pactl', ['-f', 'json', ...args])) || '[]'); } catch { return []; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HDMI / DP outputs with a monitor on them: [{ monitor, formats, card, cardIndex, profile }]. */
async function outputs() {
  const cards = await json(['list', 'cards']);
  const list = [];
  for (const c of cards) {
    const n = c.properties?.['api.alsa.card'] ?? c.properties?.['alsa.card'];
    if (n == null) continue;
    const ctl = await run('amixer', ['-c', String(n), 'contents']);
    if (!ctl) continue;
    const re = /name='ELD',device=(\d+)\n[^\n]*\n\s*: values=([^\n]*)/g;
    let m;
    while ((m = re.exec(ctl))) {
      const bytes = m[2].split(',').filter(Boolean).map((x) => parseInt(x, 16));
      if (bytes.length < 21) continue;
      const nameLen = bytes[4] & 0x1f;
      const monitor = Buffer.from(bytes.slice(20, 20 + nameLen)).toString('latin1').replace(/\0/g, '').trim();
      if (!monitor) continue;
      let k = null;
      try { k = /name: HDMI (\d+)/.exec(fs.readFileSync(`/proc/asound/card${n}/pcm${m[1]}p/info`, 'utf8'))?.[1]; } catch { /* no such device */ }
      if (k == null) continue;
      const profile = Number(k) === 0 ? 'output:hdmi-stereo' : `output:hdmi-stereo-extra${k}`;
      const profiles = Array.isArray(c.profiles) ? c.profiles.map((p) => p.name) : Object.keys(c.profiles || {});
      if (!profiles.includes(profile)) continue;
      list.push({ monitor, formats: bytes[5] >> 4, card: c.name, cardIndex: String(n), profile, activeProfile: c.active_profile });
    }
  }
  return list;
}

/** Does this output sound like a TV or receiver (more than plain stereo PCM)? */
const tvLike = (o) => o.formats > 1;

let saved = null;   // { sink, card, profile, setSink } while Halcyon has switched the output

async function sinkOfCard(cardIndex) {
  for (let i = 0; i < 20; i++) {
    const sinks = await json(['list', 'sinks']);
    const s = sinks.find((x) => String(x.properties?.['api.alsa.card'] ?? x.properties?.['alsa.card']) === cardIndex && /hdmi/i.test(x.name));
    if (s) return s.name;
    await sleep(150);
  }
  return null;
}

/** Send sound to this monitor's output (model name as the desktop gives it), or put it back (null). */
async function follow(model) {
  const out = model ? (await outputs()).find((o) => o.monitor.toLowerCase() === model.toLowerCase()) : null;
  if (!out) { await restore(); return { ok: true, switched: false }; }
  if (DRY) { diary.log(`monitor audio: would switch to ${out.monitor} (${out.card} ${out.profile})`); return { ok: true, switched: false, dry: true }; }
  const before = ((await run('pactl', ['get-default-sink'])) || '').trim();
  if (!saved) saved = { sink: before, card: out.card, profile: out.activeProfile, setSink: null };
  if (out.activeProfile !== out.profile) await run('pactl', ['set-card-profile', out.card, out.profile]);
  const sink = await sinkOfCard(out.cardIndex);
  if (!sink) { diary.log(`monitor audio: no output appeared for ${out.monitor}`); return { ok: false }; }
  if (sink !== before) await run('pactl', ['set-default-sink', sink]);
  saved.setSink = sink;
  diary.log(`monitor audio: sound to ${out.monitor} (${sink}), was ${saved.sink}`);
  return { ok: true, switched: true, sink };
}

/** Put the output back as it was before Halcyon switched it (only if nobody changed it since). */
async function restore() {
  if (!saved) return;
  const s = saved;
  saved = null;
  const now = ((await run('pactl', ['get-default-sink'])) || '').trim();
  if (s.setSink && now && now !== s.setSink) { diary.log('monitor audio: output changed by hand; leaving it'); return; }
  if (s.profile) await run('pactl', ['set-card-profile', s.card, s.profile]);
  if (s.sink) await run('pactl', ['set-default-sink', s.sink]);
  diary.log(`monitor audio: sound back to ${s.sink}`);
}

/** The same, synchronously, for when Halcyon is quitting. */
function restoreSync() {
  if (!saved) return;
  const s = saved;
  saved = null;
  try {
    const now = String(execFileSync('pactl', ['get-default-sink'], { timeout: 3000 })).trim();
    if (s.setSink && now && now !== s.setSink) return;
    if (s.profile) execFileSync('pactl', ['set-card-profile', s.card, s.profile], { timeout: 3000 });
    if (s.sink) execFileSync('pactl', ['set-default-sink', s.sink], { timeout: 3000 });
  } catch { /* best effort */ }
}

module.exports = { outputs, follow, restore, restoreSync, tvLike };
