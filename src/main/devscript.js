'use strict';
// Development aid: replay scripted input and capture screenshots.
//   HALCYON_DEV_SCRIPT=steps.json npm start
// steps: [{ "key": "Right", "times": 3 }, { "wait": 400 }, { "shot": "/abs/out.png" }, { "eval": "js" }, { "quit": true }]
const fs = require('fs');
const { app } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win, file) {
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
    } else if (step.eval) {
      const out = await win.webContents.executeJavaScript(step.eval).catch((e) => `ERR ${e.message}`);
      console.log(typeof out === 'string' ? out : JSON.stringify(out));
    } else if (step.quit) {
      app.quit();
    }
  }
}

module.exports = { run };
