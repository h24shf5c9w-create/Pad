/* ============================================================
   Recording
   MediaRecorder is the primary path (audio/mp4 on iOS Safari,
   audio/webm elsewhere). If it is missing we capture raw
   Float32 frames through the AudioContext instead.
   Recording runs until stop() is called — there is no time cap.
   ============================================================ */
(function (LP) {
  'use strict';

  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus'
  ];

  var stream = null;
  var recorder = null;
  var chunks = [];
  var startedAt = 0;
  var stoppedAt = 0;
  var active = false;
  var mode = 'mediarecorder';

  /* Fallback capture state */
  var srcNode = null, processor = null, sinkNode = null;
  var pcmChunks = [], pcmLength = 0, pcmRate = 44100;

  function pickMime() {
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
      } catch (e) {}
    }
    return '';
  }

  function getStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var err = new Error('getUserMedia unavailable');
      err.name = 'NotSupportedError';
      return Promise.reject(err);
    }
    /* Raw-ish input makes for better samples; fall back to plain
       audio:true if the device rejects the constraint set. */
    var tuned = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };
    return navigator.mediaDevices.getUserMedia(tuned).catch(function (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' ||
                e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        throw e;
      }
      return navigator.mediaDevices.getUserMedia({ audio: true });
    });
  }

  function releaseStream() {
    if (!stream) return;
    try {
      stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
    stream = null;
  }

  function startFallbackCapture() {
    var ctx = LP.audio.context();
    if (!ctx) throw new Error('no-audio-context');
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});

    pcmChunks = [];
    pcmLength = 0;
    pcmRate = ctx.sampleRate;

    srcNode = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    sinkNode = ctx.createGain();
    sinkNode.gain.value = 0;

    processor.onaudioprocess = function (ev) {
      if (!active) return;
      var input = ev.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));
      pcmLength += input.length;
    };

    srcNode.connect(processor);
    processor.connect(sinkNode);
    sinkNode.connect(ctx.destination);
  }

  function stopFallbackCapture() {
    try { if (processor) { processor.onaudioprocess = null; processor.disconnect(); } } catch (e) {}
    try { if (srcNode) srcNode.disconnect(); } catch (e) {}
    try { if (sinkNode) sinkNode.disconnect(); } catch (e) {}
    processor = srcNode = sinkNode = null;
  }

  /* Resolves once the mic is live and capture has begun. */
  function start(onTrackLost) {
    if (active) return Promise.reject(new Error('already-recording'));
    chunks = [];

    return getStream().then(function (s) {
      stream = s;

      var track = s.getAudioTracks()[0];
      if (track && onTrackLost) {
        track.addEventListener('ended', function () {
          if (active) onTrackLost();
        });
      }

      if (window.MediaRecorder) {
        mode = 'mediarecorder';
        var mime = pickMime();
        try {
          recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        } catch (e) {
          recorder = new MediaRecorder(s);
        }
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        /* No timeslice: Safari hands back one well-formed blob at stop. */
        recorder.start();
      } else {
        mode = 'pcm';
        startFallbackCapture();
      }

      active = true;
      startedAt = Date.now();
      stoppedAt = 0;
      return true;
    });
  }

  /* Resolves with { kind: 'bytes', bytes, mime } or { kind: 'pcm', ... }. */
  function stop() {
    if (!active) return Promise.reject(new Error('not-recording'));

    return new Promise(function (resolve, reject) {
      active = false;
      stoppedAt = Date.now();

      if (mode === 'pcm') {
        stopFallbackCapture();
        releaseStream();
        if (!pcmLength) { reject(new Error('empty-recording')); return; }
        resolve({ kind: 'pcm', chunks: pcmChunks, length: pcmLength, sampleRate: pcmRate });
        pcmChunks = [];
        return;
      }

      var rec = recorder;
      recorder = null;
      if (!rec) { reject(new Error('not-recording')); return; }

      var settled = false;
      var guard = setTimeout(function () { finish(); }, 4000);

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        releaseStream();

        if (!chunks.length) { reject(new Error('empty-recording')); return; }
        var type = (rec.mimeType || chunks[0].type || 'audio/webm').split(';')[0];
        var blob = new Blob(chunks, { type: type });
        chunks = [];

        if (!blob.size) { reject(new Error('empty-recording')); return; }

        blobToArrayBuffer(blob).then(function (bytes) {
          resolve({ kind: 'bytes', bytes: bytes, mime: type });
        }, reject);
      }

      rec.onstop = finish;
      rec.onerror = function () { finish(); };

      try {
        if (rec.state !== 'inactive') rec.stop();
        else finish();
      } catch (e) { finish(); }
    });
  }

  function blobToArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('read-failed')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* Hard abort — used by reset while a recording is running. */
  function cancel() {
    active = false;
    if (mode === 'pcm') stopFallbackCapture();
    if (recorder) {
      try { recorder.onstop = null; recorder.ondataavailable = null; recorder.stop(); } catch (e) {}
      recorder = null;
    }
    chunks = [];
    pcmChunks = [];
    pcmLength = 0;
    releaseStream();
  }

  LP.recorder = {
    start: start,
    stop: stop,
    cancel: cancel,
    get isRecording() { return active; },
    get elapsed() {
      if (!startedAt) return 0;
      return ((active ? Date.now() : stoppedAt) - startedAt) / 1000;
    },
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  };
})(window.LP = window.LP || {});
