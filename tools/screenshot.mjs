#!/usr/bin/env node
/**
 * Headless screenshot tool for visual tuning.
 *
 *   node tools/screenshot.mjs [scene ...] [--wait=ms] [--out=dir] [--bg=key|#hex] [--target=selector]
 *
 * Recording: `record` captures an animation instead of a still:
 *   node tools/screenshot.mjs record --target='#hero' --frames=84 --fps=24 --name=hero [--sequence=interact] [--width=900]
 * Frames are stepped through the component's injectable clock (real time is
 * far too slow under SwiftShader) and encoded with ffmpeg to an animated WebP
 * in docs/media/<name>.webp. `--sequence=interact` hovers, presses and
 * releases the target's button partway through.
 *
 * Scenes: idle, hover, press, sizes, mobile, reduced, fallback, status, water,
 * backgrounds, page (full page), all (default: idle). `backgrounds` renders the status row on
 * every preset background; `--bg` sets the page background for other scenes.
 * Serves the package directory over HTTP (modules need a real origin), drives
 * Chromium with SwiftShader so WebGL2 works without a GPU, forwards console
 * output, and writes PNGs to shots/<scene>.png.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
let scenes = args.filter((a) => !a.startsWith('--'));
if (scenes.length === 0) scenes = ['idle'];
if (scenes.includes('all')) scenes = ['idle', 'hover', 'press', 'sizes', 'mobile', 'reduced', 'fallback', 'status', 'water'];
const BG_KEYS = ['black', 'darkgray', 'midgray', 'lightgray', 'verylight', 'white', 'mesh', 'photo'];
if (scenes.includes('backgrounds')) scenes = scenes.filter((s) => s !== 'backgrounds').concat(BG_KEYS.map((k) => `bg-${k}`));
const wait = Number(flags.wait ?? 1500);
const outDir = resolve(root, flags.out ?? 'shots');
const scale = Number(flags.scale ?? 2);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.map': 'application/json' };

const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/demo/index.html`;

async function launch() {
  const gpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'];
  try {
    return await chromium.launch({ args: gpuArgs });
  } catch {
    const systemChromium = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
    if (!systemChromium) throw new Error('No Chromium found');
    return await chromium.launch({ executablePath: systemChromium, args: gpuArgs });
  }
}

const browser = await launch();
await mkdir(outDir, { recursive: true });

for (const scene of scenes) {
  const mobile = scene === 'mobile';
  const bgKey = scene.startsWith('bg-') ? scene.slice(3) : flags.bg;
  const base = bgKey ? `${origin}?bg=${encodeURIComponent(bgKey)}` : origin;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 },
    deviceScaleFactor: scale,
    reducedMotion: scene === 'reduced' ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${scene}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[${scene}] pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => customElements.get('glass-button') !== undefined, null, { polling: 250, timeout: 90000 });
  // The fixed tuning panel would paint over element screenshots.
  await page.addStyleTag({ content: '.panel, .panel-toggle, .bgbar { display: none !important; }' });
  // The hero's CSS-fallback twin is for interactive comparison; captures show the GL hero alone unless asked.
  if (!flags.compare) await page.evaluate(() => document.getElementById('hero')?.classList.remove('compare'));

  const renderer = await page.evaluate(() => document.querySelector('glass-button')?.dataset.renderer);
  const hero = page.locator('#hero');
  const heroButton = page.locator('#hero-button');
  let target = hero;

  if (scene === 'hover') {
    await heroButton.hover({ position: { x: 120, y: 40 } });
  } else if (scene === 'press') {
    await heroButton.hover();
    await page.mouse.down();
  } else if (scene === 'sizes') {
    target = page.locator('#sizes');
  } else if (scene === 'mobile') {
    target = page.locator('#mobile');
  } else if (scene === 'fallback') {
    target = page.locator('#fallback');
  } else if (scene === 'status' || scene.startsWith('bg-')) {
    target = page.locator('#statuses');
  } else if (scene === 'water' || scene === 'water-hover') {
    target = page.locator('#water');
    if (scene === 'water-hover') await page.locator('#water glass-button').first().hover();
  } else if (scene === 'page') {
    target = null; // full page
  }

  if (flags.target) target = page.locator(flags.target);

  if (scene === 'record') {
    await recordScene(page, target, flags);
    await context.close();
    continue;
  }
  if (flags.etch) {
    // e.g. --etch="mode=2,depth=0.02" -> merged into every button's etch property
    const patch = Object.fromEntries(flags.etch.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
    await page.evaluate((patch) => { for (const el of document.querySelectorAll('glass-button')) el.etch = patch; }, patch);
  }
  if (flags.attrs) {
    // e.g. --attrs="level=1.8,effect=water" -> set on every button, then let it settle
    const pairs = flags.attrs.split(',').map((kv) => kv.split('='));
    await page.evaluate((pairs) => {
      for (const el of document.querySelectorAll('glass-button')) for (const [k, v] of pairs) el.setAttribute(k, v);
    }, pairs);
  }
  await page.waitForTimeout(wait);
  const suffix = (bgKey && !scene.startsWith('bg-') ? `-${bgKey.replace('#', '')}` : '') + (flags.name ? `-${flags.name}` : '');
  const file = join(outDir, `${scene}${suffix}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
  console.log(`${scene}: renderer=${renderer} -> ${file}`);
  if (scene === 'press') await page.mouse.up();
  await context.close();
}

await browser.close();
server.close();

async function recordScene(page, target, flags) {
  const frames = Number(flags.frames ?? 84);
  const fps = Number(flags.fps ?? 24);
  const width = Number(flags.width ?? 900);
  const name = flags.name ?? 'recording';
  const outFile = resolve(root, flags.out ?? 'docs/media', `${name}.webp`);
  const dir = mkdtempSync(join(tmpdir(), 'gb-frames-'));
  const stepMs = 1000 / fps;

  // Deterministic clock: every animation frame advances exactly one step.
  await page.evaluate(() => {
    const G = customElements.get('glass-button');
    window.__gbClock = 1000;
    G.timeSource = () => window.__gbClock;
  });
  const nextFrame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await nextFrame();

  const button = target.locator('glass-button').first();
  const box = await button.boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const sequence = flags.sequence === 'interact'
    ? { hover: Math.round(frames * 0.22), down: Math.round(frames * 0.5), up: Math.round(frames * 0.58), leave: Math.round(frames * 0.72) }
    : null;

  for (let i = 0; i < frames; i++) {
    if (sequence) {
      if (i === sequence.hover) await page.mouse.move(at(0.35, 0.45).x, at(0.35, 0.45).y, { steps: 1 });
      if (i > sequence.hover && i < sequence.leave) {
        const t = (i - sequence.hover) / (sequence.leave - sequence.hover);
        const p = at(0.35 + 0.35 * t, 0.45 - 0.15 * Math.sin(t * Math.PI));
        await page.mouse.move(p.x, p.y, { steps: 1 });
      }
      if (i === sequence.down) await page.mouse.down();
      if (i === sequence.up) await page.mouse.up();
      if (i === sequence.leave) await page.mouse.move(box.x - 40, box.y - 40, { steps: 1 });
    }
    await page.evaluate((ms) => { window.__gbClock += ms; }, stepMs);
    await nextFrame();
    await target.screenshot({ path: join(dir, `frame_${String(i).padStart(4, '0')}.png`) });
    if (i % 12 === 0) process.stdout.write(`\r${name}: frame ${i + 1}/${frames}`);
  }
  process.stdout.write('\n');

  const ff = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps), '-i', join(dir, 'frame_%04d.png'),
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(flags.quality ?? 78), '-compression_level', '6', '-loop', '0',
    outFile,
  ], { stdio: 'inherit' });
  rmSync(dir, { recursive: true, force: true });
  if (ff.status !== 0) throw new Error('ffmpeg failed');
  console.log(`${name}: ${frames} frames @ ${fps}fps -> ${outFile}`);
}
