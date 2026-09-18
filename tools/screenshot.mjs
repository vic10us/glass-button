#!/usr/bin/env node
/**
 * Headless screenshot tool for visual tuning.
 *
 *   node tools/screenshot.mjs [scene ...] [--wait=ms] [--out=dir]
 *
 * Scenes: idle, hover, press, sizes, mobile, reduced, fallback, all (default: idle).
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
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
let scenes = args.filter((a) => !a.startsWith('--'));
if (scenes.length === 0) scenes = ['idle'];
if (scenes.includes('all')) scenes = ['idle', 'hover', 'press', 'sizes', 'mobile', 'reduced', 'fallback'];
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
const base = `http://127.0.0.1:${server.address().port}/demo/index.html`;

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
  await page.waitForFunction(() => customElements.get('fire-glass-button') !== undefined);
  // The fixed tuning panel would paint over element screenshots.
  await page.addStyleTag({ content: '.panel, .panel-toggle { display: none !important; }' });

  const renderer = await page.evaluate(() => document.querySelector('fire-glass-button')?.dataset.renderer);
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
  }

  await page.waitForTimeout(wait);
  const file = join(outDir, `${scene}.png`);
  await target.screenshot({ path: file });
  console.log(`${scene}: renderer=${renderer} -> ${file}`);
  if (scene === 'press') await page.mouse.up();
  await context.close();
}

await browser.close();
server.close();
