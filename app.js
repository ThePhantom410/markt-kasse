'use strict';
/* Markt-Kasse – Rechenhilfe für den Marktstand. Alle Beträge in Cent. */

const APP_VERSION = 1;
const KEY = 'marktKasse.v1';
const COLORS = ['#1f6f8b', '#c0392b', '#d35400', '#b9770e', '#1e8449', '#117a65', '#6c3483', '#2c3e50', '#a93226', '#7d6608'];
const MONEY = [500, 1000, 2000, 5000, 100, 200, 50, 20];

const DEFAULT_PRODUCTS = [
  ['Pulled Pork Semmel', 900, 0, false],
  ['Kürbis-Curry-Cremesuppe', 500, 3, true],
  ['Ofenkartoffel vegetarisch', 700, 4, false],
  ['Ofenkartoffel mit Pulled Pork', 1100, 8, false],
  ['Matjessemmel', 450, 5, false],
  ['Räucher-Lachssemmel', 450, 2, false],
  ['Große Tüte Pommes', 400, 7, false],
];

/* ---------- Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const euro = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const euroPlain = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateDe = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
/* "4,50" / "4.5" / "4" → 450; ungültig → null */
function parseEuro(s) {
  const t = String(s).trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
/* JSON nur mit ASCII-Zeichen, damit QR-Codes überall gleich gelesen werden */
const asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Zustand ---------- */
function fresh() {
  return {
    v: 1,
    device: { id: rid(), name: '' },
    pfand: 25,
    products: DEFAULT_PRODUCTS.map(([name, price, color, cup]) => ({ id: rid(), name, price, color: COLORS[color], cup, hidden: false })),
    day: { date: today(), sales: [] },
    imports: {},
    history: [],
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return s;
  } catch (e) { /* kaputt oder leer → neu */ }
  return fresh();
}
const S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen!'); }
}

/* Laufender Verkauf (nicht gespeichert, bis "Fertig") */
let cart = { items: {}, cupsOut: 0, cupsBack: 0 };
let given = 0;
let tab = 'kasse';

const prod = id => S.products.find(p => p.id === id);
const visibleProducts = () => S.products.filter(p => !p.hidden);
function cartTotal(c = cart) {
  let t = 0;
  for (const [id, q] of Object.entries(c.items)) { const p = prod(id); if (p) t += p.price * q; }
  return t + (c.cupsOut - c.cupsBack) * S.pfand;
}
const cartEmpty = () => !Object.keys(cart.items).length && !cart.cupsOut && !cart.cupsBack;

function addProduct(id) {
  const p = prod(id); if (!p) return;
  cart.items[id] = (cart.items[id] || 0) + 1;
  if (p.cup) cart.cupsOut++;
  render();
}
function removeProduct(id) {
  const p = prod(id); if (!cart.items[id]) return;
  if (--cart.items[id] <= 0) delete cart.items[id];
  if (p && p.cup && cart.cupsOut > 0) cart.cupsOut--;
  render();
}
function clearCart() { cart = { items: {}, cupsOut: 0, cupsBack: 0 }; given = 0; }

function finishSale() {
  const total = cartTotal();
  const items = Object.entries(cart.items).map(([id, q]) => { const p = prod(id); return [id, p.name, p.price, q]; });
  S.day.sales.push({ id: rid(), t: Date.now(), items, cupsOut: cart.cupsOut, cupsBack: cart.cupsBack, pfand: S.pfand, total, given });
  save();
  clearCart();
  closeSheet();
  toast(total >= 0 ? `Verkauf gespeichert: ${euro(total)}` : `Ausgezahlt: ${euro(-total)}`);
  render();
}
function stornoLast() {
  const last = S.day.sales[S.day.sales.length - 1];
  if (!last) return;
  const what = last.items.map(i => `${i[3]}× ${i[1]}`).concat(last.cupsOut ? [`${last.cupsOut}× Becher`] : [], last.cupsBack ? [`${last.cupsBack}× Becher zurück`] : []).join(', ');
  if (!confirm(`Letzten Verkauf stornieren?\n\n${what}\nBetrag: ${euro(last.total)}`)) return;
  S.day.sales.pop();
  save();
  toast('Letzter Verkauf storniert');
  render();
}

