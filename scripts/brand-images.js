// Draws the PNG pictures that can't be SVG: the picture a shared link shows
// (images/share.png, from images/share.svg, which uses the site's own fonts)
// and the icon iPhones put on the home screen (images/icon-180.png, from
// images/icon.svg). Run after changing either SVG.
// Run with: npm run brand-images   (after `npm install` and `npx playwright install chromium`)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file));
// The fonts, inlined, so the picture looks the same whatever this computer has installed.
const FONTS = [
  ['Schibsted Grotesk', 'schibsted-grotesk-latin.woff2', '400 900'],
  ['Instrument Sans', 'instrument-sans-latin.woff2', '400 700'],
  ['Martian Mono', 'martian-mono-latin.woff2', '100 800'],
]
  .map(([family, file, weight]) => `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff2;base64,${read(`fonts/${file}`).toString('base64')}) format('woff2'); }`)
  .join('\n');

async function draw(browser, svgFile, pngFile, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><style>${FONTS} html, body { margin: 0; } svg { display: block; width: ${width}px; height: ${height}px; }</style>${read(svgFile)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(ROOT, pngFile) });
  await page.close();
  console.log(`Wrote ${pngFile}`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await draw(browser, 'images/share.svg', 'images/share.png', 1200, 630);
    await draw(browser, 'images/icon.svg', 'images/icon-180.png', 180, 180);
  } finally {
    await browser.close();
  }
})();
