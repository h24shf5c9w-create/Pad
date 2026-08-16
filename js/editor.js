/* ============================================================
   Sample Editor
   The selection window is a fixed-width region dragged across
   the waveform. Only two transforms are written per frame —
   no canvas is redrawn while dragging.
   ============================================================ */
(function (LP) {
  'use strict';

  var MIN_SEL_PX = 22;      // keeps a 0.1 s slice grabbable on a phone
  var LENGTHS = [0.1, 0.2, 0.5, 1, 2, 3, 4, 5];

  var dom = null;
  var selStart = 0;         // seconds
  var reqLen = 0.5;         // requested length from the dropdown
  var effDur = 0.5;         // clamped to the recording length
  var curLeft = 0;          // px
  var selPx = 0;
  var wrapW = 0;

  var dragging = false;
  var grabOffset = 0;
  var wrapLeft = 0;
  var pendingLeft = null;
  var rafId = 0;
  var previewSrc = null;
  var saveTimer = null;

  function init() {
    dom = LP.ui.dom;

    dom.lenSelect.addEventListener('change', function () {
      reqLen = parseFloat(dom.lenSelect.value) || 0.5;
      layout(true);
      persistPrefs();
    });

    dom.btnPreview.addEventListener('click', preview);
    dom.btnSave.addEventListener('click', save);
    dom.btnClearPad.addEventListener('click', clearActivePad);

    dom.waveWrap.addEventListener('pointerdown', onPointerDown, { passive: false });
    dom.waveWrap.addEventListener('pointermove', onPointerMove, { passive: false });
    dom.waveWrap.addEventListener('pointerup', onPointerUp);
    dom.waveWrap.addEventListener('pointercancel', onPointerUp);

    dom.selWindow.addEventListener('keydown', onKeyDown);
  }

  /* ── Geometry ─────────────────────────────────────────────
     start seconds  <->  left pixels
     Travel is measured against the *rendered* width so the very
     end of the recording stays reachable even when the window
     is being held at its minimum touch size. */

  function total() { return LP.ui.state.duration || 0; }
  function range() { return Math.max(0, total() - effDur); }
  function travel() { return Math.max(0, wrapW - selPx); }

  function startToLeft(s) {
    var r = range(), t = travel();
    if (r <= 0 || t <= 0) return 0;
    return (s / r) * t;
  }

  function leftToStart(px) {
    var r = range(), t = travel();
    if (r <= 0 || t <= 0) return 0;
    return (px / t) * r;
  }

  function clampStart(s) {
    var r = range();
    if (!(s > 0)) return 0;
    return s > r ? r : s;
  }

  function layout(keepStart) {
    if (!dom || !LP.ui.state.buffer) return;
    var dur = total();
    wrapW = dom.waveWrap.clientWidth || 0;
    if (!wrapW || !dur) return;

    /* A recording shorter than the requested length is simply
       played whole. */
    effDur = Math.min(reqLen, dur);

    var geomPx = (effDur / dur) * wrapW;
    selPx = Math.max(MIN_SEL_PX, Math.min(wrapW, geomPx));

    dom.selWindow.style.width = selPx + 'px';
    dom.selWindow.classList.toggle('is-narrow', selPx < 52);

    if (keepStart !== false) selStart = clampStart(selStart);
    applyLeft(startToLeft(selStart));
    updateReadout();
  }

  function applyLeft(px) {
    curLeft = px;
    dom.selWindow.style.transform = 'translateX(' + px + 'px)';
    dom.waveSel.style.transform = 'translateX(' + (-px) + 'px)';
  }

  function updateReadout() {
    var fmt = LP.ui.formatPrecise;
    dom.editorRange.textContent = fmt(selStart) + ' → ' + fmt(selStart + effDur);
    dom.selWindow.setAttribute('aria-valuemin', '0');
    dom.selWindow.setAttribute('aria-valuemax', range().toFixed(2));
    dom.selWindow.setAttribute('aria-valuenow', selStart.toFixed(2));
    dom.selWindow.setAttribute('aria-valuetext',
      selStart.toFixed(2) + ' to ' + (selStart + effDur).toFixed(2) + ' seconds');
  }

  /* ── Dragging ─────────────────────────────────────────────── */

  function canDrag() {
    return LP.ui.state.mode === 'customize' && !!LP.ui.state.buffer;
  }

  function onPointerDown(e) {
    if (!canDrag()) return;
    e.preventDefault();
    LP.audio.unlock();

    var rect = dom.waveWrap.getBoundingClientRect();
    wrapLeft = rect.left;
    wrapW = rect.width;

    var insideSelection = dom.selWindow.contains(e.target);
    if (insideSelection) {
      grabOffset = e.clientX - (wrapLeft + curLeft);
    } else {
      /* Tapping the waveform jumps the window under the finger. */
      grabOffset = selPx / 2;
      commitLeft(e.clientX - wrapLeft - grabOffset);
    }

    dragging = true;
    dom.selWindow.classList.add('is-dragging');
    try { dom.waveWrap.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    pendingLeft = e.clientX - wrapLeft - grabOffset;
    if (!rafId) rafId = requestAnimationFrame(flushDrag);
  }

  function flushDrag() {
    rafId = 0;
    if (pendingLeft === null) return;
    commitLeft(pendingLeft);
    pendingLeft = null;
  }

  function commitLeft(px) {
    var t = travel();
    if (px < 0) px = 0;
    if (px > t) px = t;
    selStart = clampStart(leftToStart(px));
    applyLeft(px);
    updateReadout();
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (pendingLeft !== null) { commitLeft(pendingLeft); pendingLeft = null; }
    dom.selWindow.classList.remove('is-dragging');
    try { dom.waveWrap.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  function onKeyDown(e) {
    if (!canDrag()) return;
    var step = e.shiftKey ? 0.5 : 0.05;
    var next = selStart;
    if (e.key === 'ArrowLeft') next = selStart - step;
    else if (e.key === 'ArrowRight') next = selStart + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = range();
    else return;
    e.preventDefault();
    selStart = clampStart(next);
    applyLeft(startToLeft(selStart));
    updateReadout();
  }

  /* ── Pad binding ──────────────────────────────────────────── */

  function openPad(index) {
    if (!dom) return;
    dom.editorPadLabel.textContent = 'Pad ' + (index + 1);
    var slot = LP.pads.get(index);

    if (slot) {
      reqLen = nearestLength(slot.len || slot.duration);
      dom.lenSelect.value = String(reqLen);
      selStart = slot.start;
    }
    dom.btnClearPad.hidden = !slot;
    dom.editorHint.textContent = slot
      ? 'Drag to move, then save to overwrite this pad.'
      : 'Drag the highlighted window across the waveform.';

    layout();
  }

  function nearestLength(value) {
    var best = LENGTHS[0], bestDiff = Infinity;
    for (var i = 0; i < LENGTHS.length; i++) {
      var d = Math.abs(LENGTHS[i] - value);
      if (d < bestDiff) { bestDiff = d; best = LENGTHS[i]; }
    }
    return best;
  }

  function preview() {
    if (!LP.ui.state.buffer) return;
    LP.audio.unlock();
    LP.audio.stopSource(previewSrc);
    previewSrc = LP.audio.play(LP.ui.state.buffer, selStart, effDur);
  }

  function save() {
    if (!LP.ui.state.buffer) return;
    var index = LP.ui.state.activePad;
    LP.audio.unlock();
    LP.pads.assign(index, selStart, effDur, reqLen);
    LP.pads.trigger(index);

    dom.btnClearPad.hidden = false;
    dom.editorHint.textContent = 'Drag to move, then save to overwrite this pad.';
    LP.ui.setStatus('Saved to pad ' + (index + 1) + ' · ' +
      effDur.toFixed(2) + 's from ' + selStart.toFixed(2) + 's');

    var label = dom.btnSave.textContent;
    dom.btnSave.textContent = 'Saved ✓';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { dom.btnSave.textContent = label; }, 900);
  }

  function clearActivePad() {
    var index = LP.ui.state.activePad;
    LP.pads.clear(index);
    dom.btnClearPad.hidden = true;
    dom.editorHint.textContent = 'Drag the highlighted window across the waveform.';
    LP.ui.setStatus('Pad ' + (index + 1) + ' cleared');
  }

  function reset() {
    selStart = 0;
    effDur = Math.min(reqLen, 0);
    curLeft = 0;
    if (dom) {
      dom.selWindow.style.transform = 'translateX(0px)';
      dom.waveSel.style.transform = 'translateX(0px)';
      dom.btnClearPad.hidden = true;
    }
  }

  function persistPrefs() {
    if (LP.app && LP.app.persist) LP.app.persist();
  }

  LP.editor = {
    init: init,
    layout: layout,
    openPad: openPad,
    preview: preview,
    save: save,
    reset: reset,
    setLength: function (v) {
      reqLen = nearestLength(v);
      if (dom) dom.lenSelect.value = String(reqLen);
    },
    get length() { return reqLen; },
    get selection() { return { start: selStart, duration: effDur }; }
  };
})(window.LP = window.LP || {});
