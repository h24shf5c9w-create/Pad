/* ============================================================
   UI State
   Single source of truth for the interface phase, plus the
   status line, mode switch and confirm dialog.
   ============================================================ */
(function (LP) {
  'use strict';

  var dom = {};

  var state = {
    phase: 'idle',        // idle | permission | denied | recording | processing | ready | error
    mode: 'play',         // play | loop | customize
    editSrc: null,        // id of the source shown in the editor
    activePad: 0,
    blocked: null        // set when the environment rules recording out entirely
  };

  function editSource() { return state.editSrc ? LP.sources.get(state.editSrc) : null; }
  function hasRecording() { return LP.sources.recordings().length > 0; }

  var PHASE_TEXT = {
    idle:       'No recording yet',
    permission: 'Asking for microphone access…',
    denied:     'Microphone access denied',
    recording:  'Recording…',
    processing: 'Preparing audio…',
    ready:      'Recording ready',
    error:      'Something went wrong'
  };

  function cacheDom() {
    [
      'app', 'secureBanner', 'recDot', 'statusText', 'recTime',
      'btnRecord', 'btnStop', 'btnNew', 'modePlay', 'modeLoop', 'modeCustomize',
      'loopPanel', 'loopPadLabel', 'loopSrcLabel', 'stepBoard', 'btnTransport',
      'bpmSlider', 'bpmValue', 'btnClearSteps', 'btnClearAllSteps',
      'btnSongs', 'songSheet', 'songBackdrop', 'songClose', 'songName',
      'btnSaveSong', 'songNote', 'songList', 'srcSelect',
      'editor', 'editorPadLabel', 'editorRange', 'waveWrap', 'waveBase',
      'waveSel', 'selWindow', 'waveEmpty', 'editorControls', 'lenSelect',
      'btnPreview', 'btnSave', 'btnClearPad', 'editorHint', 'padGrid',
      'volSlider', 'volValue',
      'footHint', 'modal', 'modalBackdrop', 'modalTitle', 'modalBody',
      'modalCancel', 'modalConfirm', 'soundHint', 'soundHintText', 'soundHintClose'
    ].forEach(function (id) { dom[id] = document.getElementById(id); });
  }

  function formatTime(seconds) {
    var s = Math.max(0, seconds || 0);
    var m = Math.floor(s / 60);
    var rest = s - m * 60;
    var whole = Math.floor(rest);
    var tenths = Math.floor((rest - whole) * 10);
    return m + ':' + (whole < 10 ? '0' : '') + whole + '.' + tenths;
  }

  function formatPrecise(seconds) {
    var s = Math.max(0, seconds || 0);
    var m = Math.floor(s / 60);
    var rest = s - m * 60;
    return m + ':' + (rest < 10 ? '0' : '') + rest.toFixed(2);
  }

  function setStatus(text, isError) {
    dom.statusText.textContent = text;
    dom.statusText.classList.toggle('is-error', !!isError);
  }

  function setPhase(phase, message) {
    state.phase = phase;

    var dotState = phase;
    if (phase === 'denied' || phase === 'error') dotState = 'error';
    else if (phase === 'permission') dotState = 'processing';
    else if (phase !== 'recording' && phase !== 'processing' && phase !== 'ready') dotState = 'idle';
    dom.recDot.setAttribute('data-state', dotState);

    var isError = phase === 'denied' || phase === 'error';
    if (state.blocked) {
      dom.recDot.setAttribute('data-state', 'error');
      setStatus(state.blocked, true);
    } else {
      setStatus(message || PHASE_TEXT[phase] || '', isError);
    }

    var hasAudio = hasRecording();
    var busy = phase === 'permission' || phase === 'processing';

    /* A blocked environment must survive every later phase change. */
    dom.btnRecord.disabled = busy || phase === 'recording' || !!state.blocked;
    dom.btnStop.disabled = phase !== 'recording';
    var hasContent = hasAudio || phase === 'recording' ||
      (LP.pads && LP.pads.anyLoaded()) || (LP.sequencer && LP.sequencer.anySteps());
    dom.btnNew.disabled = busy || !hasContent;

    dom.recTime.classList.toggle('is-live', phase === 'recording');
    if (phase === 'recording') {
      dom.btnRecord.setAttribute('aria-label', 'Recording in progress');
    } else {
      dom.btnRecord.setAttribute('aria-label', hasAudio ? 'Record again' : 'Start recording');
    }

    renderEditorVisibility();
    renderFootHint();
  }

  var MODE_BTN = { play: 'modePlay', loop: 'modeLoop', customize: 'modeCustomize' };

  function setMode(mode) {
    state.mode = mode;
    Object.keys(MODE_BTN).forEach(function (key) {
      var btn = dom[MODE_BTN[key]];
      var on = key === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    dom.editor.setAttribute('data-mode', mode);
    dom.loopPanel.hidden = mode !== 'loop';
    renderEditorVisibility();
    renderFootHint();
  }

  /* The editor card is hidden in play mode until there is audio,
     so the pads stay as large as possible. */
  function renderEditorVisibility() {
    var src = editSource();
    /* Loop mode needs the height for the step board; play mode only
       shows the waveform once something has actually been recorded. */
    var show = state.mode === 'customize' || (state.mode === 'play' && hasRecording());
    dom.editor.hidden = !show;
    dom.waveEmpty.hidden = !!src;

    var disabled = !src;
    dom.lenSelect.disabled = disabled;
    dom.volSlider.disabled = disabled;
    dom.srcSelect.disabled = disabled;
    dom.btnPreview.disabled = disabled;
    dom.btnSave.disabled = disabled;

    if (!src) {
      dom.editorPadLabel.textContent = 'Waveform';
      dom.editorRange.textContent = '—';
      dom.editorHint.textContent = 'Record something first.';
    } else if (state.mode === 'play') {
      dom.editorPadLabel.textContent = src.name;
      dom.editorRange.textContent = '0:00.00 → ' + formatPrecise(src.duration);
    }
  }

  function renderFootHint() {
    var text;
    if (state.phase === 'recording') text = 'Recording — press Stop when you are done.';
    else if (state.mode === 'loop') text = 'Tap a pad, then switch its steps on.';
    else if (state.mode === 'customize') text = 'Pick a sound, drag the window, then save.';
    else text = 'Tap a pad to play.';
    dom.footHint.textContent = text;
  }

  /* ── Sound hint ─────────────────────────────────────────── */
  var hintDismissed = false;

  function showSoundHint(text) {
    if (hintDismissed) return;
    dom.soundHintText.textContent = text;
    dom.soundHint.hidden = false;
  }

  function hideSoundHint() { dom.soundHint.hidden = true; }

  function initSoundHint() {
    dom.soundHintClose.addEventListener('click', function () {
      hintDismissed = true;
      hideSoundHint();
    });
  }

  /* ── Confirm dialog ─────────────────────────────────────── */
  var modalResolve = null;
  var lastFocus = null;

  function confirmDialog(opts) {
    dom.modalTitle.textContent = opts.title;
    dom.modalBody.textContent = opts.body;
    dom.modalConfirm.textContent = opts.confirmLabel || 'Confirm';
    lastFocus = document.activeElement;
    dom.modal.hidden = false;
    dom.modalConfirm.focus();
    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  function closeModal(result) {
    dom.modal.hidden = true;
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    lastFocus = null;
    var r = modalResolve;
    modalResolve = null;
    if (r) r(result);
  }

  function initModal() {
    dom.modalCancel.addEventListener('click', function () { closeModal(false); });
    dom.modalBackdrop.addEventListener('click', function () { closeModal(false); });
    dom.modalConfirm.addEventListener('click', function () { closeModal(true); });
    document.addEventListener('keydown', function (e) {
      if (dom.modal.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal(false); }
    });
  }

  LP.ui = {
    dom: dom,
    state: state,
    editSource: editSource,
    hasRecording: hasRecording,
    init: function () { cacheDom(); initModal(); initSoundHint(); },
    showSoundHint: showSoundHint,
    hideSoundHint: hideSoundHint,
    setPhase: setPhase,
    setStatus: setStatus,
    setBlocked: function (message) { state.blocked = message; setPhase(state.phase); },
    setMode: setMode,
    renderEditorVisibility: renderEditorVisibility,
    renderFootHint: renderFootHint,
    confirm: confirmDialog,
    formatTime: formatTime,
    formatPrecise: formatPrecise,
    get isModalOpen() { return !dom.modal.hidden; }
  };
})(window.LP = window.LP || {});
