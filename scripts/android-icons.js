/* Erzeugt Android-Icons und Startbilder aus icon.svg (braucht Playwright): node scripts/android-icons.js */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), res = path.join(root, 'android/app/src/main/res');
const svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<rect width="512" height="512"[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
const BG = '#fdf3e3';
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/* Inhalt (ohne Hintergrund) mittig in ein Feld zeichnen; scale = Anteil der 512er-Fläche am Feld */
const art = (w, h, scale, bg, clip) => {
  const s = Math.min(w, h) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${clip ? `<clipPath id="c">${clip}</clipPath><g clip-path="url(#c)">` : '<g>'}
    ${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}
    <g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${inner}</g></g></svg>`;
};

(async () => {
  const b = await chromium.launch();
  const shot = async (file, w, h, html) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: true });
    await p.close();
  };
  for (const [d, k] of Object.entries(DENS)) {
    const L = Math.round(48 * k), F = Math.round(108 * k);
    await shot(`${res}/mipmap-${d}/ic_launcher.png`, L, L, art(L, L, 1, BG, `<rect width="${L}" height="${L}" rx="${L * 0.22}"/>`));
    await shot(`${res}/mipmap-${d}/ic_launcher_round.png`, L, L, art(L, L, 1, BG, `<circle cx="${L / 2}" cy="${L / 2}" r="${L / 2}"/>`));
    await shot(`${res}/mipmap-${d}/ic_launcher_foreground.png`, F, F, art(F, F, 80 / 108, null));
  }
  const splashes = fs.readdirSync(res).filter(n => n.startsWith('drawable')).map(n => path.join(res, n, 'splash.png')).filter(f => fs.existsSync(f));
  for (const f of splashes) {
    const out = require('child_process').execFileSync('file', [f]).toString();
    const [, w, h] = out.match(/(\d+) x (\d+)/).map(Number);
    await shot(f, w, h, art(w, h, 0.55, BG));
  }
  await b.close();
  console.log('Icons und Startbilder erzeugt');
})();