/* ---------- Abrechnung ---------- */
/* Eigene Abrechnung des Geräts im Austauschformat */
function ownReport() {
  const map = new Map();
  let co = 0, cb = 0, pfo = 0, pfb = 0;
  for (const s of S.day.sales) {
    for (const [, name, price, q] of s.items) {
      const k = name + '|' + price;
      const e = map.get(k) || [name, price, 0];
      e[2] += q; map.set(k, e);
    }
    co += s.cupsOut; cb += s.cupsBack;
    pfo += s.cupsOut * s.pfand; pfb += s.cupsBack * s.pfand;
  }
  return { k: 'mk-report', v: 1, dev: S.device.id, name: S.device.name || 'Kasse', date: S.day.date, n: S.day.sales.length, p: [...map.values()], co, cb, pfo, pfb, at: Date.now() };
}
function validReport(r) {
  return r && r.k === 'mk-report' && r.v === 1 && typeof r.dev === 'string' && Array.isArray(r.p) &&
    r.p.every(e => Array.isArray(e) && typeof e[0] === 'string' && Number.isInteger(e[1]) && Number.isInteger(e[2])) &&
    ['n', 'co', 'cb', 'pfo', 'pfb'].every(f => Number.isInteger(r[f]));
}
const goods = r => r.p.reduce((s, e) => s + e[1] * e[2], 0);
const cash = r => goods(r) + r.pfo - r.pfb;
function allReports() {
  const own = ownReport();
  const others = Object.values(S.imports).filter(r => r.dev !== S.device.id);
  return [own, ...others];
}
function mergeReports(list) {
  const map = new Map();
  const sum = { n: 0, co: 0, cb: 0, pfo: 0, pfb: 0 };
  for (const r of list) {
    for (const [name, price, q] of r.p) {
      const k = name + '|' + price;
      const e = map.get(k) || [name, price, 0];
      e[2] += q; map.set(k, e);
    }
    for (const f of Object.keys(sum)) sum[f] += r[f];
  }
  const p = [...map.values()].sort((a, b) => b[1] * b[2] - a[1] * a[2]);
  return { ...sum, p };
}
function importReport(r) {
  if (r.dev === S.device.id) { toast('Das ist die Abrechnung von diesem Gerät selbst'); return; }
  const old = S.imports[r.dev];
  S.imports[r.dev] = r;
  save();
  const warn = r.date !== S.day.date ? ` (Achtung: Tag ${dateDe(r.date)})` : '';
  toast(`${old ? 'Aktualisiert' : 'Eingelesen'}: ${r.name}${warn}`);
  render();
}
function closeDay() {
  const list = allReports();
  const m = mergeReports(list);
  if (!m.n && !Object.keys(S.imports).length) { toast('Heute gibt es noch nichts abzuschließen'); return; }
  const missing = Object.keys(S.imports).length ? '' : '\n\nHinweis: Es sind keine anderen Geräte eingelesen.';
  if (!confirm(`Tag ${dateDe(S.day.date)} abschließen?\n\nKasse gesamt: ${euro(cash(m))}\nDanach starten Verkäufe und eingelesene Geräte wieder bei null.${missing}`)) return;
  S.history.unshift({ date: S.day.date, devices: list.map(r => ({ name: r.name, n: r.n, cash: cash(r) })), ...m, at: Date.now() });
  S.history = S.history.slice(0, 60);
  S.day = { date: today(), sales: [] };
  S.imports = {};
  save();
  toast('Tag abgeschlossen');
  render();
}
function csvFor(title, list) {
  const m = mergeReports(list);
  const rows = [[title], [], ['Produkt', 'Preis', 'Stück', 'Summe']];
  for (const [name, price, q] of m.p) rows.push([name, euroPlain(price), q, euroPlain(price * q)]);
  rows.push([], ['Waren gesamt', '', '', euroPlain(goods(m))]);
  rows.push(['Becher ausgegeben', '', m.co, euroPlain(m.pfo)]);
  rows.push(['Becher zurück', '', m.cb, euroPlain(-m.pfb)]);
  rows.push(['Pfand-Saldo', '', '', euroPlain(m.pfo - m.pfb)]);
  rows.push(['Kasse gesamt', '', '', euroPlain(cash(m))]);
  rows.push(['Verkäufe', '', m.n, '']);
  if (list.length > 1) {
    rows.push([], ['Gerät', 'Verkäufe', '', 'Kasse']);
    for (const r of list) rows.push([r.name, r.n, '', euroPlain(cash(r))]);
  }
  return '﻿' + rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
}

