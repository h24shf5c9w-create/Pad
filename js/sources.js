/* ============================================================
   Sound Sources
   Everything a pad can point at: recordings made in this session
   and the built-in instruments. Pads store a source id plus a
   time range, never audio data of their own.
   ============================================================ */
(function (LP) {
  'use strict';

  var items = [];      // ordered: instruments first, then recordings
  var recCounter = 0;

  function add(source) {
    items.push(source);
    return source;
  }

  function get(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function peaksFor(source) {
    if (!source) return null;
    if (!source.peaks) source.peaks = LP.waveform.computePeaks(source.buffer);
    return source.peaks;
  }

  function addInstrument(id, name, buffer) {
    return add({ id: id, kind: 'inst', name: name, buffer: buffer,
                 duration: buffer.duration, peaks: null });
  }

  function addRecording(buffer, bytes, mime, name, id) {
    recCounter++;
    /* Loading a song must keep the ids its pads point at. */
    if (id) {
      var n = parseInt(String(id).replace(/^rec/, ''), 10);
      if (!isNaN(n) && n >= recCounter) recCounter = n;
    }
    return add({
      id: id || ('rec' + recCounter),
      kind: 'rec',
      name: name || ('Recording ' + recCounter),
      buffer: buffer,
      duration: buffer.duration,
      peaks: null,
      bytes: bytes || null,
      mime: mime || null
    });
  }

  function recordings() {
    return items.filter(function (s) { return s.kind === 'rec'; });
  }

  function instruments() {
    return items.filter(function (s) { return s.kind === 'inst'; });
  }

  /* Instruments survive a reset — only the recordings go. */
  function clearRecordings() {
    items = items.filter(function (s) { return s.kind !== 'rec'; });
    recCounter = 0;
  }

  function firstId() {
    return items.length ? items[0].id : null;
  }

  LP.sources = {
    get: get,
    peaksFor: peaksFor,
    addInstrument: addInstrument,
    addRecording: addRecording,
    recordings: recordings,
    instruments: instruments,
    clearRecordings: clearRecordings,
    firstId: firstId,
    get all() { return items.slice(); },
    get count() { return items.length; },
    set recCounter(n) { recCounter = n; }
  };
})(window.LP = window.LP || {});
