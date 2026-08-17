/* ============================================================
   Sequencer
   16 steps per pad, looping. Steps are scheduled ahead against
   the AudioContext clock rather than fired from a timer, so the
   groove does not drift when the main thread is busy. The timer
   only decides what to schedule next.
   ============================================================ */
(function (LP) {
  'use strict';

  var STEPS = 16;
  var PADS = 16;

  var LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
  var SCHEDULE_AHEAD = 0.12;  // how far ahead it queues audio

  var patterns = [];
  var bpm = 120;
  var playing = false;
  var timerId = 0;
  var nextStepTime = 0;
  var nextStep = 0;
  var drawQueue = [];
  var visibleStep = -1;
  var rafId = 0;
  var onStep = null;
  var onStop = null;

  for (var p = 0; p < PADS; p++) patterns.push(new Array(STEPS).fill(false));

  function stepSeconds() { return 60 / bpm / 4; }   // 16th notes

  function toggle(pad, step) {
    if (pad < 0 || pad >= PADS || step < 0 || step >= STEPS) return false;
    patterns[pad][step] = !patterns[pad][step];
    return patterns[pad][step];
  }

  function isOn(pad, step) { return !!patterns[pad][step]; }

  function padHasSteps(pad) {
    var row = patterns[pad];
    for (var i = 0; i < STEPS; i++) if (row[i]) return true;
    return false;
  }

  function stepCount(pad) {
    var n = 0, row = patterns[pad];
    for (var i = 0; i < STEPS; i++) if (row[i]) n++;
    return n;
  }

  function clearPad(pad) { patterns[pad] = new Array(STEPS).fill(false); }

  function clearAll() {
    for (var i = 0; i < PADS; i++) clearPad(i);
  }

  function anySteps() {
    for (var i = 0; i < PADS; i++) if (padHasSteps(i)) return true;
    return false;
  }

  /* Queue every pad that fires on this step at one exact time. */
  function scheduleStep(step, when) {
    for (var pad = 0; pad < PADS; pad++) {
      if (!patterns[pad][step]) continue;
      LP.pads.playAt(pad, when);
    }
    drawQueue.push({ step: step, time: when });
  }

  function scheduler() {
    var ctx = LP.audio.context();
    if (!ctx) return;
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(nextStep, nextStepTime);
      nextStepTime += stepSeconds();
      nextStep = (nextStep + 1) % STEPS;
    }
  }

  /* Painting is decoupled from scheduling: the playhead catches up
     in rAF and can never delay an audio event. */
  function draw() {
    if (!playing) { rafId = 0; return; }
    var ctx = LP.audio.context();
    if (ctx) {
      while (drawQueue.length && drawQueue[0].time <= ctx.currentTime) {
        visibleStep = drawQueue.shift().step;
        if (onStep) onStep(visibleStep);
      }
    }
    rafId = requestAnimationFrame(draw);
  }

  function start() {
    if (playing) return;
    LP.audio.unlock();
    var ctx = LP.audio.context();
    if (!ctx) return;
    playing = true;
    nextStep = 0;
    visibleStep = -1;
    drawQueue = [];
    nextStepTime = ctx.currentTime + 0.06;
    scheduler();
    timerId = setInterval(scheduler, LOOKAHEAD_MS);
    if (!rafId) rafId = requestAnimationFrame(draw);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if (timerId) { clearInterval(timerId); timerId = 0; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    drawQueue = [];
    visibleStep = -1;
    if (onStep) onStep(-1);
    if (onStop) onStop();
  }

  function toggleTransport() { playing ? stop() : start(); }

  function setBpm(value) {
    var v = Math.round(value);
    if (isNaN(v)) return bpm;
    bpm = Math.max(60, Math.min(200, v));
    return bpm;
  }

  function serialize() {
    return patterns.map(function (row) { return row.slice(); });
  }

  function restore(data) {
    if (!Array.isArray(data)) return;
    for (var i = 0; i < PADS; i++) {
      var row = data[i];
      patterns[i] = new Array(STEPS).fill(false);
      if (!Array.isArray(row)) continue;
      for (var s = 0; s < STEPS; s++) patterns[i][s] = !!row[s];
    }
  }

  LP.sequencer = {
    STEPS: STEPS,
    toggle: toggle,
    isOn: isOn,
    padHasSteps: padHasSteps,
    stepCount: stepCount,
    clearPad: clearPad,
    clearAll: clearAll,
    anySteps: anySteps,
    start: start,
    stop: stop,
    toggleTransport: toggleTransport,
    setBpm: setBpm,
    serialize: serialize,
    restore: restore,
    get bpm() { return bpm; },
    get isPlaying() { return playing; },
    get step() { return visibleStep; },
    set onStep(fn) { onStep = fn; },
    set onStop(fn) { onStop = fn; }
  };
})(window.LP = window.LP || {});
