# Markt-Kasse

Rechenhilfe-Kasse für den Marktstand: Produkte antippen, Summe und Rückgeld ablesen – kein Kopfrechnen mehr.
Läuft im Browser auf Handy und Tablet, lässt sich wie eine App installieren und funktioniert **offline**.

> Nur eine Rechenhilfe, **keine Registrierkasse** (keine TSE). Alle Daten bleiben auf dem jeweiligen Gerät.

## Funktionen
- Große Produktknöpfe mit Farbe, Zähler und „−“ zum Korrigieren
- **Becherpfand** (Standard 0,25 €): automatisch bei Produkten „mit Becher“, dazu Knöpfe „Becher +“ und „Becher zurück“; reine Becher-Rückgabe zahlt Pfand aus
- **Bezahlen nur bar:** Scheine und Münzen antippen (werden zusammengezählt), „Passend“ oder Betrag eintippen → Rückgeld groß
- Letzten Verkauf **stornieren**
- **Produkte bearbeiten:** Name, Preis, Farbe, „mit Becher“, ausblenden, Reihenfolge, löschen
- **Abrechnung:** Stück pro Produkt, Becher raus/zurück, Waren, Pfand-Saldo, Kasse gesamt, Anzahl Verkäufe; CSV-Export; Tag abschließen mit Verlauf
- **Bis zu 4 (oder mehr) Geräte, eine Abrechnung – ohne Server:**
  - Jedes Gerät bekommt einen Namen (Einstellungen).
  - Am Ende auf jedem Gerät *Abrechnung → Meine Abrechnung teilen* (QR-Code) und auf dem Hauptgerät *Abrechnung scannen*. Alternativ als Datei senden und einlesen.
  - Nochmal eingelesen ersetzt die alte Abrechnung desselben Geräts – nichts wird doppelt gezählt.
  - Produkte und Pfand überträgt das Hauptgerät per *Einstellungen → Produkte teilen* auf die anderen.
- Optional: Bildschirm bleibt an, solange die App offen ist

## Benutzen
1. Seite öffnen (GitHub Pages: `https://thephantom410.github.io/markt-kasse/`).
2. Im Browser-Menü **„Zum Startbildschirm hinzufügen“** bzw. **„App installieren“**.
3. Einmal online öffnen, danach läuft sie auch ohne Netz.
4. Unter *Einstellungen* den Gerätenamen eintragen und die Produkte prüfen.

## Technik
- Reines HTML/CSS/JavaScript ohne Build-Schritt: `index.html`, `style.css`, `app.js`, Service Worker `sw.js`
- Daten in `localStorage` (`marktKasse.v1`), Beträge intern in Cent
- QR-Codes: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) erzeugt, gelesen per `BarcodeDetector` oder [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0, `vendor/jsQR.LICENSE`)
- **Neue Version:** `APP_VERSION` in `app.js` und `CACHE` in `sw.js` zusammen hochzählen, sonst bleibt auf den Geräten die alte Version im Cache.

## Tests
```
node tests/kasse.test.js
```
Braucht Playwright mit Chromium. Der Test startet einen eigenen kleinen Webserver und prüft Verkauf, Pfand, Rückgeld, Storno, zwei Geräte mit QR-Austausch, CSV, Produkte übertragen, Tag abschließen und den Offline-Betrieb.
