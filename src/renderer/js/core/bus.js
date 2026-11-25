// Late-bound app services, filled in by app.js. Lets UI modules call back into
// the shell (navigate, launch, refresh hints) without circular imports.
export const app = {
  go: () => {},
  launch: async () => {},
  refreshChrome: () => {},
  guide: async () => {},
  downloads: async () => {},
  search: () => {},
  idleMs: 5 * 60 * 1000,
};

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
