// Opening YouTube (its TV interface, in a window of its own) from the dashboard.
import { api } from '../core/state.js';
import { sfx } from '../core/sfx.js';
import { toast } from './toast.js';
import { stopBackground } from '../media/player.js';

export async function openYouTube() {
  stopBackground();   // music playing in the background stops, as for a video
  sfx.select();
  const r = await api.youtube.open().catch((err) => ({ ok: false, error: err.message }));
  if (r && r.ok === false) toast(r.error || 'YouTube didn’t open.', { type: 'error', title: 'YouTube' });
}