/* ---------- Teilen und Einlesen ---------- */
function productsPayload() {
  return { k: 'mk-products', v: 1, pf: S.pfand, p: S.products.map(p => [p.name, p.price, COLORS.indexOf(p.color), p.cup ? 1 : 0, p.hidden ? 1 : 0, p.id]) };
}
function validProducts(o) {
  return o && o.k === 'mk-products' && o.v === 1 && Number.isInteger(o.pf) && Array.isArray(o.p) &&
    o.p.every(e => Array.isArray(e) && typeof e[0] === 'string' && Number.isInteger(e[1]) && e[1] >= 0);
}
function importProducts(o) {
  if (!confirm(`Produkte übernehmen?\n\n${o.p.length} Produkte und Becherpfand ${euro(o.pf)} ersetzen die Liste auf diesem Gerät.`)) return;
  S.pfand = o.pf;
  S.products = o.p.map(([name, price, color, cup, hidden, id]) => ({
    id: typeof id === 'string' && id ? id : rid(), name: name.slice(0, 60), price,
    color: COLORS[color] || COLORS[0], cup: !!cup, hidden: !!hidden,
  }));
  clearCart();
  save();
  toast('Produkte übernommen');
  render();
}
function handlePayload(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { toast('Das ist kein Markt-Kasse-Code'); return false; }
  if (validReport(o)) { importReport(o); return true; }
  if (validProducts(o)) { importProducts(o); return true; }
  toast('Das ist kein Markt-Kasse-Code');
  return false;
}
function qrImage(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createDataURL(6, 2);
}
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json,text/plain';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 200000) { toast('Datei zu groß'); return; }
    handlePayload(await f.text());
  };
  inp.click();
}

/* Scanner: BarcodeDetector, sonst jsQR (wird erst bei Bedarf geladen) */
let scanStop = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js'; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function startScan() {
  openSheet(`<h3>QR-Code scannen</h3>
    <div class="scan stack"><video id="scanVideo" playsinline muted></video>
    <p class="muted small">Halte die Kamera auf den QR-Code des anderen Geräts.</p>
    <button class="btn big" data-act="close">Abbrechen</button></div>`);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    closeSheet();
    toast('Kamera nicht verfügbar – nimm „Datei einlesen“');
    return;
  }
  const video = $('#scanVideo');
  if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  let stopped = false, detector = null;
  scanStop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); scanStop = null; };
  if ('BarcodeDetector' in window) {
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
  }
  if (!detector) { try { await loadJsQR(); } catch (e) { scanStop(); closeSheet(); toast('Scanner konnte nicht geladen werden'); return; } }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (stopped) return;
    let text = null;
    try {
      if (video.readyState >= 2) {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else {
          const w = video.videoWidth, h = video.videoHeight;
          const k = Math.min(1, 800 / Math.max(w, h));
          canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (r) text = r.data;
        }
      }
    } catch (e) { /* nächster Versuch */ }
    if (text) {
      scanStop(); closeSheet();
      handlePayload(text);
      return;
    }
    setTimeout(tick, 200);
  };
  tick();
}

/* ---------- Sheet ---------- */
function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet">${html}</div>`;
  s.hidden = false;
}
function closeSheet() {
  if (scanStop) scanStop();
  const s = $('#sheet');
  s.hidden = true; s.innerHTML = '';
  sheetKind = null;
}
let sheetKind = null;

