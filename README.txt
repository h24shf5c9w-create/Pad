PADLAB - 16 Pad Mic Sampler
===========================

DEPLOYMENT (GoDaddy cPanel)
---------------------------
1. Bei GoDaddy cPanel anmelden.
2. File Manager oeffnen.
3. public_html/padlab oeffnen.
4. index.html hochladen und die alte Datei ueberschreiben.
   (Oder website.zip hochladen und entpacken - enthaelt
   zusaetzlich die Icons und das Manifest.)
5. Seite ueber HTTPS oeffnen und einmal neu laden.
6. Mikrofonzugriff erlauben.

Die alten Ordner css/ und js/ auf dem Server werden nicht mehr
gebraucht und koennen geloescht werden - sie stoeren aber auch
nicht.

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
- KEIN TON AUF DEM IPHONE?
  1. Stummschalter an der linken Geraeteseite ausschalten
     (kein oranger Streifen sichtbar).
  2. Lautstaerke mit den Tasten hochdrehen, waehrend die Seite
     offen ist.
  3. Einmal auf ein Pad tippen - Safari gibt Audio erst nach der
     ersten Beruehrung frei.
  Die App setzt zusaetzlich selbst die iOS-Audiosession: waehrend
  der Aufnahme auf "play-and-record", danach zurueck auf
  "playback". So ignoriert der Ton den Stummschalter und landet
  auf dem Lautsprecher statt in der Hoermuschel.

- HTTPS ist Pflicht. Ohne sicheren Kontext gibt der Browser
  das Mikrofon nicht frei; die App zeigt dann einen Hinweis.
- Die Aufnahme bleibt vollstaendig auf dem Geraet. Es wird
  nichts hochgeladen, es gibt kein Tracking und keine Analytics.
- Aufnahme und Pad-Belegung werden lokal im Browser
  (IndexedDB) gesichert und beim naechsten Besuch wieder
  geladen. Geht das verloren, startet die App einfach leer.


DATEIEN
-------
index.html               Die komplette App - HTML, CSS und
                         JavaScript in einer einzigen Datei.
                         Laeuft auch allein, ohne alles Weitere.
assets/                  Icons (optional)
manifest.webmanifest     Web-App-Manifest (optional, fuer
                         "Zum Home-Bildschirm")
