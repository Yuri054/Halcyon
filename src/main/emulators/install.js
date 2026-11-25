'use strict';
// Installing emulators from inside the launcher: the latest AppImage from the
// project's GitHub releases, or the Flathub build when a project ships none.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { EMULATORS } = require('./catalog');
const { HOME, which, flatpakInstalled } = require('../util');

const API = process.env.HALCYON_GITHUB_API || 'https://api.github.com';
const INSTALL_DIR = process.env.HALCYON_INSTALL_DIR || path.join(HOME, 'Applications');
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'halcyon-launcher' };

const active = new Map(); // emulator id -> AbortController

const def = (id) => EMULATORS.find((e) => e.id === id);
const pageUrl = (d) => d.home || (d.repo ? `https://github.com/${d.repo}` : null);

const OTHER_ARCH = /aarch64|arm64|armhf|armv7|arm32|riscv|ppc64|i386|i686/i;
const UNWANTED = /\.zsync$|[-_.]dbg[-_.]|debug|sse2|symbols/i;

/** Choose the x86-64 AppImage (or a zip that contains one) from a release's assets. */
function pickAsset(assets) {
  const usable = assets.filter((a) => !OTHER_ARCH.test(a.name) && !UNWANTED.test(a.name));
  const score = (a) => (/x86_64|x64|amd64|linux64/i.test(a.name) ? 2 : 1);
  const best = (list) => list.sort((a, b) => score(b) - score(a))[0] || null;
  return best(usable.filter((a) => /\.appimage$/i.test(a.name)))
    || best(usable.filter((a) => /appimage.*\.zip$/i.test(a.name)));
}

function machineOk() {
  return os.arch() === 'x64';
}

/** What can be done for this emulator right now: { name, page, github, flatpak }. */
async function plan(id) {
  const d = def(id);
  if (!d) return { ok: false, error: 'Unknown emulator.' };
  const out = {
    ok: true, id, name: d.name, repo: d.repo || null, page: pageUrl(d), github: null, githubNote: null,
    flatpak: d.flatpak ? { id: d.flatpak, available: Boolean(which('flatpak')), installed: flatpakInstalled(d.flatpak) } : null,
  };
  if (!d.repo) { out.githubNote = `${d.name} does not publish builds on GitHub.`; return out; }
  if (!machineOk()) { out.githubNote = 'Downloads are only offered for 64-bit Intel/AMD systems.'; return out; }
  try {
    const res = await fetch(`${API}/repos/${d.repo}/releases/latest`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (res.status === 403 || res.status === 429) { out.githubNote = 'GitHub is limiting requests right now. Try again in a little while.'; return out; }
    if (!res.ok) { out.githubNote = `${d.name} has no downloadable release on GitHub.`; return out; }
    const release = await res.json();
    const asset = pickAsset(release.assets || []);
    if (!asset) { out.githubNote = `The latest ${d.name} release has no Linux AppImage.`; return out; }
    out.github = { tag: release.tag_name || '', name: asset.name, size: asset.size, url: asset.browser_download_url, zipped: /\.zip$/i.test(asset.name) };
  } catch (err) {
    out.githubNote = `Could not reach GitHub (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`;
  }
  return out;
}

function run(cmd, args, { signal, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { signal, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), error: err ? (String(stderr || '').trim().split('\n').pop() || err.message) : null });
    });
  });
}

async function download(url, dest, size, { signal, onProgress }) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  const file = fs.createWriteStream(dest);
  let got = 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
      const now = Date.now();
      if (onProgress && now - last > 120) { last = now; onProgress({ phase: 'download', received: got, total }); }
    }
  } finally {
    await new Promise((r) => file.end(r));
  }
  if (total && got !== total) throw new Error('The download was cut short. Try again.');
  if (onProgress) onProgress({ phase: 'download', received: got, total: total || got });
}

async function findAppImage(dir) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const inner = await findAppImage(full); if (inner) return inner; }
    else if (/\.appimage$/i.test(entry.name)) return full;
  }
  return null;
}

