// Renders every Wallet image asset (@1x/@2x/@3x) from SVG with Playwright.
// Usage: node wallet/build.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIME = '#D9FF43', LIME_DK = '#C6EC2E', INK = '#0E0F0A', FONT = "'Inter Display', Inter, Helvetica, Arial, sans-serif";

const logo = (fg) => (w = 160, h = 50) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 160 50">
  <text x="0" y="33" font-family="${FONT}" font-weight="800" font-size="23" letter-spacing="-0.6"
        textLength="150" lengthAdjust="spacingAndGlyphs" fill="${fg}">
    <tspan>deya</tspan><tspan fill-opacity="0.55">deya</tspan><tspan fill-opacity="0.28">deya</tspan>
  </text>
</svg>`;

const icon = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" viewBox="0 0 29 29">
  <rect width="29" height="29" fill="${LIME}"/>
  <text x="14.5" y="21.5" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="22" fill="${INK}">d</text>
</svg>`;

const thumb = (bg, fg) => () => `
<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90">
  <rect width="90" height="90" rx="20" fill="${bg}"/>
  <text x="41" y="68" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="66" fill="${fg}">d</text>
  <text x="70" y="34" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="20" fill="${fg}">3</text>
</svg>`;

// Loyalty strip: 10 stamps, 6 earned. Left side stays clear for the points field Wallet draws on top.
const loyaltyStrip = () => {
  let dots = '';
  for (let i = 0; i < 10; i++) {
    const cx = 196 + (i % 5) * 36, cy = 40 + Math.floor(i / 5) * 42, on = i < 6;
    dots += on
      ? `<circle cx="${cx}" cy="${cy}" r="15" fill="${INK}"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="17" fill="${LIME}">d</text>`
      : `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="3 3" opacity="0.55"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="123" viewBox="0 0 375 123">
    <rect width="375" height="123" fill="${LIME_DK}"/>${dots}</svg>`;
};

// Event strip: the name repeated in rows, outlined, so the event title Wallet overlays stays readable.
const eventStrip = () => {
  let rows = '';
  for (let r = 0; r < 4; r++) {
    rows += `<text x="${-40 + (r % 2) * -58}" y="${30 + r * 30}" font-family="${FONT}" font-weight="900" font-size="38"
      letter-spacing="-1.5" fill="none" stroke="${LIME}" stroke-width="1" opacity="${[0.32, 0.2, 0.13, 0.08][r]}">deyadeyadeyadeyadeyadeya</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="98" viewBox="0 0 375 98">
    <rect width="375" height="98" fill="${INK}"/>${rows}</svg>`;
};

const PASSES = {
  membership: { logo: logo('#FFFFFF'), icon, thumbnail: thumb(LIME, INK) },
  loyalty:    { logo: logo(INK), icon, strip: loyaltyStrip },
  event:      { logo: logo(LIME), icon, strip: eventStrip },
  contact:    { logo: logo(INK), icon, thumbnail: thumb(INK, LIME) },
};
const TRANSPARENT = new Set(['logo', 'thumbnail']);

(async () => {
  const browser = await chromium.launch();
  for (const [pass, assets] of Object.entries(PASSES)) {
    const dir = path.join(__dirname, 'passes', `${pass}.pass`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, svgFn] of Object.entries(assets)) {
      const svg = svgFn();
      const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
      for (const scale of [1, 2, 3]) {
        const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: scale });
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(dir, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
        await page.screenshot({ path: file, omitBackground: TRANSPARENT.has(name), clip: { x: 0, y: 0, width: +w, height: +h } });
        await page.close();
      }
    }
  }
  await browser.close();
  console.log('done');
})();
