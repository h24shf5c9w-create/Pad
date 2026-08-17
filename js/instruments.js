/* ============================================================
   Built-in Instruments
   A small drum kit synthesised once into AudioBuffers, so the app
   is playable before anything has been recorded. Rendered through
   an OfflineAudioContext because real filters sound far better
   than hand-rolled maths, and it costs a few lines.
   ============================================================ */
(function (LP) {
  'use strict';

  var SPECS = [
    { id: 'kick',    name: 'Kick',     length: 0.45 },
    { id: 'snare',   name: 'Snare',    length: 0.28 },
    { id: 'hihat',   name: 'Hi-hat',   length: 0.09 },
    { id: 'openhat', name: 'Open hat', length: 0.38 },
    { id: 'clap',    name: 'Clap',     length: 0.32 }
  ];

  function noise(oc, seconds) {
    var len = Math.max(1, Math.floor(oc.sampleRate * seconds));
    var buf = oc.createBuffer(1, len, oc.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = oc.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(oc, peak, attack, decay) {
    var g = oc.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(peak, attack);
    g.gain.exponentialRampToValueAtTime(0.0001, attack + decay);
    return g;
  }

  var BUILD = {
    kick: function (oc) {
      var osc = oc.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, 0);
      osc.frequency.exponentialRampToValueAtTime(44, 0.13);
      var g = env(oc, 1, 0.002, 0.38);
      osc.connect(g); g.connect(oc.destination);
      osc.start(0); osc.stop(0.45);

      var click = noise(oc, 0.02);
      var hp = oc.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      var cg = env(oc, 0.28, 0.001, 0.018);
      click.connect(hp); hp.connect(cg); cg.connect(oc.destination);
      click.start(0);
    },

    snare: function (oc) {
      var n = noise(oc, 0.28);
      var bp = oc.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
      var ng = env(oc, 0.9, 0.001, 0.18);
      n.connect(bp); bp.connect(ng); ng.connect(oc.destination);
      n.start(0);

      var osc = oc.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, 0);
      osc.frequency.exponentialRampToValueAtTime(120, 0.1);
      var og = env(oc, 0.5, 0.001, 0.09);
      osc.connect(og); og.connect(oc.destination);
      osc.start(0); osc.stop(0.2);
    },

    hihat: function (oc) {
      var n = noise(oc, 0.09);
      var hp = oc.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7500;
      var g = env(oc, 0.7, 0.001, 0.045);
      n.connect(hp); hp.connect(g); g.connect(oc.destination);
      n.start(0);
    },

    openhat: function (oc) {
      var n = noise(oc, 0.38);
      var hp = oc.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7000;
      var g = env(oc, 0.62, 0.001, 0.3);
      n.connect(hp); hp.connect(g); g.connect(oc.destination);
      n.start(0);
    },

    clap: function (oc) {
      /* Three quick bursts then a tail — that spread is what makes
         a clap read as a clap rather than as noise. */
      var offsets = [0, 0.011, 0.023];
      for (var i = 0; i < offsets.length; i++) {
        var n = noise(oc, 0.05);
        var bp = oc.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.9;
        var g = oc.createGain();
        g.gain.setValueAtTime(0.0001, offsets[i]);
        g.gain.linearRampToValueAtTime(0.8, offsets[i] + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, offsets[i] + 0.03);
        n.connect(bp); bp.connect(g); g.connect(oc.destination);
        n.start(offsets[i]);
      }
      var tail = noise(oc, 0.3);
      var tb = oc.createBiquadFilter();
      tb.type = 'bandpass'; tb.frequency.value = 1400; tb.Q.value = 0.6;
      var tg = oc.createGain();
      tg.gain.setValueAtTime(0.0001, 0.026);
      tg.gain.linearRampToValueAtTime(0.5, 0.03);
      tg.gain.exponentialRampToValueAtTime(0.0001, 0.28);
      tail.connect(tb); tb.connect(tg); tg.connect(oc.destination);
      tail.start(0.026);
    }
  };

  function normalise(buffer, target) {
    var d = buffer.getChannelData(0), peak = 0;
    for (var i = 0; i < d.length; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
    if (peak > 0.0001) {
      var gain = target / peak;
      for (var j = 0; j < d.length; j++) d[j] *= gain;
    }
    return buffer;
  }

  function renderOne(spec, rate) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return Promise.resolve(null);
    var oc;
    try { oc = new OC(1, Math.ceil(rate * spec.length), rate); }
    catch (e) { return Promise.resolve(null); }
    BUILD[spec.id](oc);
    var rendered = oc.startRendering();
    if (rendered && rendered.then) {
      return rendered.then(function (buf) { return normalise(buf, 0.92); },
                           function () { return null; });
    }
    return new Promise(function (resolve) {
      oc.oncomplete = function (e) { resolve(normalise(e.renderedBuffer, 0.92)); };
    });
  }

  function renderAll(rate) {
    return Promise.all(SPECS.map(function (spec) {
      return renderOne(spec, rate).then(function (buffer) {
        return buffer ? { id: spec.id, name: spec.name, buffer: buffer } : null;
      }, function () { return null; });
    })).then(function (list) {
      return list.filter(Boolean);
    });
  }

  LP.instruments = { SPECS: SPECS, renderAll: renderAll };
})(window.LP = window.LP || {});
