// Renders public/logo.svg to the PNG sizes used by Google sign-in branding
// (120x120) and by phones when the site is added to a home screen.
import { readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const chromePath = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
].find((p) => p && existsSync(p));
if (!chromePath) throw new Error('Set CHROME_PATH to a Chrome or Chromium executable.');

const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');
// The game's display font, so the logo matches the site.
const font = readFileSync(
  new URL('../node_modules/@fontsource/dela-gothic-one/files/dela-gothic-one-latin-400-normal.woff2', import.meta.url),
).toString('base64');
const browser = await puppeteer.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
try {
  for (const size of [120, 192, 512]) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>@font-face{font-family:'Dela Gothic One';src:url(data:font/woff2;base64,${font}) format('woff2')}
       html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}
       svg text{font-family:'Dela Gothic One',sans-serif!important}</style>${svg}`,
    );
    await page.evaluate(() => document.fonts.ready);
    const out = new URL(`../public/logo-${size}.png`, import.meta.url).pathname;
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`Wrote public/logo-${size}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
