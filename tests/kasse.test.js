/* Playwright-Test: node tests/kasse.test.js  (startet selbst einen kleinen Webserver) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fails++; };
const euro = s => s.replace(/\s/g, ' ');

async function device(browser, url, name, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => { console.log('FAIL Seitenfehler: ' + e.message); fails++; });
  await page.goto(url);
  await page.click('[data-tab=einstellungen]');
  await page.fill('#devName', name);
  await page.press('#devName', 'Tab');
  await page.click('[data-tab=kasse]');
  return { ctx, page };
}
const tapProd = (page, name) => page.click(`.prod:has-text("${name}")`);
const shot = (page, name) => process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null;
const sum = page => page.textContent('#sum').then(euro);

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  /* Gerät 1: Handy */
  const d1 = await device(browser, url, 'Kasse 1', { width: 390, height: 844 });
  const p1 = d1.page;
  ok((await p1.$$('.prod')).length === 7, '7 Produkte aus der Karte');

  await tapProd(p1, 'Pulled Pork Semmel');
  await tapProd(p1, 'Pulled Pork Semmel');
  await tapProd(p1, 'Kürbis-Curry');
  ok(await sum(p1) === '23,25 €', 'Summe 2× Pulled Pork + Suppe mit Becherpfand = 23,25 € (' + await sum(p1) + ')');
  await p1.click('[data-act=minus]');
  ok(await sum(p1) === '14,25 €', 'Minus nimmt eine Semmel weg');
  await tapProd(p1, 'Pulled Pork Semmel');

  await p1.click('[data-act=pay]');
  await p1.click('[data-act=give][data-c="2000"]');
  ok((await p1.textContent('.change')).includes('Es fehlen noch'), 'Zu wenig gegeben wird angezeigt');
  ok(await p1.isDisabled('[data-act=finish]'), 'Fertig gesperrt, solange Geld fehlt');
  await p1.click('[data-act=give][data-c="500"]');
  ok(euro(await p1.textContent('#changeVal')) === '1,75 €', 'Rückgeld bei 25 € = 1,75 €');
  await shot(p1, 'handy-bezahlen');
  await p1.click('[data-act=finish]');
  ok(await sum(p1) === '0,00 €', 'Nach Fertig ist der Warenkorb leer');

  await p1.click('[data-act=cupBack]');
  await p1.click('[data-act=cupBack]');
  ok(await sum(p1) === '−0,50 €', 'Zwei Becher zurück = −0,50 €');
  await p1.click('[data-act=pay]');
  ok((await p1.textContent('.sheet')).includes('Pfand auszahlen'), 'Pfand-Auszahlung');
  await p1.click('[data-act=finish]');

  await tapProd(p1, 'Große Tüte Pommes');
  await p1.click('[data-act=pay]');
  await p1.click('[data-act=exact]');
  await p1.click('[data-act=finish]');
  await p1.click('[data-act=storno]');
  ok(await p1.evaluate(() => S.day.sales.length) === 2, 'Storno entfernt den letzten Verkauf');

  await p1.click('[data-tab=abrechnung]');
  ok(euro(await p1.textContent('.kpi .main .val')) === '22,75 €', 'Eigene Kasse 22,75 €');

  /* Gerät 2: Tablet */
  const d2 = await device(browser, url, 'Kasse 2', { width: 1024, height: 768 });
  const p2 = d2.page;
  await tapProd(p2, 'Matjessemmel');
  await p2.click('[data-act=cupOut]');
  ok(await sum(p2) === '4,75 €', 'Tablet: Matjes + Becher manuell = 4,75 €');
  await p2.click('[data-act=pay]');
  await p2.click('[data-act=give][data-c="500"]');
  await p2.click('[data-act=finish]');
  await shot(p2, 'tablet-kasse');

  /* QR-Code: erzeugen und wieder lesen */
  await p2.click('[data-tab=abrechnung]');
  await p2.click('[data-act=shareReport]');
  const decoded = await p2.evaluate(async () => {
    await loadJsQR();
    const img = document.querySelector('.qr img');
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    return jsQR(d.data, d.width, d.height).data;
  });
  const report2 = JSON.parse(decoded);
  ok(report2.k === 'mk-report' && report2.name === 'Kasse 2' && report2.p[0][0] === 'Matjessemmel', 'QR-Code der Abrechnung lässt sich lesen');

  await p1.evaluate(t => handlePayload(t), decoded);
  await p1.evaluate(t => handlePayload(t), decoded);
  ok(Object.keys(await p1.evaluate(() => S.imports)).length === 1, 'Doppelt eingelesen zählt nur einmal');
  ok(euro(await p1.textContent('.kpi .main .val')) === '27,50 €', 'Gesamt aus 2 Geräten = 27,50 € (' + euro(await p1.textContent('.kpi .main .val')) + ')');
  ok((await p1.textContent('#app')).includes('Pro Gerät'), 'Aufteilung pro Gerät sichtbar');
  await p1.setViewportSize({ width: 390, height: 1400 });
  await shot(p1, 'handy-abrechnung');

  const csv = await p1.evaluate(() => csvFor('Test', allReports()));
  ok(csv.includes('Pulled Pork Semmel;9,00;2;18,00') && csv.includes('Kasse gesamt;;;27,50') && csv.includes('Kasse 2;1;;4,75'), 'CSV-Export stimmt');

  /* Umlaute im QR-Code */
  const umlaut = await p1.evaluate(() => JSON.parse(asciiJson({ a: 'Große Tüte' })).a);
  ok(umlaut === 'Große Tüte', 'Umlaute überstehen den QR-Code');

  /* Produkte übertragen */
  await p1.click('[data-tab=einstellungen]');
  const priceInput = p1.locator('input[data-edit=price]').first();
  await priceInput.fill('9,50');
  await priceInput.press('Tab');
  await p1.fill('#pfand', '0,50');
  await p1.press('#pfand', 'Tab');
  const prods = await p1.evaluate(() => asciiJson(productsPayload()));
  await p2.evaluate(t => handlePayload(t), prods);
  ok(await p2.evaluate(() => S.products[0].price === 950 && S.pfand === 50), 'Produkte und Pfand auf Gerät 2 übernommen');

  /* Tag abschließen */
  await p1.click('[data-tab=abrechnung]');
  await p1.click('[data-act=closeDay]');
  const st = await p1.evaluate(() => ({ h: S.history.length, s: S.day.sales.length, i: Object.keys(S.imports).length, cash: cash(S.history[0]) }));
  ok(st.h === 1 && st.s === 0 && st.i === 0 && st.cash === 2750, 'Tag abgeschlossen, Verlauf 27,50 €');

  /* Daten bleiben nach Neuladen */
  await p1.reload();
  ok(await p1.evaluate(() => S.history.length === 1 && S.device.name === 'Kasse 1'), 'Daten bleiben nach Neuladen');

  /* Offline */
  await p1.evaluate(() => navigator.serviceWorker.ready);
  await p1.reload();
  await d1.ctx.setOffline(true);
  await p1.reload();
  ok((await p1.$$('.prod')).length === 7, 'Läuft offline');

  await browser.close();
  server.close();
  console.log(fails ? `\n${fails} Fehler` : '\nAlle Tests bestanden');
  process.exit(fails ? 1 : 0);
})();
