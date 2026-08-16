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

      pad.appendChild(key);
      pad.appendChild(mark);
      pad.appendChild(num);
      pad.appendChild(len);
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
    if (LP.ui.state.mode === 'customize') {
      select(index);
    } else {
      trigger(index);
    }
  }

  /* Audio first — every line below the play() call is cosmetic. */
  function trigger(index) {
    var slot = slots[index];
    if (slot && LP.ui.state.buffer) {
      LP.audio.play(LP.ui.state.buffer, slot.start, slot.duration);
    }
    flash(els[index]);
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

  function assign(index, start, duration, len) {
    slots[index] = { start: start, duration: duration, len: len };
    render(index);
    if (onChange) onChange();
  }

  function clear(index) {
    slots[index] = null;
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
      slots[i] = (s && typeof s.start === 'number' && typeof s.duration === 'number')
        ? { start: s.start, duration: s.duration, len: s.len || s.duration }
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

    el.classList.toggle('is-loaded', loaded);
    el.classList.toggle('is-active', active);
    el.querySelector('.pad-len').textContent = loaded ? trimNum(slot.duration) + 's' : '';

    var label = 'Pad ' + (index + 1) + ', ' +
      (loaded ? trimNum(slot.duration) + ' second sample' : 'empty');
    if (active) label += ', selected for editing';
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
      return s ? { start: s.start, duration: s.duration, len: s.len } : null;
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
    select: select,
    assign: assign,
    clear: clear,
    clearAll: clearAll,
    restore: restore,
    render: render,
    renderAll: renderAll,
    serialize: serialize,
    initKeyboard: initKeyboard,
    get: function (i) { return slots[i] || null; },
    set onSelect(fn) { onSelect = fn; },
    set onChange(fn) { onChange = fn; }
  };
})(window.LP = window.LP || {});
