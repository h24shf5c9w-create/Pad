/* ============================================================
   Pad State + Launchpad
   16 slots, each either null or { start, duration, len }.
   Triggering starts audio first and paints afterwards.
   ============================================================ */
(function (LP) {
  'use strict';

  var COUNT = 16;
  var slots = new Array(COUNT);
  var els = [];
  var flashTimers = new Array(COUNT);
  var onSelect = null;
  var onChange = null;

  /* Desktop convenience only; 'y' and 'z' both map to pad 13
     so QWERTY and QWERTZ keyboards behave the same. */
  var KEY_LABELS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
  var KEY_MAP = {};
  KEY_LABELS.forEach(function (k, i) { KEY_MAP[k.toLowerCase()] = i; });
  KEY_MAP.y = 12;

  function build(container) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < COUNT; i++) {
      var pad = document.createElement('button');
      pad.type = 'button';
      pad.className = 'pad';
      pad.dataset.index = String(i);

      var key = document.createElement('span');
      key.className = 'pad-key';
      key.textContent = KEY_LABELS[i];

      var mark = document.createElement('span');
      mark.className = 'pad-mark';

      var num = document.createElement('span');
      num.className = 'pad-num';
      num.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);

      var len = document.createElement('span');
      len.className = 'pad-len';

      var src = document.createElement('span');
      src.className = 'pad-src';

      var steps = document.createElement('span');
      steps.className = 'pad-steps';

      pad.appendChild(key);
      pad.appendChild(mark);
      pad.appendChild(steps);
      pad.appendChild(num);
      pad.appendChild(len);
      pad.appendChild(src);
      frag.appendChild(pad);
      els.push(pad);
    }
    container.appendChild(frag);
    renderAll();

    /* One delegated, non-passive listener: pointerdown is the
       earliest reliable touch signal and skips the click delay. */
    container.addEventListener('pointerdown', onPointerDown, { passive: false });

    /* Keyboard-generated clicks only (Enter/Space report detail 0). */
    container.addEventListener('click', function (e) {
      if (e.detail !== 0) return;
      var pad = e.target.closest ? e.target.closest('.pad') : null;
      if (!pad) return;
      handle(parseInt(pad.dataset.index, 10));
    });
  }

  function onPointerDown(e) {
    var pad = e.target.closest ? e.target.closest('.pad') : null;
    if (!pad) return;
    /* Stops text selection, callouts and synthetic mouse events. */
    e.preventDefault();
    handle(parseInt(pad.dataset.index, 10));
  }

  function handle(index) {
    if (isNaN(index) || index < 0 || index >= COUNT) return;
    var mode = LP.ui.state.mode;
    if (mode === 'customize') {
      select(index);
    } else if (mode === 'loop') {
      /* Selecting the row to edit, and hearing it, are the same tap. */
      select(index);
      trigger(index);
    } else {
      trigger(index);
    }
  }

  /* Audio only. `when` is an AudioContext timestamp, used by the
     sequencer; leave it out for an immediate hit. */
  function playAt(index, when) {
    var slot = slots[index];
    if (!slot) return;
    var src = LP.sources.get(slot.src);
    if (!src) return;
    LP.audio.play(src.buffer, slot.start, slot.duration, slot.vol, when);
  }

  /* Audio first — every line below the playAt() call is cosmetic. */
  function trigger(index) {
    playAt(index);
    flash(els[index]);
    if (slots[index] && LP.audio.blocked) {
      LP.ui.showSoundHint('Audio is still starting up — tap the pad once more.');
    }
  }

  function flash(el) {
    if (!el) return;
    var i = parseInt(el.dataset.index, 10);
    if (flashTimers[i]) clearTimeout(flashTimers[i]);
    el.classList.remove('is-hit');
    requestAnimationFrame(function () {
      el.classList.add('is-hit');
      flashTimers[i] = setTimeout(function () {
        el.classList.remove('is-hit');
        flashTimers[i] = null;
      }, 110);
    });
  }

  function select(index) {
    LP.ui.state.activePad = index;
    renderAll();
    if (onSelect) onSelect(index);
  }

  function assign(index, src, start, duration, len, vol) {
    slots[index] = { src: src, start: start, duration: duration, len: len, vol: vol };
    render(index);
    if (onChange) onChange();
  }

  function clear(index) {
    slots[index] = null;
    render(index);
    if (onChange) onChange();
  }

  /* Volume is safe to change on a live pad — it does not redefine
     the slice, so it applies immediately instead of needing a save. */
  function setVolume(index, vol) {
    if (!slots[index]) return;
    slots[index].vol = vol;
    render(index);
    if (onChange) onChange();
  }

  function clearAll() {
    for (var i = 0; i < COUNT; i++) slots[i] = null;
    renderAll();
    if (onChange) onChange();
  }

  function restore(list) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < COUNT; i++) {
      var s = list[i];
      var usable = s && typeof s.start === 'number' && typeof s.duration === 'number' &&
        s.src && LP.sources.get(s.src);
      slots[i] = usable
        ? { src: s.src, start: s.start, duration: s.duration, len: s.len || s.duration,
            vol: typeof s.vol === 'number' ? s.vol : LP.audio.DEFAULT_VOLUME }
        : null;
    }
    renderAll();
  }

  function render(index) {
    var el = els[index];
    if (!el) return;
    var slot = slots[index];
    var loaded = !!slot;
    var active = LP.ui.state.mode === 'customize' && LP.ui.state.activePad === index;

    var muted = loaded && slot.vol === 0;
    var steps = LP.sequencer ? LP.sequencer.stepCount(index) : 0;
    var src = loaded ? LP.sources.get(slot.src) : null;

    el.classList.toggle('is-loaded', loaded);
    el.classList.toggle('is-active', active);
    el.classList.toggle('is-muted', muted);
    el.classList.toggle('has-steps', steps > 0);
    el.querySelector('.pad-len').textContent =
      loaded ? (muted ? 'muted' : trimNum(slot.duration) + 's') : '';
    el.querySelector('.pad-src').textContent = src ? src.name : '';
    el.querySelector('.pad-steps').textContent = steps ? steps + '\u25aa' : '';

    var label = 'Pad ' + (index + 1) + ', ' +
      (loaded ? (src ? src.name + ', ' : '') + trimNum(slot.duration) +
                ' second sample at ' + slot.vol + ' percent volume'
              : 'empty');
    if (muted) label += ', muted';
    if (steps) label += ', ' + steps + ' steps in the loop';
    if (active) label += ', selected';
    el.setAttribute('aria-label', label);
    el.setAttribute('aria-pressed', String(active));
  }

  function renderAll() {
    for (var i = 0; i < COUNT; i++) render(i);
  }

  function trimNum(n) {
    return String(Math.round(n * 100) / 100);
  }

  function serialize() {
    return slots.map(function (s) {
      return s ? { src: s.src, start: s.start, duration: s.duration, len: s.len, vol: s.vol } : null;
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (LP.ui.isModalOpen) return;
      var t = e.target;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (t && t.classList && t.classList.contains('pad')) return; // handled via click
      var index = KEY_MAP[e.key ? e.key.toLowerCase() : ''];
      if (index === undefined) return;
      e.preventDefault();
      LP.audio.unlock();
      handle(index);
    });
  }

  LP.pads = {
    COUNT: COUNT,
    build: build,
    trigger: trigger,
    playAt: playAt,
    flashIndex: function (i) { flash(els[i]); },
    select: select,
    assign: assign,
    setVolume: setVolume,
    clear: clear,
    clearAll: clearAll,
    restore: restore,
    render: render,
    renderAll: renderAll,
    serialize: serialize,
    initKeyboard: initKeyboard,
    get: function (i) { return slots[i] || null; },
    anyLoaded: function () {
      for (var i = 0; i < COUNT; i++) if (slots[i]) return true;
      return false;
    },
    set onSelect(fn) { onSelect = fn; },
    set onChange(fn) { onChange = fn; }
  };
})(window.LP = window.LP || {});
