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
    mode: 'play',         // play | customize
    buffer: null,         // decoded AudioBuffer of the whole recording
    peaks: null,
    duration: 0,
    activePad: 0,
    blocked: null        // set when the environment rules recording out entirely
  };

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
      'btnRecord', 'btnStop', 'btnNew', 'modePlay', 'modeCustomize',
      'editor', 'editorPadLabel', 'editorRange', 'waveWrap', 'waveBase',
      'waveSel', 'selWindow', 'waveEmpty', 'editorControls', 'lenSelect',
      'btnPreview', 'btnSave', 'btnClearPad', 'editorHint', 'padGrid',
      'footHint', 'modal', 'modalBackdrop', 'modalTitle', 'modalBody',
      'modalCancel', 'modalConfirm'
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

    var hasAudio = !!state.buffer;
    var busy = phase === 'permission' || phase === 'processing';

    /* A blocked environment must survive every later phase change. */
    dom.btnRecord.disabled = busy || phase === 'recording' || !!state.blocked;
    dom.btnStop.disabled = phase !== 'recording';
    dom.btnNew.disabled = busy || (!hasAudio && phase !== 'recording');

    dom.recTime.classList.toggle('is-live', phase === 'recording');
    if (phase === 'recording') {
      dom.btnRecord.setAttribute('aria-label', 'Recording in progress');
    } else {
      dom.btnRecord.setAttribute('aria-label', hasAudio ? 'Record again' : 'Start recording');
    }

    renderEditorVisibility();
    renderFootHint();
  }

  function setMode(mode) {
    state.mode = mode;
    var isPlay = mode === 'play';
    dom.modePlay.classList.toggle('is-active', isPlay);
    dom.modeCustomize.classList.toggle('is-active', !isPlay);
    dom.modePlay.setAttribute('aria-selected', String(isPlay));
    dom.modeCustomize.setAttribute('aria-selected', String(!isPlay));
    dom.editor.setAttribute('data-mode', mode);
    renderEditorVisibility();
    renderFootHint();
  }

  /* The editor card is hidden in play mode until there is audio,
     so the pads stay as large as possible. */
  function renderEditorVisibility() {
    var hasAudio = !!state.buffer;
    var show = state.mode === 'customize' || hasAudio;
    dom.editor.hidden = !show;
    dom.waveEmpty.hidden = hasAudio;

    var disabled = !hasAudio;
    dom.lenSelect.disabled = disabled;
    dom.btnPreview.disabled = disabled;
    dom.btnSave.disabled = disabled;

    if (!hasAudio) {
      dom.editorPadLabel.textContent = 'Waveform';
      dom.editorRange.textContent = '—';
      dom.editorHint.textContent = 'Record something first.';
    } else if (state.mode === 'play') {
      /* No pad is being edited here — show the whole recording instead. */
      dom.editorPadLabel.textContent = 'Recording';
      dom.editorRange.textContent = '0:00.00 → ' + formatPrecise(state.duration);
    }
  }

  function renderFootHint() {
    var hasAudio = !!state.buffer;
    var text;
    if (state.phase === 'recording') text = 'Recording — press Stop when you are done.';
    else if (!hasAudio) text = 'Record something to fill the pads.';
    else if (state.mode === 'play') text = 'Tap a pad to play.';
    else text = 'Tap a pad, drag the window, then save.';
    dom.footHint.textContent = text;
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
    init: function () { cacheDom(); initModal(); },
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
