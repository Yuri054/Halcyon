// "Where would you like to play?": asked when Halcyon starts with more than one screen connected
// (Settings › Display › Ask which screen at start). Halcyon has opened on the screen where it was
// started; the person picks a screen and Halcyon moves there before its start-up intro. Left alone,
// it goes to the screen used last time.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api, state } from '../core/state.js';

const AUTO_SECONDS = 10;

export async function askStartScreen() {
  const displays = (await api.system.displays().catch(() => [])) || [];
  if (displays.length < 2) { await api.system.startScreen(null).catch(() => {}); return; }
  const last = state.lib.settings.monitor;
  const lastOne = displays.find((d) => d.label === last) || displays.find((d) => d.current) || displays[0];

  const countdown = h('div', { class: 'startscreen__count' });
  const tiles = displays.map((d) => {
    const tv = /tv|hdmi/i.test(`${d.name} ${d.port}`);
    const t = h('div', { class: 'startscreen__tile', 'data-focus': true, 'data-key': `screen:${d.label}` },
      h('div', { class: 'startscreen__icon' }, icon(tv ? 'tv' : 'screen')),
      h('div', { class: 'startscreen__name' }, d.name),
      h('div', { class: 'startscreen__meta' }, [d.port, `${d.width} × ${d.height}`].filter(Boolean).join('  ·  ')),
      d === lastOne && h('div', { class: 'startscreen__tag' }, 'Last used'));
    t.dataset.label = d.label;
    return t;
  });
  const el = h('div', { class: 'startscreen' },
    h('div', { class: 'startscreen__head' },
      h('div', { class: 'startscreen__title' }, 'Where would you like to play?'),
      h('div', { class: 'startscreen__sub' }, 'Halcyon opens on the screen you choose')),
    h('div', { class: 'startscreen__tiles' }, ...tiles),
    countdown);
  document.body.append(el);

  return new Promise((resolve) => {
    let left = AUTO_SECONDS;
    let timer = null;
    let done = false;
    const finish = async (label) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      focus.popLayer(layer);
      sfx.select();
      el.classList.add('is-leaving');
      await api.system.startScreen(label).catch(() => {});
      setTimeout(() => { el.remove(); resolve(); }, 250);
    };
    const stopCountdown = () => { if (!timer) return; clearInterval(timer); timer = null; countdown.textContent = 'A to choose'; };
    const layer = focus.pushLayer({
      root: el,
      current: null,
      onAction(action, target, repeat) {
        stopCountdown();
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') { if (focus.move(action)) sfx.move(); return true; }
        if (action === 'accept' && !repeat && target?.dataset.label) { finish(target.dataset.label); return true; }
        return true;
      },
      hints: () => [{ a: 'left', b: 'right', label: 'Screen' }, { a: 'accept', label: 'Open here' }],
    });
    for (const t of tiles) t.addEventListener('click', () => finish(t.dataset.label));
    focus.focus(tiles[displays.indexOf(lastOne)] || tiles[0], { layer, scroll: false });
    const paint = () => { countdown.textContent = `Opening on ${lastOne.name} in ${left}…`; };
    paint();
    timer = setInterval(() => { left -= 1; if (left <= 0) finish(lastOne.label); else paint(); }, 1000);
  });
}