function renderPay() {
  const total = cartTotal();
  sheetKind = 'pay';
  if (total <= 0) {
    openSheet(`<h3>${total < 0 ? 'Pfand auszahlen' : 'Abschließen'}</h3>
      <div class="change"><div class="label">${total < 0 ? 'Auszahlen' : 'Betrag'}</div><div class="val num">${euro(Math.abs(total))}</div></div>
      <div class="row"><button class="btn grow" data-act="close">Zurück</button><button class="btn ok grow big" data-act="finish">Fertig</button></div>`);
    return;
  }
  const diff = given - total;
  const changeBox = given === 0
    ? `<div class="change"><div class="label">Rückgeld</div><div class="val num">–</div></div>`
    : diff >= 0
      ? `<div class="change"><div class="label">Rückgeld</div><div class="val num" id="changeVal">${euro(diff)}</div></div>`
      : `<div class="change short"><div class="label">Es fehlen noch</div><div class="val num">${euro(-diff)}</div></div>`;
  openSheet(`<h3>Bezahlen</h3>
    <div class="pay-head">
      <div class="box"><div class="label">Zu zahlen</div><div class="val num" id="payTotal">${euro(total)}</div></div>
      <div class="box"><div class="label">Gegeben</div><div class="val num" id="payGiven">${euro(given)}</div></div>
    </div>
    ${changeBox}
    <div class="money">
      ${MONEY.map(c => `<button class="btn" data-act="give" data-c="${c}">${c >= 100 ? c / 100 + '&nbsp;€' : c + '&nbsp;ct'}</button>`).join('')}
    </div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn grow" data-act="exact">Passend</button>
      <button class="btn grow" data-act="type">Betrag eintippen</button>
      <button class="btn danger" data-act="give0">C</button>
    </div>
    <div class="row">
      <button class="btn grow" data-act="close">Zurück</button>
      <button class="btn ok grow big" data-act="finish" ${given > 0 && diff < 0 ? 'disabled' : ''}>Fertig</button>
    </div>
    <p class="muted small" style="margin-top:10px">Tippe die Scheine und Münzen an, die du bekommst – sie werden zusammengezählt. Ohne Eingabe wird der Verkauf mit „Fertig“ trotzdem gespeichert.</p>`);
}

/* ---------- Seiten ---------- */
function viewKasse() {
  const total = cartTotal();
  const prods = visibleProducts();
  const last = S.day.sales[S.day.sales.length - 1];
  const lines = Object.entries(cart.items).map(([id, q]) => {
    const p = prod(id);
    return `<div class="cart-line"><span class="q num">${q}×</span><span class="n">${esc(p.name)}</span><span class="num">${euro(p.price * q)}</span><button class="minus" data-act="minus" data-id="${id}" aria-label="Eins weniger">−</button></div>`;
  });
  if (cart.cupsOut) lines.push(`<div class="cart-line"><span class="q num">${cart.cupsOut}×</span><span class="n">Becherpfand</span><span class="num">${euro(cart.cupsOut * S.pfand)}</span><button class="minus" data-act="cupOutMinus" aria-label="Eins weniger">−</button></div>`);
  if (cart.cupsBack) lines.push(`<div class="cart-line"><span class="q num">${cart.cupsBack}×</span><span class="n">Becher zurück</span><span class="num">${euro(-cart.cupsBack * S.pfand)}</span><button class="minus" data-act="cupBackMinus" aria-label="Eins weniger">−</button></div>`);
  const notToday = S.day.date !== today() && S.day.sales.length
    ? `<div class="note">Der Tag ${dateDe(S.day.date)} ist noch nicht abgeschlossen. Unter <b>Abrechnung</b> abschließen, bevor du heute verkaufst.</div>` : '';
  const setup = !S.device.name
    ? `<div class="note">Gib diesem Gerät unter <b>Einstellungen</b> einen Namen (z. B. „Kasse 1“), damit die Abrechnungen später zuordenbar sind.</div>` : '';
  return `${notToday}${setup}<div class="kasse">
    <div>
      <div class="products">
        ${prods.map(p => `<button class="prod" style="background:${p.color}" data-act="add" data-id="${p.id}">
          ${cart.items[p.id] ? `<span class="badge">${cart.items[p.id]}</span>` : ''}
          <span class="name">${esc(p.name)}</span>
          <span><span class="price num">${euro(p.price)}</span>${p.cup ? `<br><span class="cup">+ Becherpfand</span>` : ''}</span>
        </button>`).join('') || '<div class="empty">Keine Produkte – unter Einstellungen anlegen.</div>'}
      </div>
      <div class="pfand-row">
        <button class="btn" data-act="cupOut">🥤 Becher + ${euro(S.pfand)}</button>
        <button class="btn" data-act="cupBack">↩️ Becher zurück − ${euro(S.pfand)}</button>
      </div>
    </div>
    <div class="side">
      <div class="total-bar"><div><div class="muted small">Summe</div><div class="sum num ${total < 0 ? 'neg' : ''}" id="sum">${total < 0 ? '−' + euro(-total) : euro(total)}</div></div>
        <button class="btn danger" data-act="clear" ${cartEmpty() ? 'disabled' : ''}>Leeren</button></div>
      <div class="card" style="margin-top:10px">${lines.join('') || '<div class="empty">Produkte antippen</div>'}</div>
      <button class="btn primary big" data-act="pay" ${cartEmpty() ? 'disabled' : ''}>${total < 0 ? 'Pfand auszahlen' : 'Bezahlen'}</button>
      <div class="row" style="margin-top:10px">
        <span class="muted small grow">${S.day.sales.length} ${S.day.sales.length === 1 ? 'Verkauf' : 'Verkäufe'} heute${last ? ` · zuletzt ${euro(last.total)}` : ''}</span>
        <button class="btn small" data-act="storno" ${last ? '' : 'disabled'}>↶ Storno</button>
      </div>
    </div>
  </div>`;
}

