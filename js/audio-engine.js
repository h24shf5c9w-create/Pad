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
  var keepAlive = null;       // silent <audio> loop, see forceAudibleSession()
  var sessionDirty = false;   // set after the mic was used

  /* Short ramp on both ends so slicing mid-waveform doesn't click. */
  var FADE = 0.004;

  /* Volume scale: pads are set in percent, and 30 % reproduces the
     original 1:1 level, so 100 % is roughly 3.3x louder. Phone mic
     recordings are quiet, which is what the headroom is for. */
  var REFERENCE_PERCENT = 30;
  var DEFAULT_VOLUME = 100;

  function gainFor(volume) {
    var v = (volume === undefined || volume === null) ? DEFAULT_VOLUME : volume;
    if (!(v > 0)) return 0;
    return (v > 100 ? 100 : v) / REFERENCE_PERCENT;
  }

  /* Zero-latency safety net for the boosted signal: transparent below
     0.7, then a soft knee, so a loud recording saturates gently
     instead of wrapping into harsh digital clipping. A compressor
     would add lookahead latency, which pads cannot afford. */
  function softClipCurve() {
    var n = 2048, curve = new Float32Array(n), knee = 0.7;
    for (var i = 0; i < n; i++) {
      var x = (i * 2) / (n - 1) - 1;
      var a = Math.abs(x);
      curve[i] = a <= knee
        ? x
        : (x < 0 ? -1 : 1) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    }
    return curve;
  }

  /* ── iOS output routing ───────────────────────────────────────
     Two things silence Web Audio on an iPhone even when everything
     else is correct:

     1. Web Audio alone runs in the "ambient" audio session, which the
        hardware silent switch mutes. A playing HTMLAudioElement moves
        the session to "playback", which ignores that switch.
     2. After getUserMedia the session is "play and record", which
        routes output to the earpiece instead of the speaker, and
        Safari does not always restore it when the mic is released.

     So: keep a silent looping element playing, and rebuild the
     AudioContext on the first gesture after a recording. */

  var IS_IOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function silentTrackUrl() {
    var rate = 8000, n = Math.floor(rate * 0.5);
    var bytes = new Uint8Array(44 + n);
    var dv = new DataView(bytes.buffer);
    function tag(o, str) { for (var i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); }
    tag(0, 'RIFF'); dv.setUint32(4, 36 + n, true); tag(8, 'WAVE');
    tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate, true);
    dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    tag(36, 'data'); dv.setUint32(40, n, true);
    for (var i = 0; i < n; i++) bytes[44 + i] = 128;   // 8-bit silence
    try { return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); }
    catch (e) { return null; }
  }

  function forceAudibleSession() {
    /* iOS only — elsewhere this would needlessly take over the
       media session and stop whatever the user was listening to. */
    if (!IS_IOS) return;
    try {
      if (!keepAlive) {
        var url = silentTrackUrl();
        if (!url) return;
        keepAlive = document.createElement('audio');
        keepAlive.src = url;
        keepAlive.loop = true;
        keepAlive.preload = 'auto';
        keepAlive.setAttribute('playsinline', '');
        keepAlive.setAttribute('webkit-playsinline', '');
        keepAlive.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        document.body.appendChild(keepAlive);
      }
      if (keepAlive.paused) {
        var pr = keepAlive.play();
        if (pr && pr.catch) pr.catch(function () {});
      }
    } catch (e) { /* not fatal — Web Audio still plays when unmuted */ }
  }

  /* Called once the microphone has been released. */
  function markSessionDirty() { sessionDirty = true; }

  function rebuild() {
    var old = ctx;
    ctx = null; master = null; unlocked = false;
    if (old && old.close && old.state !== 'closed') {
      try { old.close(); } catch (e) {}
    }
    return context();
  }

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

    var limiter = ctx.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.oversample = 'none';        // oversampling would add latency

    master.connect(limiter);
    limiter.connect(ctx.destination);
    return ctx;
  }

  /* Must run inside a user gesture on iOS: claim an audible session,
     rebuild a mic-tainted context, resume, then start one silent
     source — that last step is what actually flips the context on. */
  function unlock() {
    if (sessionDirty) { sessionDirty = false; rebuild(); }

    var c = context();
    if (!c) return;

    forceAudibleSession();

    /* iOS also reports the non-standard 'interrupted' state. */
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
  function play(buffer, startTime, duration, volume) {
    var c = ctx;
    if (!c || !buffer) return null;
    var level = gainFor(volume);
    if (level <= 0) return null;
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
    g.gain.linearRampToValueAtTime(level, t + fade);
    g.gain.setValueAtTime(level, t + dur - fade);
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
    markSessionDirty: markSessionDirty,
    /* Reported in the UI when a pad is hit but nothing can come out. */
    get blocked() { return !ctx || ctx.state !== 'running'; },
    decode: decode,
    play: play,
    stopSource: stopSource,
    bufferFromChunks: bufferFromChunks,
    gainFor: gainFor,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    get sampleRate() { return ctx ? ctx.sampleRate : 44100; },
    get state() { return ctx ? ctx.state : 'none'; },
    supported: !!(window.AudioContext || window.webkitAudioContext)
  };
})(window.LP = window.LP || {});
