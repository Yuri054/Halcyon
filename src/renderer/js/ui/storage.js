// Storage: each drive with games on it (free space and a bar of how full it is), then the
// games on a drive, largest first, with Play / Uninstall. Opened from Settings › system and
// from the Guide.
import { api, game as findGame, fmt } from '../core/state.js';
import { app } from '../core/bus.js';
import { openPanel } from './dialog.js';
import { toast } from './toast.js';
import { uninstallGame } from './gamemenu.js';

const size = (n) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : fmt.size(n) || '0 B');

export async function openStorage() {
  const panel = openPanel();
  let drives = [];
  const load = async () => { drives = (await api.storage.info().catch(() => [])) || []; };
  await load();
  if (!drives.length) { await panel.close(); toast('Halcyon found no installed games to measure.', { title: 'Storage' }); return; }
  let selected = null;
  for (;;) {
    const pick = await panel.ask({
      title: 'Storage',
      subtitle: `${fmt.count(drives.reduce((n, d) => n + d.games.length, 0), 'game')} on ${fmt.count(drives.length, 'drive')}`,
      selected,
      items: drives.map((d) => {
        const games = d.games.reduce((n, g) => n + g.size, 0);
        const used = d.total ? Math.round(((d.total - d.free) / d.total) * 100) : null;
        return {
          label: d.mount === '/' ? 'System drive' : d.mount.split('/').filter(Boolean).pop() || d.mount,
          value: d.mount, iconName: 'folder', verb: 'Open',
          sub: [d.total ? `${size(d.free)} free of ${size(d.total)}` : null, `${fmt.count(d.games.length, 'game')} · ${size(games)}`, d.mount].filter(Boolean).join('  ·  '),
          meter: used,
        };
      }),
    });
    if (pick == null) break;
    selected = pick;
    const drive = drives.find((d) => d.mount === pick);
    if (drive) { await showDrive(panel, drive); await load(); }
  }
  await panel.close();
}

async function showDrive(panel, drive) {
  let selected = null;
  for (;;) {
    const biggest = drive.games[0]?.size || 1;
    const pick = await panel.ask({
      title: drive.mount === '/' ? 'System drive' : drive.mount,
      subtitle: drive.total ? `${size(drive.free)} free of ${size(drive.total)}  ·  games use ${size(drive.games.reduce((n, g) => n + g.size, 0))}` : drive.mount,
      selected,
      items: drive.games.length ? drive.games.map((g) => ({
        label: g.name, value: g.id, iconName: g.source === 'steam' ? 'cloud' : g.source === 'emulator' ? 'chip' : 'pad',
        hint: g.size ? size(g.size) : '—', sub: [g.platform, fmt.ago(g.lastPlayed)].filter(Boolean).join(' · '),
        meter: g.size ? Math.max(2, Math.round((g.size / biggest) * 100)) : null, verb: 'Manage',
      })) : [{ label: 'No games here', value: 'noop', disabled: true }],
    });
    if (pick == null) return;
    selected = pick;
    const g = findGame(pick);
    if (!g) continue;
    const what = await panel.ask({
      title: g.name, subtitle: [g.platform, g.sizeBytes ? size(g.sizeBytes) : null, g.detail].filter(Boolean).join('  ·  '),
      items: [
        { label: 'Play', value: 'play', iconName: 'play' },
        g.source === 'steam' && { label: 'Uninstall', value: 'uninstall', iconName: 'trash', danger: true, sub: g.sizeBytes ? `Frees ${size(g.sizeBytes)}` : null },
        g.source !== 'steam' && { label: 'Uninstalling isn’t handled by Halcyon for this game', value: 'noop', disabled: true, sub: 'ROMs and added games are your own files' },
      ],
    });
    if (what === 'play') { await panel.close(); app.launch(g.id); return; }
    if (what === 'uninstall' && (await uninstallGame(g))) {
      drive.games = drive.games.filter((x) => x.id !== g.id);
      drive.free += g.sizeBytes || 0;
      selected = drive.games[0]?.id || null;
    }
  }
}