function reportTable(list) {
  const m = mergeReports(list);
  return `<div class="kpi">
      <div class="box main"><div class="label">Kasse gesamt</div><div class="val num">${euro(cash(m))}</div></div>
      <div class="box"><div class="label">Waren</div><div class="val num">${euro(goods(m))}</div></div>
      <div class="box"><div class="label">Pfand-Saldo</div><div class="val num">${euro(m.pfo - m.pfb)}</div></div>
      <div class="box"><div class="label">Verkäufe</div><div class="val num">${m.n}</div></div>
    </div>
    <table>
      <tr><th>Produkt</th><th class="r">Stück</th><th class="r">Summe</th></tr>
      ${m.p.map(([name, price, q]) => `<tr><td>${esc(name)}<div class="muted small">${euro(price)}</div></td><td class="r">${q}</td><td class="r">${euro(price * q)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Noch nichts verkauft</td></tr>'}
      <tr><td>Becher ausgegeben</td><td class="r">${m.co}</td><td class="r">${euro(m.pfo)}</td></tr>
      <tr><td>Becher zurück</td><td class="r">${m.cb}</td><td class="r">${euro(-m.pfb)}</td></tr>
      <tr class="sum"><td>Kasse gesamt</td><td></td><td class="r">${euro(cash(m))}</td></tr>
    </table>`;
}

function viewAbrechnung() {
  const own = ownReport();
  const others = Object.values(S.imports).filter(r => r.dev !== S.device.id);
  const list = [own, ...others];
  const wrongDay = others.filter(r => r.date !== S.day.date);
  return `<h2>Gesamt ${dateDe(S.day.date)}${others.length ? ` · ${list.length} Geräte` : ''}</h2>
    <div class="card">
      ${wrongDay.length ? `<div class="note">Achtung: ${wrongDay.map(r => esc(r.name) + ' (' + dateDe(r.date) + ')').join(', ')} ist von einem anderen Tag.</div>` : ''}
      ${reportTable(list)}
      ${list.length > 1 ? `<h2>Pro Gerät</h2><table>
        <tr><th>Gerät</th><th class="r">Verkäufe</th><th class="r">Kasse</th><th></th></tr>
        ${list.map(r => `<tr><td>${esc(r.name)}${r.dev === S.device.id ? ' <span class="muted small">(dieses)</span>' : `<div class="muted small">eingelesen ${new Date(r.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>`}</td>
          <td class="r">${r.n}</td><td class="r">${euro(cash(r))}</td>
          <td class="r">${r.dev === S.device.id ? '' : `<button class="chip" data-act="dropImport" data-dev="${esc(r.dev)}">Entfernen</button>`}</td></tr>`).join('')}
      </table>` : ''}
    </div>

    <h2>Mehrere Geräte zusammenführen</h2>
    <div class="card stack">
      <p class="muted small" style="margin:0">Auf jedem anderen Gerät „Meine Abrechnung teilen“ tippen und hier scannen. Wird ein Gerät nochmal eingelesen, ersetzt das die alte Abrechnung – nichts wird doppelt gezählt.</p>
      <div class="row">
        <button class="btn primary grow" data-act="scan">📷 Abrechnung scannen</button>
        <button class="btn grow" data-act="file">📄 Datei einlesen</button>
      </div>
      <div class="row">
        <button class="btn grow" data-act="shareReport">🔳 Meine Abrechnung teilen</button>
        <button class="btn grow" data-act="fileReport">📤 Als Datei senden</button>
      </div>
    </div>

    <h2>Tag</h2>
    <div class="card stack">
      <div class="row">
        <button class="btn grow" data-act="csv">CSV exportieren</button>
        <button class="btn danger grow" data-act="closeDay">Tag abschließen</button>
      </div>
      <p class="muted small" style="margin:0">„Tag abschließen“ legt die Gesamtabrechnung im Verlauf ab und startet bei null. Vorher alle Geräte einlesen.</p>
    </div>

    ${S.history.length ? `<h2>Verlauf</h2><div class="card"><table>
      <tr><th>Tag</th><th class="r">Verkäufe</th><th class="r">Kasse</th><th></th></tr>
      ${S.history.map((h, i) => `<tr><td>${dateDe(h.date)}<div class="muted small">${h.devices.length} ${h.devices.length === 1 ? 'Gerät' : 'Geräte'}</div></td><td class="r">${h.n}</td><td class="r">${euro(cash(h))}</td>
        <td class="r"><button class="chip" data-act="histCsv" data-i="${i}">CSV</button></td></tr>`).join('')}
    </table></div>` : ''}`;
}

function viewEinstellungen() {
  return `<h2>Dieses Gerät</h2>
    <div class="card">
      <label class="field"><span>Name (z. B. Kasse 1, Tablet)</span><input id="devName" value="${esc(S.device.name)}" maxlength="30" placeholder="Kasse 1"></label>
      <label class="field"><span>Becherpfand pro Becher</span><input id="pfand" inputmode="decimal" value="${euroPlain(S.pfand)}"></label>
      <label class="check"><input type="checkbox" id="wake" ${wakeWanted ? 'checked' : ''}> Bildschirm anlassen, solange die App offen ist</label>
    </div>

    <h2>Produkte</h2>
    <div class="card">
      ${S.products.map((p, i) => `<div class="prod-edit ${p.hidden ? 'off' : ''}">
        <span class="dot" style="background:${p.color}"></span>
        <input data-edit="name" data-id="${p.id}" value="${esc(p.name)}" maxlength="60" aria-label="Name">
        <input data-edit="price" data-id="${p.id}" value="${euroPlain(p.price)}" inputmode="decimal" aria-label="Preis" class="right">
        <div class="opts">
          <div class="colors">${COLORS.map(c => `<button class="${c === p.color ? 'on' : ''}" style="background:${c}" data-act="color" data-id="${p.id}" data-c="${c}" aria-label="Farbe"></button>`).join('')}</div>
          <button class="chip ${p.cup ? 'on' : ''}" data-act="cup" data-id="${p.id}">🥤 mit Becher</button>
          <button class="chip ${p.hidden ? 'on' : ''}" data-act="hide" data-id="${p.id}">${p.hidden ? 'Ausgeblendet' : 'Ausblenden'}</button>
          <button class="chip" data-act="up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">▲</button>
          <button class="chip" data-act="down" data-id="${p.id}" ${i === S.products.length - 1 ? 'disabled' : ''} aria-label="Nach unten">▼</button>
          <button class="chip" data-act="del" data-id="${p.id}" style="color:var(--danger)">Löschen</button>
        </div>
      </div>`).join('')}
      <div class="row" style="margin-top:10px"><button class="btn primary grow" data-act="newProd">+ Neues Produkt</button></div>
      <p class="muted small">„mit Becher“ rechnet beim Antippen automatisch einen Becherpfand dazu.</p>
    </div>

    <h2>Produkte auf andere Geräte übertragen</h2>
    <div class="card stack">
      <p class="muted small" style="margin:0">Auf dem Hauptgerät „Produkte teilen“ tippen, auf den anderen Geräten „Produkte scannen“. Dann haben alle dieselben Produkte und Preise.</p>
      <div class="row">
        <button class="btn grow" data-act="shareProducts">🔳 Produkte teilen</button>
        <button class="btn primary grow" data-act="scan">📷 Produkte scannen</button>
      </div>
      <div class="row">
        <button class="btn grow" data-act="fileProducts">📤 Als Datei senden</button>
        <button class="btn grow" data-act="file">📄 Datei einlesen</button>
      </div>
    </div>

    <h2>Über</h2>
    <div class="card">
      <p style="margin-top:0"><b>Markt-Kasse</b> · Version ${APP_VERSION}</p>
      <p class="muted small">Nur eine <b>Rechenhilfe</b>, keine Registrierkasse (keine TSE). Alle Daten bleiben auf diesem Gerät. Die App funktioniert auch ohne Internet.</p>
      <button class="btn danger" data-act="reset">Alles zurücksetzen</button>
    </div>`;
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = tab === 'abrechnung' ? viewAbrechnung() : tab === 'einstellungen' ? viewEinstellungen() : viewKasse();
  $('#app').innerHTML = v;
  if (sheetKind === 'pay') renderPay();
}

/* ---------- Bildschirm anlassen ---------- */
let wakeWanted = localStorage.getItem('marktKasse.wake') === '1';
let wakeLock = null;
async function applyWake() {
  try {
    if (wakeWanted && document.visibilityState === 'visible' && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wakeWanted && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* nicht unterstützt */ }
}
document.addEventListener('visibilitychange', applyWake);

/* ---------- Ereignisse ---------- */
function moveProduct(id, d) {
  const i = S.products.findIndex(p => p.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= S.products.length) return;
  [S.products[i], S.products[j]] = [S.products[j], S.products[i]];
  save(); render();
}
function showQr(title, text, hint) {
  sheetKind = 'qr';
  let img;
  try { img = qrImage(text); } catch (e) { toast('Zu viele Daten für einen QR-Code – nimm „Als Datei senden“'); return; }
  openSheet(`<h3>${title}</h3><div class="qr"><img alt="QR-Code" src="${img}"></div>
    <p class="muted small">${hint}</p><button class="btn big" data-act="close">Schließen</button>`);
}

const actions = {
  add: el => addProduct(el.dataset.id),
  minus: el => removeProduct(el.dataset.id),
  cupOut: () => { cart.cupsOut++; render(); },
  cupBack: () => { cart.cupsBack++; render(); },
  cupOutMinus: () => { if (cart.cupsOut > 0) cart.cupsOut--; render(); },
  cupBackMinus: () => { if (cart.cupsBack > 0) cart.cupsBack--; render(); },
  clear: () => { clearCart(); render(); },
  pay: () => { given = 0; renderPay(); },
  give: el => { given += Number(el.dataset.c); renderPay(); },
  give0: () => { given = 0; renderPay(); },
  exact: () => { given = cartTotal(); renderPay(); },
  type: () => {
    const v = prompt('Gegebener Betrag in Euro', given ? euroPlain(given) : '');
    if (v === null) return;
    const c = parseEuro(v);
    if (c === null) { toast('Ungültiger Betrag'); return; }
    given = c; renderPay();
  },
  finish: () => finishSale(),
  close: () => closeSheet(),
  storno: () => stornoLast(),
  scan: () => startScan(),
  file: () => pickFile(),
  shareReport: () => {
    if (!S.device.name) { toast('Erst unter Einstellungen einen Gerätenamen eingeben'); return; }
    showQr(`Abrechnung ${esc(S.device.name)}`, asciiJson(ownReport()), 'Auf dem Hauptgerät unter Abrechnung „Abrechnung scannen“ tippen und diesen Code scannen.');
  },
  fileReport: () => {
    if (!S.device.name) { toast('Erst unter Einstellungen einen Gerätenamen eingeben'); return; }
    downloadFile(`abrechnung-${S.day.date}-${S.device.name.replace(/[^\w-]+/g, '_')}.json`, asciiJson(ownReport()), 'application/json');
  },
  shareProducts: () => showQr('Produkte teilen', asciiJson(productsPayload()), 'Auf dem anderen Gerät unter Einstellungen „Produkte scannen“ tippen.'),
  fileProducts: () => downloadFile('produkte.json', asciiJson(productsPayload()), 'application/json'),
  dropImport: el => {
    const r = S.imports[el.dataset.dev];
    if (r && confirm(`Abrechnung von ${r.name} entfernen?`)) { delete S.imports[el.dataset.dev]; save(); render(); }
  },
  csv: () => downloadFile(`abrechnung-${S.day.date}.csv`, csvFor(`Abrechnung ${dateDe(S.day.date)}`, allReports()), 'text/csv'),
  histCsv: el => {
    const h = S.history[Number(el.dataset.i)];
    if (h) downloadFile(`abrechnung-${h.date}.csv`, csvFor(`Abrechnung ${dateDe(h.date)}`, [{ ...h, name: 'Gesamt' }]), 'text/csv');
  },
  closeDay: () => closeDay(),
  color: el => { const p = prod(el.dataset.id); if (p) { p.color = el.dataset.c; save(); render(); } },
  cup: el => { const p = prod(el.dataset.id); if (p) { p.cup = !p.cup; save(); render(); } },
  hide: el => { const p = prod(el.dataset.id); if (p) { p.hidden = !p.hidden; delete cart.items[p.id]; save(); render(); } },
  up: el => moveProduct(el.dataset.id, -1),
  down: el => moveProduct(el.dataset.id, 1),
  del: el => {
    const p = prod(el.dataset.id);
    if (p && confirm(`„${p.name}“ löschen?\n\nBereits verkaufte Stück bleiben in der Abrechnung.`)) {
      S.products = S.products.filter(x => x !== p); delete cart.items[p.id]; save(); render();
    }
  },
  newProd: () => {
    S.products.push({ id: rid(), name: 'Neues Produkt', price: 0, color: COLORS[S.products.length % COLORS.length], cup: false, hidden: false });
    save(); render();
    const inputs = document.querySelectorAll('input[data-edit="name"]');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  },
  reset: () => {
    if (!confirm('Wirklich alles zurücksetzen?\n\nProdukte, Verkäufe, Abrechnungen und Verlauf werden gelöscht.')) return;
    if (!confirm('Sicher? Das kann nicht rückgängig gemacht werden.')) return;
    localStorage.removeItem(KEY);
    location.reload();
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'devName') { S.device.name = el.value.trim().slice(0, 30); save(); toast('Name gespeichert'); return; }
  if (el.id === 'pfand') {
    const c = parseEuro(el.value);
    if (c === null) { toast('Ungültiger Betrag'); el.value = euroPlain(S.pfand); return; }
    S.pfand = c; save(); toast('Becherpfand gespeichert'); el.value = euroPlain(c); return;
  }
  if (el.id === 'wake') { wakeWanted = el.checked; localStorage.setItem('marktKasse.wake', wakeWanted ? '1' : '0'); applyWake(); return; }
  if (el.dataset.edit) {
    const p = prod(el.dataset.id); if (!p) return;
    if (el.dataset.edit === 'name') {
      const v = el.value.trim().slice(0, 60);
      if (!v) { el.value = p.name; return; }
      p.name = v;
    } else {
      const c = parseEuro(el.value);
      if (c === null) { toast('Ungültiger Preis'); el.value = euroPlain(p.price); return; }
      p.price = c; el.value = euroPlain(c);
    }
    save();
  }
});

/* ---------- Start ---------- */
if (!S.day || !S.day.date) S.day = { date: today(), sales: [] };
if (S.day.date !== today() && !S.day.sales.length && !Object.keys(S.imports).length) S.day = { date: today(), sales: [] };
save();
render();
applyWake();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
