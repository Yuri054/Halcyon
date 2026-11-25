// A volume row for blade menus: left/right adjusts the system volume, select mutes.
import { icon } from '../core/dom.js';
import { sfx } from '../core/sfx.js';
import { api } from '../core/state.js';

const STEP = 5;

/** status is the result of api.system.status(). Returns { item(), onAction } for openPanel().ask(). */
export function volumeRow(panel, status) {
  const volume = status?.volume?.ok ? { level: status.volume.level, muted: status.volume.muted } : null;
  const text = () => (volume.muted ? 'Muted' : `${volume.level}%`);

  function paint() {
    const row = panel.el.querySelector('[data-key="row:volume"]');
    if (!row) return;
    row.querySelector('.row__hint').textContent = text();
    row.querySelector('.row__meter i').style.width = `${volume.muted ? 0 : volume.level}%`;
    row.querySelector('.row__icon').replaceWith(icon(volume.muted ? 'mute' : 'sound', 'row__icon'));
  }

  return {
    item: () => (volume
      ? { label: 'Volume', value: 'volume', key: 'volume', iconName: volume.muted ? 'mute' : 'sound', hint: text(), meter: volume.muted ? 0 : volume.level, sub: 'Left and right to adjust', verb: 'Mute' }
      : { label: 'Volume unavailable', key: 'novolume', disabled: true, sub: status?.volume?.error || 'The audio system did not answer.' }),
    onAction(action, target) {
      if (!volume || target?.dataset.key !== 'row:volume') return false;
      if (action === 'left' || action === 'right') {
        const next = Math.max(0, Math.min(100, Math.round(volume.level / STEP) * STEP + (action === 'right' ? STEP : -STEP)));
        if (next === volume.level && !volume.muted) { sfx.edge(); return true; }
        volume.level = next;
        volume.muted = false;
        paint();
        api.system.setVolume({ level: next, muted: false }).then(() => sfx.move());
        return true;
      }
      if (action === 'accept') {
        volume.muted = !volume.muted;
        paint();
        api.system.setVolume({ muted: volume.muted }).then(() => sfx.select());
        return true;
      }
      return false;
    },
  };
}
