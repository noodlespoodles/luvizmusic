/* ==========================================================================
   LUVIZMUSIC - the dithered ground
   U12. Companion to css/dither.css.
   --------------------------------------------------------------------------
   THE GOVERNING IDEA IS A TWO-COLOUR PRESS. An 8x8 Bayer ordered dither is
   the threshold map a photocopier or a one-colour press genuinely uses to
   fake continuous tone from a single solid ink. Running two plates of it at
   two screen angles is what a two-colour job looks like. This is not a
   stylised approximation of print; it is the arithmetic print actually uses.

   It replaces nothing. css/texture.css's grain is still the floor, and this
   is a ground underneath the page that the grain continues to sit over.

   THE FILE IS IN TWO HALVES, the same split U8 and U11 use:

     1. A pure half. plan() and lean() are arithmetic. They never touch the
        page, never read a clock, and draw no randomness, so
        tests/ditherfield.test.js can prove the whole contract under Node
        where there is no document and no WebGL.

     2. A browser half. mount() compiles the shader and wires it to the one
        input signal. It declines politely rather than throwing when
        anything it needs is absent, because losing the ground must never
        cost the page.

   WHAT IT READS, AND WHAT IT MUST NOT (R17):

     window.LUVIZ.intensity  { amount, x, y }. amount is 0-1 energy; x and y
                             are -1..1 direction. On touch x is ALWAYS 0.
                             This is the ONLY input. Reading a pointer or a
                             scroll event here would break touch parity
                             silently, which is exactly the bug that is
                             impossible to see on the machine you build on.

   WHY IT IS ALLOWED TO ANIMATE AT ALL. The rule the site obeys is that no
   SVG or CSS filter animates over a large area, because those rasterise on
   the CPU per frame. A fragment shader is the GPU's own job: it never
   invalidates layout, never dirties another element's paint, and composites
   like any other fixed layer. See css/dither.css.

   OWNERS: nothing here needs editing. --field-amplitude and --field-cell in
   css/tokens.css are the two numbers worth turning.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* ------------------------------------------------------------------
     1. The constants the contract is stated in
     ------------------------------------------------------------------ */

  /*
    How far the field leans under a full-strength signal, in shader space
    where 1.0 is half the viewport. Small on purpose: this is a ground that
    breathes, not a thing that swims.
  */
  var MAX_LEAN = 0.18;

  /*
    THE TOUCH FLOOR, AND WHY IT EXISTS. intensity.x is 0 on touch by
    contract. If the horizontal lean were the only response, the whole field
    would go inert on a phone while looking perfect on a desktop. So the
    vertical axis always carries at least this fraction of the lean whatever
    the direction, and the axis-free energy carries the rest.

    tests/ditherfield.test.js holds the resulting touch magnitude to at
    least 0.4x the desktop magnitude, which is the parity floor. Note that
    parity is met by keeping the effect BIG on touch, never by shrinking the
    desktop one to match.
  */
  var VERTICAL_FLOOR = 0.5;

  /*
    How fast the field evolves with no input at all. Deliberately slow. The
    period of the slowest term is minutes, so nothing in here can approach
    the 3-per-second flash threshold, and the field never resolves into a
    repeat a visitor could notice.
  */
  var TIME_SPEED = 0.055;

  /*
    Render scale. The dither IS the texture, so drawing at a fraction of the
    device pixels and letting the compositor scale it up costs nothing
    visually and saves a great deal of fill rate. Capped independently of
    devicePixelRatio so a 3x phone does not pay 9x the pixels.
  */
  var RENDER_SCALE = 0.6;
  var MAX_DPR = 1.5;

  /* ------------------------------------------------------------------
     2. Small arithmetic
     ------------------------------------------------------------------ */

  function num(value, fallback) {
    return typeof value === 'number' && !isNaN(value) ? value : fallback;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function clamp01(value) {
    return clamp(num(value, 0), 0, 1);
  }

  function unit(value) {
    return clamp(num(value, 0), -1, 1);
  }

  /* Smoothstep, so the field eases in rather than tracking the signal raw. */
  function ease(t) {
    return t * t * (3 - 2 * t);
  }

  /* ------------------------------------------------------------------
     3. plan() - what gets drawn, decided once
     ------------------------------------------------------------------ */

  /**
   * plan({ reducedMotion, width, height, dpr }) -> descriptor
   *
   * Under reduce this returns an EMPTY layer list (R19). Not a slower field,
   * not a quieter one: none. The field carries no content, so there is
   * nothing to preserve when the decoration goes.
   */
  function plan(options) {
    var opts = options || {};
    var reduced = opts.reducedMotion === true;

    if (reduced) {
      return {
        active: false,
        layers: [],
        renderScale: 0,
        drawWidth: 0,
        drawHeight: 0
      };
    }

    var width = Math.max(1, num(opts.width, 1));
    var height = Math.max(1, num(opts.height, 1));
    var dpr = clamp(num(opts.dpr, 1), 0.5, MAX_DPR);
    var scale = dpr * RENDER_SCALE;

    return {
      active: true,
      /* The two plates of a two-colour job, named for what they print. */
      layers: ['red-plate', 'bone-plate'],
      renderScale: scale,
      drawWidth: Math.max(1, Math.floor(width * scale)),
      drawHeight: Math.max(1, Math.floor(height * scale))
    };
  }

  /* ------------------------------------------------------------------
     4. lean() - the signal, turned into a direction
     ------------------------------------------------------------------ */

  /**
   * lean(amount, x, y, { reducedMotion }) -> { energy, x, y, magnitude }
   *
   * The whole response of the field to the visitor, in one function, so the
   * touch-parity floor is a property that can be proved rather than assumed.
   */
  function lean(amount, x, y, options) {
    var opts = options || {};

    if (opts.reducedMotion === true) {
      return { energy: 0, x: 0, y: 0, magnitude: 0 };
    }

    var energy = ease(clamp01(amount));
    var xn = unit(x);
    var yn = unit(y);

    var lx = MAX_LEAN * energy * xn;

    /* The vertical always carries some of it, whatever the direction,
       because on touch there is no horizontal direction to carry it. */
    var direction = yn < 0 ? -1 : 1;
    var ly = MAX_LEAN * energy *
      (VERTICAL_FLOOR + (1 - VERTICAL_FLOOR) * Math.abs(yn)) * direction;

    return {
      energy: energy,
      /* `|| 0` collapses negative zero, which reads as a real offset to a
         strict equality check and to nobody else. */
      x: lx || 0,
      y: ly || 0,
      magnitude: Math.sqrt(lx * lx + ly * ly) || 0
    };
  }

  /**
   * parseInk('#FF1A1A') -> [1, 0.102, 0.102]
   * The shader is handed the site's real tokens, so this file declares no
   * colour of its own and the palette keeps exactly one home.
   */
  function parseInk(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    var match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!match) {
      return fallback || [1, 1, 1];
    }
    var hex = match[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    ];
  }

  /* ==================================================================
     THE BROWSER HALF
     Everything below needs a document. It declines rather than throws.
     ================================================================== */

  var VERT =
    '#version 300 es\n' +
    'in vec2 p;\n' +
    'void main() { gl_Position = vec4(p, 0.0, 1.0); }\n';

  var FRAG =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 uRes;\n' +
    'uniform float uTime;\n' +
    'uniform vec3 uLean;\n' +      /* energy, x, y - the whole input signal */
    'uniform vec3 uRed;\n' +
    'uniform vec3 uBone;\n' +
    'uniform float uCell;\n' +
    'out vec4 fragColor;\n' +

    /* The 8x8 Bayer threshold map. Built by interleaving the bits of the
       cell coordinates, which is the same 64 numbers as the printed matrix
       and a great deal less shader than a lookup table. */
    'float bayer8(vec2 c) {\n' +
    '  ivec2 k = ivec2(mod(floor(c), 8.0));\n' +
    '  int x = k.x, y = k.y, v = 0;\n' +
    '  v += ((x & 1) ^ ((y >> 1) & 1)) * 32;\n' +
    '  v += ((y & 1) ^ ((x >> 1) & 1)) * 16;\n' +
    '  v += (((x >> 1) & 1) ^ ((y >> 2) & 1)) * 8;\n' +
    '  v += (((y >> 1) & 1) ^ ((x >> 2) & 1)) * 4;\n' +
    '  v += ((x >> 2) & 1) * 2;\n' +
    '  v += ((y >> 2) & 1);\n' +
    '  return float(v) / 64.0;\n' +
    '}\n' +

    'vec2 rot(vec2 v, float a) {\n' +
    '  float s = sin(a), c = cos(a);\n' +
    '  return mat2(c, -s, s, c) * v;\n' +
    '}\n' +

    /* A slow trig field. Four terms at incommensurate rates, so it drifts
       for minutes without ever resolving into a repeat. */
    'float field(vec2 uv, float t) {\n' +
    '  float v = sin(uv.x * 3.1 + t * 0.30);\n' +
    '  v += sin(uv.y * 2.3 - t * 0.23);\n' +
    '  v += sin((uv.x + uv.y) * 2.7 + t * 0.17);\n' +
    '  v += sin(length(uv - vec2(sin(t * 0.11) * 0.4, cos(t * 0.13) * 0.3)) * 4.4 - t * 0.4);\n' +
    '  return v * 0.25;\n' +
    '}\n' +

    'void main() {\n' +
    '  vec2 frag = gl_FragCoord.xy;\n' +
    '  vec2 uv = (frag / uRes) * 2.0 - 1.0;\n' +
    '  uv.x *= uRes.x / uRes.y;\n' +

    /* The visitor leans on the field. One signal, nothing else. */
    '  uv += vec2(uLean.y, -uLean.z);\n' +

    '  float lum = clamp(field(uv, uTime) * 0.5 + 0.5, 0.0, 1.0);\n' +

    /* THE VIGNETTE IS NOT A FIXED FRAME. Its centre wanders and both of its
       radii breathe, so the quiet part of the ground moves around the page
       instead of sitting in the middle like a spotlight that never budges.
       Three incommensurate rates, none of them anywhere near the flash
       threshold: the slowest completes a lap in about a minute and a half.

       The middle is still quieter than the edges on average, which is what
       keeps type off the hot part of the field. A red screen behind red type
       is the one pairing WCAG holds to a stricter threshold than any other,
       so the damping stays even when the centre has wandered. */
    '  vec2 drift = vec2(sin(uTime * 0.070) * 0.42, cos(uTime * 0.053) * 0.30);\n' +

    /* The visitor moves it too, so the ground reacts to a person and not
       only to the clock. uv has ALREADY been leaned on above, so a factor
       above 1 here makes the vignette travel against the field rather than
       with it. That disagreement is what reads as depth: two planes moving
       at different rates. Same one signal as everything else, no second
       input path. */
    '  drift += vec2(uLean.y, -uLean.z) * 1.6;\n' +

    '  float r = length(uv - drift);\n' +
    '  float inner = 0.22 + 0.10 * sin(uTime * 0.091);\n' +
    '  float outer = 1.00 + 0.30 * sin(uTime * 0.061 + 1.7);\n' +
    '  float vig = smoothstep(inner, outer, r);\n' +
    '  lum *= mix(0.15, 1.0, vig);\n' +

    /* A little more presence as the visitor moves, but the ceiling on the
       whole layer is --field-amplitude in CSS and this can never exceed it. */
    '  lum *= 0.85 + 0.15 * uLean.x;\n' +

    /* Chunky screen. The cell is bigger than one pixel, which is what makes
       this read as print rather than as noise. */
    '  vec2 sc = floor(frag / max(uCell, 1.0));\n' +

    /* Two plates at two screen angles, exactly as a two-colour press. */
    '  float redPlate  = step(bayer8(rot(sc, 0.2618)), lum * 0.55);\n' +
    '  float bonePlate = step(bayer8(rot(sc, 0.7854)), max(0.0, lum - 0.62) * 1.5);\n' +

    '  vec3 col = uRed * redPlate * 0.85;\n' +
    '  col = mix(col, uBone, bonePlate * 0.8);\n' +
    '  float a = clamp(redPlate * 0.5 + bonePlate * 0.55, 0.0, 1.0);\n' +
    '  fragColor = vec4(col, a);\n' +
    '}\n';

  function warn(message, err) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('LUVIZMUSIC: ' + message, err || '');
    }
  }

  function readReducedMotion(options) {
    var opts = options || {};
    if (typeof opts.reducedMotion === 'boolean') {
      return opts.reducedMotion;
    }
    if (typeof global.matchMedia !== 'function') {
      return false;
    }
    try {
      return global.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    } catch (err) {
      return false;
    }
  }

  /** The one shared signal. Never a second input path (R17). */
  function signal() {
    if (LUVIZ.scenes && typeof LUVIZ.scenes.signal === 'function') {
      try {
        var shared = LUVIZ.scenes.signal();
        if (shared && typeof shared.on === 'function') {
          return shared;
        }
      } catch (err) {
        warn('the shared intensity signal could not be read.', err);
      }
    }
    if (LUVIZ.signal && typeof LUVIZ.signal.on === 'function') {
      return LUVIZ.signal;
    }
    return null;
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      warn('the dithered ground could not compile.', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  /** Read one custom property off the root, so the inks stay in tokens.css. */
  function token(name, fallback) {
    try {
      var raw = global.getComputedStyle(document.documentElement)
        .getPropertyValue(name);
      return parseInk(raw, fallback);
    } catch (err) {
      return fallback;
    }
  }

  /* ------------------------------------------------------------------
     5. mount()
     ------------------------------------------------------------------ */

  var started = false;

  /**
   * Draw the ground and wire it to the signal. Returns true if it drew,
   * false if anything it needed was missing. It never throws: a failure
   * here loses a decoration, not the page.
   */
  function mount(options) {
    var opts = options || {};
    var doc = opts.document || (typeof global.document !== 'undefined' ? global.document : null);
    if (!doc || typeof doc.getElementById !== 'function' || started) {
      return false;
    }

    var canvas = opts.canvas || doc.getElementById('dither-field');
    if (!canvas || typeof canvas.getContext !== 'function') {
      return false;
    }

    var descriptor = plan({
      reducedMotion: readReducedMotion(opts),
      width: global.innerWidth || 1,
      height: global.innerHeight || 1,
      dpr: global.devicePixelRatio || 1
    });

    /* Under reduce the descriptor is empty and there is nothing to build.
       The element is left inert and css/dither.css keeps it invisible. */
    if (!descriptor.active) {
      canvas.setAttribute('data-state', 'reduced');
      return false;
    }

    var gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        /* The field is redrawn every frame it is asked for, so there is
           nothing to preserve between frames. */
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      });
    } catch (err) {
      gl = null;
    }
    if (!gl) {
      /* No WebGL2. The page keeps css/texture.css's grain, which is the
         floor the art direction was built on. */
      canvas.setAttribute('data-state', 'unsupported');
      return false;
    }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      canvas.setAttribute('data-state', 'unsupported');
      return false;
    }

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      warn('the dithered ground could not link.', gl.getProgramInfoLog(program));
      canvas.setAttribute('data-state', 'unsupported');
      return false;
    }
    gl.useProgram(program);

    /* One full-screen triangle. Cheaper than two, and no seam down the
       diagonal where the dither cells would disagree. */
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(program, 'uRes');
    var uTime = gl.getUniformLocation(program, 'uTime');
    var uLean = gl.getUniformLocation(program, 'uLean');
    var uCell = gl.getUniformLocation(program, 'uCell');

    /* The inks, straight out of css/tokens.css. */
    var red = token('--red-bright', [1, 0.102, 0.102]);
    var bone = token('--ground-bone', [0.961, 0.945, 0.910]);
    gl.uniform3f(gl.getUniformLocation(program, 'uRed'), red[0], red[1], red[2]);
    gl.uniform3f(gl.getUniformLocation(program, 'uBone'), bone[0], bone[1], bone[2]);

    var cell = 3;
    try {
      var declared = parseFloat(
        global.getComputedStyle(document.documentElement).getPropertyValue('--field-cell')
      );
      if (!isNaN(declared) && declared > 0) {
        cell = declared;
      }
    } catch (err) { /* the default stands */ }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function resize() {
      var next = plan({
        reducedMotion: false,
        width: global.innerWidth || 1,
        height: global.innerHeight || 1,
        dpr: global.devicePixelRatio || 1
      });
      canvas.width = next.drawWidth;
      canvas.height = next.drawHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    var resizeTimer = 0;
    global.addEventListener('resize', function () {
      global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(resize, 150);
    });
    resize();

    /* The signal, held as the last value seen. Never an event listener of
       our own: one shared source, or nothing. */
    var current = { energy: 0, x: 0, y: 0 };
    var source = signal();
    if (source) {
      try {
        source.on('change', function (value) {
          var read = value || { amount: 0, x: 0, y: 0 };
          current = lean(read.amount, read.x, read.y);
        });
      } catch (err) {
        warn('the dithered ground could not read the intensity signal.', err);
      }
    }

    canvas.setAttribute('data-state', 'live');
    started = true;

    var startedAt = null;

    function frame(time) {
      /* A hidden tab draws nothing. There is no reason to spend a phone's
         battery on a ground nobody is looking at. */
      if (doc.hidden) {
        return;
      }
      if (startedAt === null) {
        startedAt = time;
      }
      var seconds = (time - startedAt) / 1000;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, seconds * TIME_SPEED * 10);
      gl.uniform3f(uLean, current.energy, current.x, current.y);
      gl.uniform1f(uCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /*
      Driven off GSAP's ticker when there is one, so the whole site runs on a
      single clock and this can never tear against a scrubbed animation.
      Falls back to its own loop if GSAP was blocked.
    */
    if (global.gsap && global.gsap.ticker && typeof global.gsap.ticker.add === 'function') {
      global.gsap.ticker.add(function (t) { frame(t * 1000); });
    } else {
      (function loop(t) {
        frame(t || 0);
        global.requestAnimationFrame(loop);
      })(0);
    }

    return true;
  }

  /* ------------------------------------------------------------------ */

  LUVIZ.ditherField = {
    MAX_LEAN: MAX_LEAN,
    VERTICAL_FLOOR: VERTICAL_FLOOR,
    TIME_SPEED: TIME_SPEED,
    RENDER_SCALE: RENDER_SCALE,
    MAX_DPR: MAX_DPR,

    plan: plan,
    lean: lean,
    parseInk: parseInk,

    mount: mount
  };

  /*
    Self-booting and guarded, because js/app.js is U4's file and this unit
    does not edit it. A throw in here must never stop the rest of the page.
  */
  function bootSafely() {
    try {
      mount();
    } catch (err) {
      warn('the dithered ground could not be drawn.', err);
    }
  }

  if (typeof global.document !== 'undefined' && global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', bootSafely);
    } else {
      bootSafely();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
