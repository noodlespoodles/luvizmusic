/* =========================================================================
   LUVIZMUSIC - generated cover art

   Not every mix has a cover, and a tile that says "no picture yet" announces
   an absence. This draws one instead, from the mix's own title, so a mix with
   no artwork looks like a deliberate white-label pressing rather than a gap.

   The devices are borrowed from the night's own lineage, not invented:
     arcs      West End Records' concentric spiral, off-centre and cropped
     bars      H5's barcode and supermarket-signage grammar (Super Discount)
     halftone  a print dot field, coarse enough to read as ink
     plates    offset colour plates, out of register, as on a bad press run

   Rules it obeys:
     - Deterministic. The same title always draws the same tile, so a cover
       does not change under the visitor between one visit and the next.
     - Two inks only, from css/tokens.css. Never a literal colour here.
     - Pure SVG, generated as a data URI. No network, no canvas, no build
       step, and it works over file:// where fetch does not.
     - Static. Nothing animates: these sit behind the grain overlay, which is
       already the only moving texture on the page (R20).
   ========================================================================= */

window.LUVIZ = window.LUVIZ || {};

(function (LUVIZ) {
  'use strict';

  /* A small, stable string hash. Not cryptographic and not trying to be:
     it only has to spread titles evenly across the devices below. */
  function seedFrom(text) {
    var h = 2166136261;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* Deterministic pseudo-random stream from that seed. */
  function rngFrom(seed) {
    var state = seed || 1;
    return function next() {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;  state >>>= 0;
      return state / 4294967296;
    };
  }

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length) % list.length];
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  /* Ink values are read from the live stylesheet so this file never holds a
     literal colour. Falls back to the token defaults if called before CSS
     lands (which only happens in a test harness with no document). */
  function inks() {
    var fallback = { ground: '#0A0A0A', bright: '#FF1A1A', deep: '#C1121F', bone: '#F5F1E8' };
    if (typeof document === 'undefined' || !document.documentElement) return fallback;
    var cs = getComputedStyle(document.documentElement);
    function tok(name, dflt) {
      var v = cs.getPropertyValue(name);
      return (v && v.trim()) || dflt;
    }
    return {
      ground: tok('--ground-near-black', fallback.ground),
      bright: tok('--red-bright', fallback.bright),
      deep: tok('--red-deep', fallback.deep),
      bone: tok('--ink-bone', fallback.bone)
    };
  }

  var SIZE = 600;

  /* --- the four devices ------------------------------------------------- */

  function arcs(rng, ink) {
    /* Concentric rings, off-centre and running off the edge, as the West End
       spiral does on the sleeve. Weight varies so it reads as printed, not
       as a chart. */
    var cx = round(SIZE * (0.2 + rng() * 0.6));
    var cy = round(SIZE * (0.2 + rng() * 0.6));
    var rings = 7 + Math.floor(rng() * 7);
    var step = SIZE / (rings * 1.5);
    var out = '';
    for (var i = rings; i > 0; i -= 1) {
      var r = round(step * i);
      var w = round(1 + rng() * 9);
      var fill = i % 3 === 0 ? ink.deep : ink.bright;
      out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
             '" fill="none" stroke="' + fill + '" stroke-width="' + w + '"/>';
    }
    return out;
  }

  function bars(rng, ink) {
    /* Barcode. Widths are uneven and the block is cropped by the frame, which
       is what stops it reading as a UI element. */
    var x = -SIZE * 0.1;
    var out = '';
    while (x < SIZE * 1.1) {
      var w = round(2 + rng() * 26);
      if (rng() > 0.32) {
        var fill = rng() > 0.78 ? ink.bone : ink.bright;
        var top = round(SIZE * rng() * 0.28);
        var h = round(SIZE - top - SIZE * rng() * 0.22);
        out += '<rect x="' + round(x) + '" y="' + top + '" width="' + w +
               '" height="' + h + '" fill="' + fill + '"/>';
      }
      x += w + 2 + rng() * 10;
    }
    return out;
  }

  function halftone(rng, ink) {
    /* A dot field whose radius falls away from one corner, the way a coarse
       screen does when the plate is over-inked at one edge. */
    var cols = 11 + Math.floor(rng() * 7);
    var gap = SIZE / cols;
    var ox = rng();
    var oy = rng();
    var out = '';
    for (var r = 0; r < cols; r += 1) {
      for (var c = 0; c < cols; c += 1) {
        var dx = (c / cols) - ox;
        var dy = (r / cols) - oy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var rad = Math.max(0, (0.72 - d) * gap * 0.95);
        if (rad > 0.6) {
          out += '<circle cx="' + round(gap * (c + 0.5)) + '" cy="' + round(gap * (r + 0.5)) +
                 '" r="' + round(rad) + '" fill="' + (d > 0.42 ? ink.deep : ink.bright) + '"/>';
        }
      }
    }
    return out;
  }

  function plates(rng, ink) {
    /* Three solids, offset from each other, multiplying where they cross.
       This is misregistration: the same device the crew cards use, at scale. */
    var out = '';
    var shapes = 3;
    for (var i = 0; i < shapes; i += 1) {
      var fill = [ink.bright, ink.deep, ink.bone][i];
      var w = round(SIZE * (0.42 + rng() * 0.5));
      var h = round(SIZE * (0.42 + rng() * 0.5));
      var x = round(SIZE * (rng() * 0.5 - 0.12));
      var y = round(SIZE * (rng() * 0.5 - 0.12));
      if (rng() > 0.45) {
        out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
               '" fill="' + fill + '" style="mix-blend-mode:multiply"/>';
      } else {
        out += '<ellipse cx="' + round(x + w / 2) + '" cy="' + round(y + h / 2) +
               '" rx="' + round(w / 2) + '" ry="' + round(h / 2) +
               '" fill="' + fill + '" style="mix-blend-mode:multiply"/>';
      }
    }
    return out;
  }

  var DEVICES = { arcs: arcs, bars: bars, halftone: halftone, plates: plates };
  var DEVICE_NAMES = ['arcs', 'bars', 'halftone', 'plates'];

  /**
   * Build a cover for a title. Returns { svg, dataUri, device }.
   * `device` is exposed so tests can assert the spread without parsing SVG.
   */
  function cover(title, options) {
    var opts = options || {};
    var seed = seedFrom(title);
    var rng = rngFrom(seed);
    var ink = opts.ink || inks();
    var device = opts.device || pick(rng, DEVICE_NAMES);

    /* A coarse speckle over the top, so the tile carries the same printed
       grain as everything else rather than sitting flat and digital. */
    var speckle = '';
    var dots = 90 + Math.floor(rng() * 90);
    for (var i = 0; i < dots; i += 1) {
      speckle += '<rect x="' + round(rng() * SIZE) + '" y="' + round(rng() * SIZE) +
                 '" width="' + round(1 + rng() * 3) + '" height="' + round(1 + rng() * 3) +
                 '" fill="' + ink.bone + '" opacity="' + round(0.05 + rng() * 0.16) + '"/>';
    }

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" ' +
      'width="' + SIZE + '" height="' + SIZE + '" role="presentation">' +
      '<rect width="' + SIZE + '" height="' + SIZE + '" fill="' + ink.ground + '"/>' +
      DEVICES[device](rng, ink) +
      speckle +
      '</svg>';

    return {
      device: device,
      svg: svg,
      dataUri: 'data:image/svg+xml,' + encodeURIComponent(svg)
    };
  }

  LUVIZ.mixArt = {
    cover: cover,
    seedFrom: seedFrom,
    devices: DEVICE_NAMES.slice()
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LUVIZ.mixArt;
  }
}(window.LUVIZ));
