// Interface sounds: synthesised tones by default (no audio assets), or the
// samples of a sound pack when one is chosen. Events a pack does not cover
// fall back to the tones.
let ctx = null;
let enabled = true;
let samples = {};          // event -> { buffer, gain, offset }
let packGain = 0.7;

// Packs are levelled as they load, since their files rarely match each other:
// each sound's loudest moment is brought to a target for its kind (moving around
// sits quieter than confirming), and silence before the sound starts is skipped.
const TARGET_DB = {
  move: -27, typing: -27, edge: -27,
  select: -21, back: -21, open: -21, launch: -21,
  sectionLeft: -22, sectionRight: -22, guide: -22, wake: -24,
  toast: -21, download: -21, error: -21,
  boot: -16,
};
/** Sounds that cut off their previous play instead of layering on it. */
const CUT = new Set(['move', 'typing', 'edge', 'sectionLeft', 'sectionRight', 'guide']);

/** Loudest 50 ms (RMS, all channels) and where the sound actually begins. */
function measure(buffer) {
  const n = buffer.length;
  const mix = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mix[i] += d[i] / buffer.numberOfChannels;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const win = Math.max(1, Math.round(buffer.sampleRate * 0.05));
  let loudest = 0;
  for (let i = 0; i < n; i += Math.max(1, win >> 1)) {
    let sum = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) sum += mix[j] * mix[j];
    loudest = Math.max(loudest, Math.sqrt(sum / (end - i || 1)));
  }
  let first = 0;
  while (first < n && Math.abs(mix[first]) < peak * 0.05) first++;
  const offset = Math.max(0, first / buffer.sampleRate - 0.005);
  return { loudest, offset: offset < buffer.duration - 0.05 ? offset : 0 };
}
const playing = new Map(); // event -> source, so a held direction does not pile sounds up

export const setEnabled = (on) => { enabled = Boolean(on); };

function audio() {
  ctx = ctx || new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** sounds: { event: ArrayBuffer | Uint8Array } from a pack, or null for the built-in tones. */
export async function setPack(sounds) {
  samples = {};
  if (!sounds) return 0;
  const c = audio();
  await Promise.all(Object.entries(sounds).map(async ([event, data]) => {
    try {
      const bytes = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const buffer = await c.decodeAudioData(bytes);
      const { loudest, offset } = measure(buffer);
      const target = 10 ** ((TARGET_DB[event] ?? -21) / 20);
      const gain = loudest > 0 ? Math.min(3, Math.max(0.05, target / loudest)) : 1;
      samples[event] = { buffer, gain, offset };
    } catch { /* unreadable file: that event keeps its tone */ }
  }));
  return Object.keys(samples).length;
}

function sample(event) {
  const s = samples[event];
  if (!s || !enabled) return Boolean(s);
  try {
    const c = audio();
    // Repeated sounds restart instead of stacking; the section whooshes (both
    // directions share one slot) fade the last one out quickly.
    const slot = event.startsWith('section') || event === 'guide' ? 'section' : event;
    const prev = playing.get(slot);
    if (prev && CUT.has(event)) {
      try {
        prev.amp.gain.setTargetAtTime(0, c.currentTime, 0.02);
        prev.src.stop(c.currentTime + 0.1);
      } catch { /* already ended */ }
    }
    const src = c.createBufferSource();
    const amp = c.createGain();
    amp.gain.value = packGain * s.gain;
    src.buffer = s.buffer;
    src.connect(amp).connect(c.destination);
    const entry = { src, amp };
    src.onended = () => { if (playing.get(slot) === entry) playing.delete(slot); };
    playing.set(slot, entry);
    src.start(0, s.offset);
  } catch { /* audio unavailable: stay silent */ }
  return true;
}

function tone({ freq, to = freq, dur = 0.07, gain = 0.05, type = 'sine', delay = 0, attack = 0.008 }) {
  if (!enabled) return;
  try {
    const c = audio();
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch { /* audio unavailable: stay silent */ }
}

const TONES = {
  move: () => tone({ freq: 880, to: 990, dur: 0.045, gain: 0.028 }),
  edge: () => tone({ freq: 180, to: 140, dur: 0.06, gain: 0.03, type: 'triangle' }),
  select: () => { tone({ freq: 620, to: 930, dur: 0.09, gain: 0.05 }); tone({ freq: 1240, dur: 0.12, gain: 0.025, delay: 0.05 }); },
  back: () => tone({ freq: 520, to: 330, dur: 0.1, gain: 0.045 }),
  section: () => { tone({ freq: 440, to: 660, dur: 0.12, gain: 0.04, type: 'triangle' }); },
  open: () => { tone({ freq: 392, to: 587, dur: 0.14, gain: 0.04 }); },
  toast: () => { tone({ freq: 784, dur: 0.1, gain: 0.04 }); tone({ freq: 1175, dur: 0.18, gain: 0.035, delay: 0.09 }); },
  error: () => { tone({ freq: 220, to: 160, dur: 0.18, gain: 0.05, type: 'triangle' }); },
  launch: () => { [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.22, gain: 0.04, delay: i * 0.07 })); },
  // Start-up chime: a slow open fifth that blooms into a bright chord.
  boot: () => {
    [[98, 0, 2.4, 0.05], [147, 0.1, 2.3, 0.04], [196, 0.25, 2.2, 0.035]].forEach(([f, d, len, g]) => tone({ freq: f, dur: len, gain: g, delay: d, attack: 0.5 }));
    [[392, 1.0], [587, 1.12], [784, 1.24], [1175, 1.4]].forEach(([f, d]) => tone({ freq: f, dur: 1.5, gain: 0.03, delay: d, attack: 0.03 }));
  },
  guide: () => { tone({ freq: 330, to: 494, dur: 0.16, gain: 0.04, type: 'triangle' }); tone({ freq: 659, dur: 0.2, gain: 0.03, delay: 0.08 }); },
  wake: () => tone({ freq: 523, to: 784, dur: 0.18, gain: 0.03 }),
};

const play = (event, fallback = event) => { if (!sample(event)) TONES[fallback](); };

/** For tests and tuning: the level each loaded sample plays at. */
export const packLevels = () => Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { gain: +v.gain.toFixed(3), offsetMs: Math.round(v.offset * 1000) }]));

export const sfx = {
  move: () => play('move'),
  edge: () => play('edge'),
  select: () => play('select'),
  back: () => play('back'),
  /** dir: 'left' | 'right' — packs can sound different each way. */
  section: (dir = 'right') => play(dir === 'left' ? 'sectionLeft' : 'sectionRight', 'section'),
  open: () => play('open'),
  toast: () => play('toast'),
  download: () => play('download', 'toast'),
  error: () => play('error'),
  launch: () => play('launch'),
  boot: () => play('boot'),
  guide: () => play('guide'),
  wake: () => play('wake'),
  typing: () => play('typing', 'move'),
};
