'use strict';
// Development aid: replay scripted input and capture screenshots.
//   HALCYON_DEV_SCRIPT=steps.json npm start
// steps: [{ "key": "Right", "times": 3 }, { "wait": 400 }, { "shot": "/abs/out.png" }, { "eval": "js" }, { "quit": true }]
// Recording: { "record": "/abs/dir", "fps": 24 } starts saving frames (frame_00001.png …) while the next
// steps run; { "stopRecord": true } stops and writes list.txt (an ffmpeg concat list with each
// frame's real duration, so playback keeps true timing).
const fs = require('fs');
const { app } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recorder(win, dir, fps = 24) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let stop = false;
  const every = 1000 / fps;
  const done = (async () => {
    while (!stop && !win.isDestroyed()) {
      const t = Date.now();
      const image = await win.webContents.capturePage().catch(() => null);
      if (image) {
        const name = `frame_${String(frames.length + 1).padStart(5, '0')}.png`;
        fs.writeFileSync(`${dir}/${name}`, image.toPNG());
        frames.push({ name, t });
      }
      const left = every - (Date.now() - t);
      if (left > 0) await sleep(left);
    }
    const lines = [];
    frames.forEach((f, i) => {
      const next = frames[i + 1] ? frames[i + 1].t : f.t + every;
      lines.push(`file '${f.name}'`, `duration ${((next - f.t) / 1000).toFixed(4)}`);
    });
    if (frames.length) lines.push(`file '${frames[frames.length - 1].name}'`);
    fs.writeFileSync(`${dir}/list.txt`, `${lines.join('\n')}\n`);
    return frames.length;
  })();
  return { stop: async () => { stop = true; return done; } };
}

async function run(win, file) {
  let rec = null;
  // A .js file is evaluated in the page as one async test and its result printed.
  const steps = file.endsWith('.js')
    ? [{ eval: fs.readFileSync(file, 'utf8') }, { quit: true }]
    : JSON.parse(fs.readFileSync(file, 'utf8'));
  await sleep(1500);
  // Controller input is ignored in the background, so make sure the test window is the active one.
  win.show();
  win.focus();
  win.webContents.focus();
  await sleep(300);
  for (const step of steps) {
    if (win.isDestroyed()) return;
    if (step.key) {
      for (let i = 0; i < (step.times || 1); i++) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: step.key });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: step.key });
        await sleep(step.gap || 140);
      }
    } else if (step.text) {
      for (const ch of step.text) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
        await sleep(60);
      }
    } else if (step.wait) {
      await sleep(step.wait);
    } else if (step.shot) {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(step.shot, image.toPNG());
    } else if (step.record) {
      if (rec) await rec.stop();
      rec = recorder(win, step.record, step.fps || 24);
    } else if (step.stopRecord) {
      if (rec) { const n = await rec.stop(); console.log(`recorded ${n} frames`); rec = null; }
    } else if (step.eval) {
      const out = await win.webContents.executeJavaScript(step.eval).catch((e) => `ERR ${e.message}`);
      console.log(typeof out === 'string' ? out : JSON.stringify(out));
    } else if (step.quit) {
      app.quit();
    }
  }
}

module.exports = { run };
