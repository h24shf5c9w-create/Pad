/* ============================================================
   Persistence (best effort, never load-bearing)
   Pad assignments and the encoded recording live in IndexedDB.
   localStorage is deliberately not used for audio. Every call
   resolves even when storage is unavailable or full — the app
   must work perfectly with nothing restored.
   ============================================================ */
(function (LP) {
  'use strict';

  var DB_NAME = 'padlab';
  var STORE = 'kv';
  var SONGS = 'songs';
  var DB_VERSION = 2;
  var MAX_AUDIO_BYTES = 24 * 1024 * 1024;

  var dbPromise = null;
  var saveTimer = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { resolve(null); return; }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(SONGS)) {
          db.createObjectStore(SONGS, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function withStore(mode, fn, storeName) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, store, name = storeName || STORE;
        try {
          tx = db.transaction(name, mode);
          store = tx.objectStore(name);
        } catch (e) { resolve(null); return; }
        var result = null;
        try { result = fn(store); } catch (e) { resolve(null); return; }
        tx.oncomplete = function () {
          resolve(result && result.result !== undefined ? result.result : null);
        };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function get(key) {
    return withStore('readonly', function (store) { return store.get(key); });
  }

  function put(key, value) {
    return withStore('readwrite', function (store) { return store.put(value, key); });
  }

  function del(key) {
    return withStore('readwrite', function (store) { return store.delete(key); });
  }

  /* Resolves with { audio, session } — either may be null. */
  function load() {
    return Promise.all([get('recordings'), get('audio'), get('session')])
      .then(function (rows) {
        var recs = rows[0] && rows[0].list ? rows[0].list : null;
        /* Falls back to the single-recording key written by earlier
           versions, so an existing session is not lost on upgrade. */
        if (!recs && rows[1] && rows[1].bytes) {
          recs = [{ id: 'rec1', name: 'Recording 1', mime: rows[1].mime, bytes: rows[1].bytes }];
        }
        return { recordings: recs, session: rows[2] || null };
      })
      .catch(function () { return { recordings: null, session: null }; });
  }

  function saveRecordings(list) {
    var total = 0;
    var keep = (list || []).filter(function (r) {
      if (!r.bytes || !r.bytes.byteLength) return false;
      total += r.bytes.byteLength;
      return total <= MAX_AUDIO_BYTES;
    });
    return put('recordings', { list: keep, savedAt: Date.now() })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /* Debounced: pad edits can arrive in bursts. */
  function saveSession(data) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      put('session', { pads: data.pads, prefs: data.prefs, savedAt: Date.now() });
    }, 250);
  }

  function clear() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return Promise.all([del('audio'), del('recordings'), del('session')])
      .catch(function () {});
  }

  /* ── Songs ────────────────────────────────────────────────── */

  function songList() {
    return withStore('readonly', function (store) { return store.getAll(); }, SONGS)
      .then(function (rows) {
        if (!rows) return [];
        return rows.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      })
      .catch(function () { return []; });
  }

  function songSave(song) {
    return withStore('readwrite', function (store) { return store.put(song); }, SONGS)
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function songGet(id) {
    return withStore('readonly', function (store) { return store.get(id); }, SONGS)
      .catch(function () { return null; });
  }

  function songDelete(id) {
    return withStore('readwrite', function (store) { return store.delete(id); }, SONGS)
      .catch(function () {});
  }

  LP.storage = {
    load: load,
    songList: songList,
    songSave: songSave,
    songGet: songGet,
    songDelete: songDelete,
    saveRecordings: saveRecordings,
    saveSession: saveSession,
    clear: clear,
    available: !!window.indexedDB
  };
})(window.LP = window.LP || {});
