/* ============================================================
   Audio Engine
   One AudioContext for the whole app. Samples are played by
   pointing an AudioBufferSourceNode at a region of the single
   decoded recording buffer — nothing is re-decoded on trigger.
   ============================================================ */
(function (LP) {
  'use strict';

  var ctx = null;
  var master = null;
  var unlocked = false;

  /* Short ramp on both ends so slicing mid-waveform doesn't click. */
  var FADE = 0.004;

  function context() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try { ctx = new AC(); } catch (e2) { return null; }
    }
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return ctx;
  }

  /* Must run inside a user gesture on iOS: resume + start one
     silent source, which is what actually flips the context on. */
  function unlock() {
    var c = context();
    if (!c) return;
    if (c.state !== 'running' && c.resume) {
      c.resume().catch(function () {});
    }
    if (unlocked) return;
    try {
      var s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(master);
      s.start(0);
      unlocked = true;
    } catch (e) { /* retried on the next gesture */ }
  }

  /* Safari implements both the callback and promise forms; support both. */
  function decode(arrayBuffer) {
    var c = context();
    if (!c) return Promise.reject(new Error('no-audio-context'));
    return new Promise(function (resolve, reject) {
      var settled = false;
      function ok(buf) { if (!settled) { settled = true; resolve(buf); } }
      function fail(err) { if (!settled) { settled = true; reject(err || new Error('decode-failed')); } }
      var p;
      try {
        p = c.decodeAudioData(arrayBuffer, ok, fail);
      } catch (e) { fail(e); return; }
      if (p && typeof p.then === 'function') p.then(ok, fail);
    });
  }

  /* Fire and forget. Returns the source so callers (preview) can stop it. */
  function play(buffer, startTime, duration) {
    var c = ctx;
    if (!c || !buffer) return null;
    /* Never await here — a resumed-but-not-yet-running context still
       schedules correctly, and awaiting would add a frame of latency. */
    if (c.state === 'suspended' && c.resume) c.resume().catch(function () {});

    var start = Math.max(0, Math.min(startTime || 0, buffer.duration));
    var dur = Math.min(duration || 0, buffer.duration - start);
    if (!(dur > 0)) return null;

    var t = c.currentTime;
    var fade = Math.min(FADE, dur / 4);

    var src = c.createBufferSource();
    src.buffer = buffer;

    var g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.gain.setValueAtTime(1, t + dur - fade);
    g.gain.linearRampToValueAtTime(0, t + dur);

    src.connect(g);
    g.connect(master);

    src.onended = function () {
      try { src.disconnect(); g.disconnect(); } catch (e) {}
    };

    try {
      src.start(t, start, dur);
      src.stop(t + dur + 0.02);
    } catch (e) {
      return null;
    }
    return src;
  }

  function stopSource(src) {
    if (!src) return;
    try { src.stop(0); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  }

  /* Build an AudioBuffer straight from captured Float32 chunks
     (used by the recorder fallback — no decode step needed). */
  function bufferFromChunks(chunks, length, sampleRate) {
    var c = context();
    if (!c || !length) return null;
    var out = c.createBuffer(1, length, sampleRate);
    var data = out.getChannelData(0);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      data.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  LP.audio = {
    context: context,
    unlock: unlock,
    decode: decode,
    play: play,
    stopSource: stopSource,
    bufferFromChunks: bufferFromChunks,
    get sampleRate() { return ctx ? ctx.sampleRate : 44100; },
    get state() { return ctx ? ctx.state : 'none'; },
    supported: !!(window.AudioContext || window.webkitAudioContext)
  };
})(window.LP = window.LP || {});
