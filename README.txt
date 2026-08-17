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
             Lautstaerke einstellen, Preview hoeren und
             "Save to pad" druecken.

LAUTSTAERKE
- Jedes Pad hat einen eigenen Regler von 0 bis 100 Prozent.
- Neue Pads starten bei 30 Prozent. Das ist der unverstaerkte
  Originalpegel der Aufnahme, damit der Regler nach oben Luft hat.
- Nach oben geht es bis 100 Prozent = zehnfache Lautstaerke
  (+20 dB). Das reicht aus, um sehr leise Handyaufnahmen auf
  volle Lautstaerke zu bringen.

      Regler    Verstaerkung
        0 %     stumm
       30 %     1.0x   (Standard, Originalpegel)
       50 %     1.9x
       70 %     3.7x
      100 %     10.0x  (+20 dB)

- 0 Prozent schaltet das Pad stumm; es wird dann als "muted"
  angezeigt.
- Bei einem bereits belegten Pad wirkt der Regler sofort, ohne
  erneutes Speichern.
- Ein sanfter Begrenzer verhindert hartes Uebersteuern, falls
  die Aufnahme schon laut war.

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
  Die App schaltet zusaetzlich selbst auf die Playback-Audiosession
  um und baut den AudioContext nach jeder Aufnahme neu auf, damit
  der Ton auf dem Lautsprecher landet und nicht im Hoerermuschel-
  Ausgang haengen bleibt.

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
