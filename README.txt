PADLAB - 16 Pad Mic Sampler
===========================

DEPLOYMENT (GoDaddy cPanel)
---------------------------
1. Bei GoDaddy cPanel anmelden.
2. File Manager oeffnen.
3. public_html oeffnen.
4. website.zip hochladen.
5. ZIP entpacken.
6. Sicherstellen, dass index.html direkt in public_html liegt.
7. Domain ueber HTTPS oeffnen.
8. Mikrofonzugriff erlauben.

Fertig. Es wird kein Node.js, kein npm, keine Datenbank,
kein Backend und kein PHP benoetigt.


BEDIENUNG
---------
Record  - Aufnahme starten (laeuft unbegrenzt bis Stop).
Stop    - Aufnahme beenden, Waveform erscheint.
New     - Aufnahme und alle 16 Pads loeschen (mit Rueckfrage).

PLAY       - Pad antippen spielt das Sample sofort ab.
CUSTOMIZE  - Pad antippen waehlt es aus. Danach das
             markierte Fenster ueber die Waveform ziehen,
             Laenge waehlen (0.1 / 0.2 / 0.5 / 1 / 2 / 3 / 4 / 5 s),
             Preview hoeren und "Save to pad" druecken.

Am Desktop spielen die Tasten 1 2 3 4 / Q W E R / A S D F / Z X C V
die 16 Pads.


HINWEISE
--------
- HTTPS ist Pflicht. Ohne sicheren Kontext gibt der Browser
  das Mikrofon nicht frei; die App zeigt dann einen Hinweis.
- Die Aufnahme bleibt vollstaendig auf dem Geraet. Es wird
  nichts hochgeladen, es gibt kein Tracking und keine Analytics.
- Aufnahme und Pad-Belegung werden lokal im Browser
  (IndexedDB) gesichert und beim naechsten Besuch wieder
  geladen. Geht das verloren, startet die App einfach leer.


DATEIEN
-------
index.html               Einstiegsseite
css/style.css            Gesamtes Styling
js/audio-engine.js       AudioContext, Wiedergabe, Decoding
js/recorder.js           Mikrofonaufnahme (MediaRecorder + Fallback)
js/waveform.js           Peak-Berechnung und Canvas-Rendering
js/storage.js            Lokale Sicherung (IndexedDB)
js/ui.js                 UI-Zustaende, Statuszeile, Dialog
js/pads.js               16 Pads, Trigger, Tastatur
js/editor.js             Auswahlfenster, Preview, Save to pad
js/app.js                Verdrahtung und Ablaeufe
assets/                  Icons
manifest.webmanifest     Web-App-Manifest
