/* ============================================================
   Waveform
   Peaks are reduced once per recording, then drawn with a
   single stroked path. Dragging never redraws the canvas —
   the accent layer is just translated inside a clip window.
   ============================================================ */
(function (LP) {
  'use strict';

  var BUCKETS = 3000;

  function computePeaks(buffer) {
    var channels = Math.min(buffer.numberOfChannels, 2);
    var length = buffer.length;
    var buckets = Math.min(BUCKETS, Math.max(1, length));
    var step = length / buckets;
    var peaks = new Float32Array(buckets);

    var data = [];
    for (var c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

    for (var b = 0; b < buckets; b++) {
      var from = Math.floor(b * step);
      var to = Math.min(length, Math.floor((b + 1) * step));
      if (to <= from) to = Math.min(length, from + 1);
      var peak = 0;
      for (var i = from; i < to; i++) {
        for (var ch = 0; ch < channels; ch++) {
          var v = data[ch][i];
          if (v < 0) v = -v;
          if (v > peak) peak = v;
        }
      }
      peaks[b] = peak;
    }

    /* Normalise so quiet phone recordings still read clearly. */
    var max = 0;
    for (var k = 0; k < peaks.length; k++) if (peaks[k] > max) max = peaks[k];
    if (max > 0.0001) {
      var gain = 1 / max;
      if (gain > 8) gain = 8;
      for (var m = 0; m < peaks.length; m++) peaks[m] = Math.min(1, peaks[m] * gain);
    }
    return peaks;
  }

  function draw(canvas, peaks, color) {
    if (!canvas) return;
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 300;
    var cssH = canvas.clientHeight || canvas.parentNode.clientHeight || 100;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    var g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!peaks || !peaks.length) return;

    var barW = Math.max(1.5, Math.round(2 * dpr));
    var gap = Math.max(1, Math.round(1.6 * dpr));
    var stepPx = barW + gap;
    var bars = Math.max(1, Math.floor(w / stepPx));
    var mid = h / 2;
    var maxH = h * 0.44;
    var minH = barW / 2;

    g.strokeStyle = color;
    g.lineWidth = barW;
    g.lineCap = 'round';
    g.beginPath();

    for (var i = 0; i < bars; i++) {
      var from = Math.floor(i * peaks.length / bars);
      var to = Math.max(from + 1, Math.floor((i + 1) * peaks.length / bars));
      var peak = 0;
      for (var p = from; p < to && p < peaks.length; p++) {
        if (peaks[p] > peak) peak = peaks[p];
      }
      var barH = Math.max(minH, peak * maxH);
      var x = i * stepPx + barW / 2 + gap / 2;
      g.moveTo(x, mid - barH);
      g.lineTo(x, mid + barH);
    }
    g.stroke();
  }

  LP.waveform = { computePeaks: computePeaks, draw: draw };
})(window.LP = window.LP || {});