/** AppImages need FUSE 2 to start; say so up front instead of failing mysteriously at launch. */
async function fuseNote() {
  if (!which('ldconfig') && !fs.existsSync('/sbin/ldconfig')) return null;
  const r = await run(which('ldconfig') || '/sbin/ldconfig', ['-p']);
  if (!r.ok || /libfuse\.so\.2/.test(r.out)) return null;
  return 'AppImages need FUSE 2 (package “libfuse2”), which does not seem to be installed.';
}

async function installFromGithub(id, record, onProgress) {
  const d = def(id);
  const info = await plan(id);
  if (!info.ok) return info;
  if (!info.github) return { ok: false, error: info.githubNote || 'Nothing to download.' };
  const { github } = info;
  const controller = new AbortController();
  active.set(id, controller);

  // Keep the emulator's name in the file name: that is how it is detected afterwards.
  let fileName = github.name.replace(/\.zip$/i, '.AppImage').replace(/\.appimage$/i, '.AppImage');
  if (!d.appimage.test(fileName)) fileName = `${d.name}-${fileName}`;
  const dest = path.join(INSTALL_DIR, fileName);
  const part = `${dest}.part`;
  let tmpDir = null;

  try {
    await fsp.mkdir(INSTALL_DIR, { recursive: true });
    await download(github.url, part, github.size, { signal: controller.signal, onProgress });
    let ready = part;
    if (github.zipped) {
      if (!which('unzip')) throw new Error('This release is a zip archive and “unzip” is not installed.');
      onProgress({ phase: 'unpack' });
      tmpDir = await fsp.mkdtemp(path.join(INSTALL_DIR, '.halcyon-unpack-'));
      const r = await run('unzip', ['-o', '-q', part, '-d', tmpDir], { signal: controller.signal });
      if (!r.ok) throw new Error(`Could not unpack the archive: ${r.error}`);
      ready = await findAppImage(tmpDir);
      if (!ready) throw new Error('The archive did not contain an AppImage.');
    }
    await fsp.chmod(ready, 0o755);
    // Replace the build Halcyon installed before, so old versions do not pile up.
    if (record && record.file && record.file !== dest && record.file.startsWith(INSTALL_DIR + path.sep)) {
      await fsp.rm(record.file, { force: true });
    }
    await fsp.rename(ready, dest);
    return { ok: true, method: 'github', file: dest, tag: github.tag, repo: d.repo, note: await fuseNote() };
  } catch (err) {
    const cancelled = controller.signal.aborted;
    return { ok: false, cancelled, error: cancelled ? 'Download cancelled.' : err.message };
  } finally {
    active.delete(id);
    await fsp.rm(part, { force: true }).catch(() => {});
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function installFromFlathub(id, onProgress) {
  const d = def(id);
  if (!d.flatpak) return { ok: false, error: `${d.name} is not on Flathub.` };
  if (!which('flatpak')) return { ok: false, error: 'Flatpak is not installed on this system.' };
  const controller = new AbortController();
  active.set(id, controller);
  try {
    onProgress({ phase: 'flatpak' });
    // Per-user install: no administrator password prompt to deal with from the couch.
    await run('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo'], { signal: controller.signal, timeout: 60000 });
    const r = await run('flatpak', ['install', '--user', '--noninteractive', '-y', 'flathub', d.flatpak], { signal: controller.signal });
    if (!r.ok) return { ok: false, cancelled: controller.signal.aborted, error: controller.signal.aborted ? 'Install cancelled.' : `Flatpak could not install ${d.name}: ${r.error}` };
    return { ok: true, method: 'flatpak', flatpak: d.flatpak };
  } finally {
    active.delete(id);
  }
}

/** method: 'github' | 'flatpak'. record is what a previous install left in the config. */
function install(id, method, record, onProgress = () => {}) {
  if (!def(id)) return Promise.resolve({ ok: false, error: 'Unknown emulator.' });
  if (active.has(id)) return Promise.resolve({ ok: false, error: 'An install for this emulator is already running.' });
  return method === 'flatpak' ? installFromFlathub(id, onProgress) : installFromGithub(id, record, onProgress);
}

function cancel(id) {
  const c = active.get(id);
  if (c) c.abort();
  return { ok: Boolean(c) };
}

module.exports = { plan, install, cancel, pickAsset, pageUrl, INSTALL_DIR };
