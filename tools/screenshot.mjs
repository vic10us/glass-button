#!/usr/bin/env node
/**
 * Headless screenshot tool for visual tuning.
 *
 *   node tools/screenshot.mjs [scene ...] [--wait=ms] [--out=dir] [--bg=key|#hex] [--target=selector]
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
