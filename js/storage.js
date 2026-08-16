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
  var MAX_AUDIO_BYTES = 24 * 1024 * 1024;

  var dbPromise = null;
  var saveTimer = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req;
      try { req = window.indexedDB.open(DB_NAME, 1); }
      catch (e) { resolve(null); return; }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, store;
        try {
          tx = db.transaction(STORE, mode);
          store = tx.objectStore(STORE);
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
    return Promise.all([get('audio'), get('session')]).then(function (rows) {
      return { audio: rows[0] || null, session: rows[1] || null };
    }).catch(function () { return { audio: null, session: null }; });
  }

  function saveAudio(bytes, mime) {
    if (!bytes || bytes.byteLength > MAX_AUDIO_BYTES) return Promise.resolve(false);
    return put('audio', { bytes: bytes, mime: mime, savedAt: Date.now() })
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
    return Promise.all([del('audio'), del('session')]).catch(function () {});
  }

  LP.storage = {
    load: load,
    saveAudio: saveAudio,
    saveSession: saveSession,
    clear: clear,
    available: !!window.indexedDB
  };
})(window.LP = window.LP || {});
