/* ============================================================
   App / Event Handling
   Wires recording, waveform, pads and editor together and owns
   the top level flows: record → stop → decode → ready → reset.
   ============================================================ */
(function (LP) {
  'use strict';

  var dom, state;
  var peaks = null;
  var timerId = 0;
  var resizeRaf = 0;
  var selDirty = false;
  var pendingRestore = null;   // bytes kept for a post-gesture decode retry

  var WAVE_BASE = '#3b3b47';
  var WAVE_SEL = '#35d9a0';

  /* ── Boot ─────────────────────────────────────────────────── */

  function init() {
    LP.ui.init();
    dom = LP.ui.dom;
    state = LP.ui.state;

    readThemeColors();
    LP.pads.build(dom.padGrid);
    LP.pads.initKeyboard();
    LP.pads.onSelect = function (index) { LP.editor.openPad(index); };
    LP.pads.onChange = persist;
    LP.editor.init();

    wireControls();
    wireGlobal();

    LP.ui.setMode('play');
    LP.ui.setPhase('idle');
    checkEnvironment();
    applyViewportFallback();
    restoreSession();
  }

  function readThemeColors() {
    try {
      var s = getComputedStyle(document.documentElement);
      WAVE_SEL = (s.getPropertyValue('--accent') || WAVE_SEL).trim() || WAVE_SEL;
      WAVE_BASE = (s.getPropertyValue('--wave-base') || WAVE_BASE).trim() || WAVE_BASE;
    } catch (e) {}
  }

  /* Older iOS lacks dvh: drive the shell height from innerHeight. */
  function applyViewportFallback() {
    var supportsDvh = window.CSS && CSS.supports && CSS.supports('height', '100dvh');
    if (supportsDvh) return;
    var apply = function () { dom.app.style.height = window.innerHeight + 'px'; };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
  }

  function checkEnvironment() {
    var secure = window.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';

    if (!secure) {
      dom.secureBanner.hidden = false;
      LP.ui.setBlocked('Microphone needs a secure https:// address');
    } else if (!LP.recorder.supported || !LP.audio.supported) {
      dom.secureBanner.hidden = false;
      dom.secureBanner.querySelector('strong').textContent = 'Recording is not supported here.';
      dom.secureBanner.querySelector('span').textContent =
        'This browser cannot record audio. Try Safari on iPhone, or Chrome.';
      LP.ui.setBlocked('This browser cannot record audio');
    }
  }

  /* ── Event handling ───────────────────────────────────────── */

  function wireControls() {
    dom.btnRecord.addEventListener('click', onRecord);
    dom.btnStop.addEventListener('click', onStop);
    dom.btnNew.addEventListener('click', onNew);

    dom.modePlay.addEventListener('click', function () { switchMode('play'); });
    dom.modeCustomize.addEventListener('click', function () { switchMode('customize'); });
  }

  function wireGlobal() {
    /* Capture phase: the context is resumed before any pad handler
       runs, so the first tap after a suspend is not silent. */
    document.addEventListener('pointerdown', function () { LP.audio.unlock(); }, true);
    document.addEventListener('keydown', function () { LP.audio.unlock(); }, true);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) LP.audio.unlock();
    });

    window.addEventListener('resize', scheduleRelayout);
    window.addEventListener('orientationchange', scheduleRelayout);

    /* Recording keeps running if the tab is hidden; warn on unload. */
    window.addEventListener('beforeunload', function (e) {
      if (!LP.recorder.isRecording) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function scheduleRelayout() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      drawWaveforms();
      LP.editor.layout();
    });
  }

  function switchMode(mode) {
    if (state.mode === mode) return;
    LP.ui.setMode(mode);
    if (mode === 'customize') {
      /* The selection canvas has no size while hidden — redraw now. */
      drawWaveforms();
      if (state.buffer) LP.editor.openPad(state.activePad);
      LP.pads.renderAll();
    } else {
      LP.pads.renderAll();
    }
    persist();
  }

  /* ── Recording flow ───────────────────────────────────────── */

  function onRecord() {
    LP.audio.unlock();
    if (state.buffer) {
      LP.ui.confirm({
        title: 'Record again?',
        body: 'The current recording and all 16 pads will be cleared first.',
        confirmLabel: 'Record new'
      }).then(function (ok) {
        if (!ok) return;
        resetAll(true);
        startRecording();
      });
      return;
    }
    startRecording();
  }

  function startRecording() {
    LP.ui.setPhase('permission');
    LP.recorder.start(onTrackLost).then(function () {
      LP.ui.setPhase('recording');
      startTimer();
    }).catch(function (err) {
      stopTimer();
      LP.ui.setPhase(micErrorPhase(err), micErrorMessage(err));
    });
  }

  function onTrackLost() {
    if (LP.recorder.isRecording) onStop();
  }

  function onStop() {
    if (!LP.recorder.isRecording) return;
    stopTimer();
    LP.ui.setPhase('processing');

    LP.recorder.stop().then(function (result) {
      if (result.kind === 'pcm') {
        var buf = LP.audio.bufferFromChunks(result.chunks, result.length, result.sampleRate);
        if (!buf) throw new Error('empty-recording');
        adoptBuffer(buf, null, null);
        return null;
      }
      /* decodeAudioData detaches its input, so copy for storage first. */
      var forStore = result.bytes.slice(0);
      return LP.audio.decode(result.bytes).then(function (buf) {
        adoptBuffer(buf, forStore, result.mime);
      });
    }).catch(function (err) {
      var msg = (err && err.message === 'empty-recording')
        ? 'Nothing was recorded — try again.'
        : 'That recording could not be processed. Please try again.';
      LP.ui.setPhase('error', msg);
    });
  }

  function onNew() {
    var recording = LP.recorder.isRecording;
    LP.ui.confirm({
      title: recording ? 'Discard this recording?' : 'Start over?',
      body: 'This clears the recording and empties all 16 pads.',
      confirmLabel: 'Clear all'
    }).then(function (ok) {
      if (ok) resetAll(false);
    });
  }

  function startTimer() {
    stopTimer();
    dom.recTime.textContent = '0:00.0';
    timerId = setInterval(function () {
      dom.recTime.textContent = LP.ui.formatTime(LP.recorder.elapsed);
    }, 100);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = 0; }
  }

  function micErrorPhase(err) {
    var name = err && err.name;
    return (name === 'NotAllowedError' || name === 'SecurityError') ? 'denied' : 'error';
  }

  function micErrorMessage(err) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone blocked. Allow it in your browser settings, then try again.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No microphone found on this device.';
      case 'NotReadableError':
        return 'The microphone is busy in another app. Close it and try again.';
      case 'NotSupportedError':
        return 'This browser cannot record audio. Try Safari or Chrome.';
      default:
        return 'Could not start recording. Please try again.';
    }
  }

  /* ── Recording ready ──────────────────────────────────────── */

  function adoptBuffer(buffer, bytes, mime) {
    state.buffer = buffer;
    state.duration = buffer.duration;
    peaks = LP.waveform.computePeaks(buffer);

    dom.recTime.textContent = LP.ui.formatTime(buffer.duration);
    LP.ui.setPhase('ready', 'Ready · ' + buffer.duration.toFixed(1) + 's recorded');

    drawWaveforms();
    if (state.mode === 'customize') LP.editor.openPad(state.activePad);
    else LP.editor.layout();

    if (bytes) LP.storage.saveAudio(bytes, mime);
    persist();
  }

  function drawWaveforms() {
    if (!peaks) return;
    var w = dom.waveWrap.clientWidth;
    if (!w) return;

    LP.waveform.draw(dom.waveBase, peaks, WAVE_BASE);

    /* offsetParent is null while the selection is display:none. */
    if (dom.selWindow.offsetParent === null) { selDirty = true; return; }
    dom.waveSel.style.width = w + 'px';
    LP.waveform.draw(dom.waveSel, peaks, WAVE_SEL);
    selDirty = false;
  }

  function clearWaveforms() {
    [dom.waveBase, dom.waveSel].forEach(function (c) {
      var g = c.getContext('2d');
      if (g) g.clearRect(0, 0, c.width, c.height);
    });
  }

  /* ── Reset ────────────────────────────────────────────────── */

  function resetAll(keepStorage) {
    LP.recorder.cancel();
    stopTimer();

    state.buffer = null;
    state.duration = 0;
    state.activePad = 0;
    peaks = null;
    pendingRestore = null;

    LP.pads.clearAll();
    LP.editor.reset();
    clearWaveforms();

    dom.recTime.textContent = '0:00.0';
    dom.recTime.classList.remove('is-live');
    LP.ui.setPhase('idle');
    LP.pads.renderAll();

    if (!keepStorage) LP.storage.clear();
  }

  /* ── Persistence ──────────────────────────────────────────── */

  function persist() {
    LP.storage.saveSession({
      pads: LP.pads.serialize(),
      prefs: { mode: state.mode, len: LP.editor.length }
    });
  }

  function restoreSession() {
    if (!LP.storage.available) return;

    LP.storage.load().then(function (data) {
      var session = data.session;
      if (session && session.prefs) {
        if (session.prefs.len) LP.editor.setLength(session.prefs.len);
      }
      if (!data.audio || !data.audio.bytes || !data.audio.bytes.byteLength) return;

      LP.ui.setPhase('processing', 'Restoring your last recording…');
      var mime = data.audio.mime;
      var forStore = data.audio.bytes.slice(0);

      LP.audio.decode(data.audio.bytes).then(function (buffer) {
        finishRestore(buffer, session);
      }).catch(function () {
        /* Some engines refuse to decode before the first gesture —
           keep the bytes and retry once the user touches the page. */
        pendingRestore = { bytes: forStore, mime: mime, session: session };
        LP.ui.setPhase('idle', 'Tap anywhere to restore your last recording');
        document.addEventListener('pointerdown', retryRestore, { once: true });
        document.addEventListener('keydown', retryRestore, { once: true });
      });
    });
  }

  function retryRestore() {
    if (!pendingRestore) return;
    var job = pendingRestore;
    pendingRestore = null;
    LP.ui.setPhase('processing', 'Restoring your last recording…');
    LP.audio.decode(job.bytes).then(function (buffer) {
      finishRestore(buffer, job.session);
    }).catch(function () {
      LP.storage.clear();
      LP.ui.setPhase('idle');
    });
  }

  function finishRestore(buffer, session) {
    state.buffer = buffer;
    state.duration = buffer.duration;
    peaks = LP.waveform.computePeaks(buffer);

    if (session && session.pads) LP.pads.restore(session.pads);
    if (session && session.prefs && session.prefs.mode === 'customize') {
      LP.ui.setMode('customize');
    }

    dom.recTime.textContent = LP.ui.formatTime(buffer.duration);
    LP.ui.setPhase('ready', 'Restored · ' + buffer.duration.toFixed(1) + 's recorded');
    drawWaveforms();
    if (state.mode === 'customize') LP.editor.openPad(state.activePad);
    else LP.editor.layout();
  }

  LP.app = { persist: persist, redraw: drawWaveforms };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.LP = window.LP || {});
