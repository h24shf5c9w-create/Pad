/* ============================================================
   App / Event Handling
   Owns the top level flows: record → decode → source, pad
   selection, the loop transport, songs and reset.
   ============================================================ */
(function (LP) {
  'use strict';

  var IS_IOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var WAVE_BASE = '#3b3b47';
  var WAVE_SEL = '#35d9a0';

  var dom, state;
  var timerId = 0;
  var resizeRaf = 0;
  var stepEls = [];
  var pendingRestore = null;

  /* ── Boot ─────────────────────────────────────────────────── */

  function init() {
    LP.ui.init();
    dom = LP.ui.dom;
    state = LP.ui.state;

    readThemeColors();
    LP.pads.build(dom.padGrid);
    LP.pads.initKeyboard();
    LP.pads.onSelect = onPadSelect;
    LP.pads.onChange = onPadChange;
    LP.editor.init();
    LP.sequencer.onStep = onSequencerStep;
    LP.sequencer.onStop = renderTransport;

    buildStepBoard();
    wireControls();
    wireLoop();
    wireSongs();
    wireGlobal();

    LP.ui.setMode('play');
    LP.ui.setPhase('idle');
    applyViewportFallback();
    checkEnvironment();

    loadInstruments().then(restoreSession);
  }

  function readThemeColors() {
    try {
      var s = getComputedStyle(document.documentElement);
      WAVE_SEL = (s.getPropertyValue('--accent') || WAVE_SEL).trim() || WAVE_SEL;
      WAVE_BASE = (s.getPropertyValue('--wave-base') || WAVE_BASE).trim() || WAVE_BASE;
    } catch (e) {}
  }

  /* The kit is synthesised up front so pads are usable before
     anything has been recorded. */
  function loadInstruments() {
    var ctx = LP.audio.context();
    var rate = ctx ? ctx.sampleRate : 44100;
    return LP.instruments.renderAll(rate).then(function (list) {
      list.forEach(function (i) { LP.sources.addInstrument(i.id, i.name, i.buffer); });
      LP.editor.refreshSources(LP.sources.firstId());
      LP.editor.layout();
      drawWaveforms();
      LP.ui.renderEditorVisibility();
    }).catch(function () {});
  }

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
    dom.modeLoop.addEventListener('click', function () { switchMode('loop'); });
    dom.modeCustomize.addEventListener('click', function () { switchMode('customize'); });
  }

  function wireGlobal() {
    document.addEventListener('pointerdown', function () { LP.audio.unlock(); }, true);
    document.addEventListener('keydown', function () { LP.audio.unlock(); }, true);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) LP.audio.unlock();
    });

    window.addEventListener('resize', scheduleRelayout);
    window.addEventListener('orientationchange', scheduleRelayout);

    window.addEventListener('beforeunload', function (e) {
      if (!LP.recorder.isRecording) return;
      e.preventDefault();
      e.returnValue = '';
    });

    /* Space toggles the loop on a desktop keyboard. */
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (LP.ui.isModalOpen || !dom.songSheet.hidden) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
                t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
      e.preventDefault();
      LP.sequencer.toggleTransport();
      renderTransport();
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
      drawWaveforms();
      LP.editor.openPad(state.activePad);
    } else if (mode === 'loop') {
      renderLoopPanel();
    }
    LP.pads.renderAll();
    persist();
  }

  function onPadSelect(index) {
    if (state.mode === 'customize') LP.editor.openPad(index);
    if (state.mode === 'loop') renderLoopPanel();
  }

  function onPadChange() {
    renderLoopPanel();
    LP.ui.setPhase(state.phase);
    persist();
  }

  /* ── Recording ────────────────────────────────────────────── */

  function onRecord() {
    LP.audio.unlock();
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
      LP.audio.markSessionDirty();
      if (result.kind === 'pcm') {
        var buf = LP.audio.bufferFromChunks(result.chunks, result.length, result.sampleRate);
        if (!buf) throw new Error('empty-recording');
        adoptRecording(buf, null, null);
        return null;
      }
      var forStore = result.bytes.slice(0);
      return LP.audio.decode(result.bytes).then(function (buf) {
        adoptRecording(buf, forStore, result.mime);
      });
    }).catch(function (err) {
      var msg = (err && err.message === 'empty-recording')
        ? 'Nothing was recorded — try again.'
        : 'That recording could not be processed. Please try again.';
      LP.ui.setPhase('error', msg);
    });
  }

  /* Recordings accumulate — a new one never replaces the last. */
  function adoptRecording(buffer, bytes, mime) {
    var source = LP.sources.addRecording(buffer, bytes, mime);
    state.editSrc = source.id;
    LP.editor.refreshSources(source.id);

    dom.recTime.textContent = LP.ui.formatTime(buffer.duration);
    LP.ui.setPhase('ready', source.name + ' · ' + buffer.duration.toFixed(1) + 's');
    if (IS_IOS) {
      LP.ui.showSoundHint('No sound? Flip the silent switch on the side of your iPhone and turn the volume up.');
    }

    drawWaveforms();
    if (state.mode === 'customize') LP.editor.openPad(state.activePad);
    else LP.editor.layout();
    persist();
  }

  function onNew() {
    LP.ui.confirm({
      title: LP.recorder.isRecording ? 'Discard this recording?' : 'Start over?',
      body: 'This clears every recording, all 16 pads and the loop.',
      confirmLabel: 'Clear all'
    }).then(function (ok) {
      if (ok) resetAll();
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

  /* ── Waveform ─────────────────────────────────────────────── */

  function drawWaveforms() {
    var src = LP.ui.editSource();
    if (!src) return;
    var peaks = LP.sources.peaksFor(src);
    var w = dom.waveWrap.clientWidth;
    if (!w || !peaks) return;

    LP.waveform.draw(dom.waveBase, peaks, WAVE_BASE);
    if (dom.selWindow.offsetParent === null) return;   // hidden: no size yet
    dom.waveSel.style.width = w + 'px';
    LP.waveform.draw(dom.waveSel, peaks, WAVE_SEL);
  }

  function clearWaveforms() {
    [dom.waveBase, dom.waveSel].forEach(function (c) {
      var g = c.getContext('2d');
      if (g) g.clearRect(0, 0, c.width, c.height);
    });
  }

  /* ── Loop / sequencer ─────────────────────────────────────── */

  function buildStepBoard() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < LP.sequencer.STEPS; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'step' + (i % 4 === 0 ? ' is-beat' : '');
      b.dataset.step = String(i);
      b.textContent = String(i + 1);
      b.setAttribute('aria-pressed', 'false');
      frag.appendChild(b);
      stepEls.push(b);
    }
    dom.stepBoard.appendChild(frag);

    dom.stepBoard.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.step') : null;
      if (!el) return;
      LP.audio.unlock();
      var step = parseInt(el.dataset.step, 10);
      var on = LP.sequencer.toggle(state.activePad, step);
      if (on) LP.pads.trigger(state.activePad);
      renderSteps();
      LP.pads.render(state.activePad);
      LP.ui.setPhase(state.phase);
      persist();
    });
  }

  function wireLoop() {
    dom.btnTransport.addEventListener('click', function () {
      LP.audio.unlock();
      LP.sequencer.toggleTransport();
      renderTransport();
    });

    dom.bpmSlider.addEventListener('input', function () {
      var v = LP.sequencer.setBpm(parseInt(dom.bpmSlider.value, 10));
      dom.bpmValue.textContent = String(v);
      dom.bpmSlider.style.setProperty('--fill', ((v - 60) / 140 * 100) + '%');
      persist();
    });

    dom.btnClearSteps.addEventListener('click', function () {
      LP.sequencer.clearPad(state.activePad);
      renderSteps();
      LP.pads.render(state.activePad);
      LP.ui.setPhase(state.phase);
      persist();
    });

    dom.btnClearAllSteps.addEventListener('click', function () {
      LP.sequencer.clearAll();
      renderSteps();
      LP.pads.renderAll();
      LP.ui.setPhase(state.phase);
      persist();
    });

    setBpmUi(LP.sequencer.bpm);
  }

  function setBpmUi(v) {
    dom.bpmSlider.value = String(v);
    dom.bpmValue.textContent = String(v);
    dom.bpmSlider.style.setProperty('--fill', ((v - 60) / 140 * 100) + '%');
  }

  function renderSteps() {
    for (var i = 0; i < stepEls.length; i++) {
      var on = LP.sequencer.isOn(state.activePad, i);
      stepEls[i].classList.toggle('is-on', on);
      stepEls[i].setAttribute('aria-pressed', String(on));
      stepEls[i].setAttribute('aria-label', 'Step ' + (i + 1) + (on ? ', on' : ', off'));
    }
  }

  function renderLoopPanel() {
    dom.loopPadLabel.textContent = String(state.activePad + 1);
    var slot = LP.pads.get(state.activePad);
    var src = slot ? LP.sources.get(slot.src) : null;
    dom.loopSrcLabel.textContent = src ? src.name : 'empty — assign a sound in Customize';
    renderSteps();
    renderTransport();
  }

  function renderTransport() {
    var playing = LP.sequencer.isPlaying;
    dom.btnTransport.textContent = playing ? 'Stop loop' : 'Play loop';
    dom.btnTransport.classList.toggle('btn-danger', playing);
    dom.btnTransport.classList.toggle('btn-primary', !playing);
    if (!playing) {
      for (var i = 0; i < stepEls.length; i++) stepEls[i].classList.remove('is-cursor');
    }
  }

  /* Runs from rAF, never from the audio scheduler. */
  function onSequencerStep(step) {
    for (var i = 0; i < stepEls.length; i++) {
      stepEls[i].classList.toggle('is-cursor', i === step);
    }
    if (step < 0) return;
    for (var pad = 0; pad < LP.pads.COUNT; pad++) {
      if (LP.sequencer.isOn(pad, step) && LP.pads.get(pad)) LP.pads.flashIndex(pad);
    }
  }

  /* ── Songs ────────────────────────────────────────────────── */

  function wireSongs() {
    dom.btnSongs.addEventListener('click', openSongs);
    dom.songClose.addEventListener('click', closeSongs);
    dom.songBackdrop.addEventListener('click', closeSongs);
    dom.btnSaveSong.addEventListener('click', saveSong);

    document.addEventListener('keydown', function (e) {
      if (dom.songSheet.hidden || e.key !== 'Escape') return;
      e.preventDefault();
      closeSongs();
    });
  }

  function openSongs() {
    dom.songSheet.hidden = false;
    setSongNote('Saves pads, steps, tempo and your recordings on this device.');
    if (!dom.songName.value) {
      dom.songName.value = 'Song ' + new Date().toLocaleDateString();
    }
    refreshSongList();
  }

  function closeSongs() { dom.songSheet.hidden = true; }

  function setSongNote(text, isError) {
    dom.songNote.textContent = text;
    dom.songNote.classList.toggle('is-error', !!isError);
  }

  function saveSong() {
    var name = (dom.songName.value || '').trim() || 'Untitled';
    setSongNote('Saving…');
    LP.songs.save(name).then(function (res) {
      if (res.ok) {
        setSongNote('Saved "' + name + '".');
        refreshSongList();
      } else {
        setSongNote(res.reason === 'too-large'
          ? 'Those recordings are too large to save. Clear one and try again.'
          : 'Could not save on this device.', true);
      }
    });
  }

  function refreshSongList() {
    LP.songs.list().then(function (rows) {
      dom.songList.innerHTML = '';
      if (!rows.length) {
        var empty = document.createElement('li');
        empty.className = 'song-empty';
        empty.textContent = 'No songs saved yet.';
        dom.songList.appendChild(empty);
        return;
      }
      rows.forEach(function (row) { dom.songList.appendChild(songRow(row)); });
    });
  }

  function songRow(row) {
    var li = document.createElement('li');
    li.className = 'song-row';

    var info = document.createElement('div');
    info.className = 'song-info';
    var name = document.createElement('div');
    name.className = 'song-name';
    name.textContent = row.name;
    var meta = document.createElement('div');
    meta.className = 'song-meta';
    meta.textContent = row.bpm + ' BPM · ' + row.pads + ' pads · ' +
      row.recordings + ' recording' + (row.recordings === 1 ? '' : 's');
    info.appendChild(name);
    info.appendChild(meta);

    var load = document.createElement('button');
    load.type = 'button';
    load.className = 'btn btn-ghost btn-sm';
    load.textContent = 'Load';
    load.addEventListener('click', function () { loadSong(row.id, row.name); });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-btn';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', 'Delete ' + row.name);
    del.addEventListener('click', function () {
      LP.songs.remove(row.id).then(refreshSongList);
    });

    li.appendChild(info);
    li.appendChild(load);
    li.appendChild(del);
    return li;
  }

  function loadSong(id, name) {
    setSongNote('Loading "' + name + '"…');
    LP.songs.load(id).then(function (res) {
      if (!res.ok) { setSongNote('Could not load that song.', true); return; }
      applySong(res.song, res.decoded);
      setSongNote('Loaded "' + name + '".');
      closeSongs();
    });
  }

  function applySong(song, decoded) {
    LP.sequencer.stop();
    LP.sources.clearRecordings();
    decoded.forEach(function (r) {
      LP.sources.addRecording(r.buffer, r.bytes, r.mime, r.name, r.id);
    });

    LP.pads.restore(song.pads);
    LP.sequencer.restore(song.patterns);
    setBpmUi(LP.sequencer.setBpm(song.bpm || 120));

    state.activePad = 0;
    LP.editor.refreshSources(LP.sources.firstId());
    LP.editor.openPad(0);

    var recs = LP.sources.recordings();
    dom.recTime.textContent = recs.length
      ? LP.ui.formatTime(recs[recs.length - 1].duration) : '0:00.0';
    LP.ui.setPhase(recs.length ? 'ready' : 'idle',
      recs.length ? 'Loaded · ' + recs.length + ' recording' + (recs.length === 1 ? '' : 's') : null);

    drawWaveforms();
    LP.editor.layout();
    renderLoopPanel();
    LP.pads.renderAll();
    persist();
  }

  /* ── Reset ────────────────────────────────────────────────── */

  function resetAll() {
    if (LP.recorder.isRecording) LP.audio.markSessionDirty();
    LP.recorder.cancel();
    LP.sequencer.stop();
    stopTimer();

    LP.sources.clearRecordings();
    LP.pads.clearAll();
    LP.sequencer.clearAll();
    LP.editor.reset();
    LP.ui.hideSoundHint();

    state.activePad = 0;
    LP.editor.refreshSources(LP.sources.firstId());
    pendingRestore = null;

    clearWaveforms();
    dom.recTime.textContent = '0:00.0';
    dom.recTime.classList.remove('is-live');
    LP.ui.setPhase('idle');
    LP.editor.openPad(0);
    drawWaveforms();
    renderLoopPanel();
    LP.pads.renderAll();
    LP.storage.clear();
  }

  /* ── Session persistence ──────────────────────────────────── */

  function persist() {
    LP.storage.saveSession({
      pads: LP.pads.serialize(),
      prefs: {
        mode: state.mode,
        len: LP.editor.length,
        vol: LP.editor.volume,
        bpm: LP.sequencer.bpm,
        patterns: LP.sequencer.serialize()
      }
    });
    LP.storage.saveRecordings(LP.sources.recordings().map(function (s) {
      return { id: s.id, name: s.name, mime: s.mime, bytes: s.bytes };
    }));
  }

  function restoreSession() {
    if (!LP.storage.available) return;

    return LP.storage.load().then(function (data) {
      var session = data.session;
      var prefs = session && session.prefs;
      if (prefs) {
        if (prefs.len) LP.editor.setLength(prefs.len);
        if (typeof prefs.vol === 'number') LP.editor.setVolume(prefs.vol);
        if (prefs.bpm) setBpmUi(LP.sequencer.setBpm(prefs.bpm));
        if (prefs.patterns) LP.sequencer.restore(prefs.patterns);
      }

      var recs = data.recordings;
      if (!recs || !recs.length) { finishRestore(session); return; }

      LP.ui.setPhase('processing', 'Restoring your last session…');
      return decodeAll(recs).then(function (ok) {
        if (!ok.length) {
          pendingRestore = { recs: recs, session: session };
          LP.ui.setPhase('idle', 'Tap anywhere to restore your last session');
          document.addEventListener('pointerdown', retryRestore, { once: true });
          document.addEventListener('keydown', retryRestore, { once: true });
          return;
        }
        ok.forEach(function (r) {
          LP.sources.addRecording(r.buffer, r.bytes, r.mime, r.name, r.id);
        });
        finishRestore(session);
      });
    }).catch(function () {});
  }

  function decodeAll(recs) {
    return Promise.all(recs.map(function (r) {
      if (!r.bytes || !r.bytes.byteLength) return Promise.resolve(null);
      var keep = r.bytes.slice(0);
      return LP.audio.decode(r.bytes).then(function (buffer) {
        return { id: r.id, name: r.name, mime: r.mime, bytes: keep, buffer: buffer };
      }, function () { return null; });
    })).then(function (list) { return list.filter(Boolean); });
  }

  function retryRestore() {
    if (!pendingRestore) return;
    var job = pendingRestore;
    pendingRestore = null;
    LP.ui.setPhase('processing', 'Restoring your last session…');
    decodeAll(job.recs).then(function (ok) {
      if (!ok.length) { LP.storage.clear(); LP.ui.setPhase('idle'); return; }
      ok.forEach(function (r) {
        LP.sources.addRecording(r.buffer, r.bytes, r.mime, r.name, r.id);
      });
      finishRestore(job.session);
    });
  }

  function finishRestore(session) {
    if (session && session.pads) LP.pads.restore(session.pads);

    var recs = LP.sources.recordings();
    if (recs.length) {
      var last = recs[recs.length - 1];
      state.editSrc = last.id;
      dom.recTime.textContent = LP.ui.formatTime(last.duration);
      LP.ui.setPhase('ready', 'Restored · ' + recs.length +
        ' recording' + (recs.length === 1 ? '' : 's'));
    }

    var prefs = session && session.prefs;
    if (prefs && prefs.mode && prefs.mode !== 'play') LP.ui.setMode(prefs.mode);

    LP.editor.refreshSources(state.editSrc);
    LP.editor.openPad(state.activePad);
    drawWaveforms();
    LP.editor.layout();
    renderLoopPanel();
    LP.pads.renderAll();
    LP.ui.setPhase(state.phase);
  }

  LP.app = { persist: persist, redraw: drawWaveforms };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.LP = window.LP || {});
