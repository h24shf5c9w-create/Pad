/* ============================================================
   Songs
   A song is everything needed to rebuild the current state:
   pad assignments, step patterns, tempo and the encoded bytes of
   every recording the pads point at. Instruments are rebuilt on
   load rather than stored, so saved songs stay small.
   ============================================================ */
(function (LP) {
  'use strict';

  var MAX_SONG_BYTES = 32 * 1024 * 1024;

  function collectRecordings() {
    return LP.sources.recordings().map(function (s) {
      return { id: s.id, name: s.name, mime: s.mime, bytes: s.bytes };
    }).filter(function (r) { return r.bytes && r.bytes.byteLength; });
  }

  function save(name) {
    var recs = collectRecordings();
    var total = recs.reduce(function (n, r) { return n + r.bytes.byteLength; }, 0);
    if (total > MAX_SONG_BYTES) {
      return Promise.resolve({ ok: false, reason: 'too-large' });
    }
    var song = {
      id: 'song-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name: (name || 'Untitled').slice(0, 60),
      bpm: LP.sequencer.bpm,
      pads: LP.pads.serialize(),
      patterns: LP.sequencer.serialize(),
      recordings: recs.map(function (r) {
        /* Copy: decodeAudioData detaches whatever it is handed. */
        return { id: r.id, name: r.name, mime: r.mime, bytes: r.bytes.slice(0) };
      }),
      savedAt: Date.now()
    };
    return LP.storage.songSave(song).then(function (ok) {
      return { ok: !!ok, reason: ok ? null : 'write-failed', song: song };
    });
  }

  function list() {
    return LP.storage.songList().then(function (rows) {
      return rows.map(function (r) {
        return {
          id: r.id, name: r.name, bpm: r.bpm, savedAt: r.savedAt,
          recordings: (r.recordings || []).length,
          pads: (r.pads || []).filter(Boolean).length
        };
      });
    });
  }

  /* Decodes every recording before touching app state, so a failed
     load leaves the current song intact. */
  function load(id) {
    return LP.storage.songGet(id).then(function (song) {
      if (!song) return { ok: false, reason: 'missing' };
      var recs = song.recordings || [];
      return Promise.all(recs.map(function (r) {
        return LP.audio.decode(r.bytes.slice(0)).then(function (buffer) {
          return { id: r.id, name: r.name, mime: r.mime, bytes: r.bytes.slice(0), buffer: buffer };
        }, function () { return null; });
      })).then(function (decoded) {
        return { ok: true, song: song, decoded: decoded.filter(Boolean) };
      });
    }).catch(function () {
      return { ok: false, reason: 'error' };
    });
  }

  function remove(id) { return LP.storage.songDelete(id); }

  LP.songs = { save: save, list: list, load: load, remove: remove };
})(window.LP = window.LP || {});
