'use strict';

/**
 * U12 dithered-ground tests.
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/dither-field.js is split the way U8 and U11 are: a pure, DOM-free half
 * that decides what gets drawn and how the field responds to the signal, and
 * a browser half (`mount`) that compiles the shader. Everything proved here
 * is proved under Node, where there is no `document`, no `matchMedia`, no
 * WebGL and no GSAP, so the arithmetic is judged on its own.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_FILE = path.join(ROOT, 'js', 'dither-field.js');
const CSS_FILE = path.join(ROOT, 'css', 'dither.css');
const TOKENS_FILE = path.join(ROOT, 'css', 'tokens.css');
const INDEX_FILE = path.join(ROOT, 'index.html');

/** Load a classic script into a clean global, the way the browser would. */
function loadFile(file) {
  try {
    delete require.cache[require.resolve(file)];
  } catch (err) {
    /* not previously required */
  }
  require(file);
}

function loadField() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  loadFile(path.join(ROOT, 'js', 'namespace.js'));
  loadFile(MODULE_FILE);
  return globalThis.LUVIZ.ditherField;
}

const field = loadField();

const MODULE_SRC = fs.readFileSync(MODULE_FILE, 'utf8');
const CSS_SRC = fs.readFileSync(CSS_FILE, 'utf8');
const TOKENS_SRC = fs.readFileSync(TOKENS_FILE, 'utf8');
const INDEX_SRC = fs.readFileSync(INDEX_FILE, 'utf8');

/* -------------------------------------------------------------------------
   1. The module loads with no browser at all
   ------------------------------------------------------------------------- */

test('js/dither-field.js loads under Node and publishes its pure half', () => {
  assert.equal(typeof field, 'object');
  for (const fn of ['plan', 'lean', 'parseInk', 'mount']) {
    assert.equal(typeof field[fn], 'function', fn + ' must be published');
  }
});

test('mount() declines rather than throwing when there is no document', () => {
  assert.doesNotThrow(() => field.mount({ document: null }));
  assert.equal(field.mount({ document: null }), false);
});

/* -------------------------------------------------------------------------
   2. Reduced motion returns an EMPTY descriptor list (R19)
   ------------------------------------------------------------------------- */

test('under prefers-reduced-motion the descriptor carries NO layers', () => {
  const descriptor = field.plan({
    reducedMotion: true,
    width: 1400,
    height: 900,
    dpr: 2
  });

  assert.equal(descriptor.active, false);
  assert.deepEqual(descriptor.layers, [], 'the layer list must be empty, not shorter');
  assert.equal(descriptor.drawWidth, 0);
  assert.equal(descriptor.drawHeight, 0);
});

test('under reduce the field has no response to the signal at all', () => {
  const read = field.lean(1, 1, 1, { reducedMotion: true });
  assert.equal(read.energy, 0);
  assert.equal(read.x, 0);
  assert.equal(read.y, 0);
  assert.equal(read.magnitude, 0);
});

test('css/dither.css states the reduced-motion floor in CSS as well', () => {
  assert.match(
    CSS_SRC,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'the decision must survive the script never running'
  );
});

/* -------------------------------------------------------------------------
   3. Two plates, and the resolution is capped
   ------------------------------------------------------------------------- */

test('a live descriptor names exactly the two plates of a two-colour job', () => {
  const descriptor = field.plan({ reducedMotion: false, width: 1400, height: 900, dpr: 1 });
  assert.equal(descriptor.active, true);
  assert.deepEqual(descriptor.layers, ['red-plate', 'bone-plate']);
});

test('the drawing buffer is a fraction of the viewport, and dpr is capped', () => {
  const one = field.plan({ reducedMotion: false, width: 1000, height: 800, dpr: 1 });
  assert.equal(one.drawWidth, Math.floor(1000 * field.RENDER_SCALE));
  assert.equal(one.drawHeight, Math.floor(800 * field.RENDER_SCALE));

  // A 3x phone must not pay 3x the pixels.
  const dense = field.plan({ reducedMotion: false, width: 1000, height: 800, dpr: 3 });
  const capped = field.MAX_DPR * field.RENDER_SCALE;
  assert.equal(dense.drawWidth, Math.floor(1000 * capped));
  assert.ok(dense.renderScale <= field.MAX_DPR * field.RENDER_SCALE + 1e-9);
});

test('plan() never returns a zero or negative buffer for a live field', () => {
  for (const [w, h, dpr] of [[1, 1, 1], [320, 480, 1], [3840, 2160, 2]]) {
    const d = field.plan({ reducedMotion: false, width: w, height: h, dpr });
    assert.ok(d.drawWidth >= 1, 'width stays drawable');
    assert.ok(d.drawHeight >= 1, 'height stays drawable');
  }
});

/* -------------------------------------------------------------------------
   4. Touch parity (the measured constraint, not an opinion)
   ------------------------------------------------------------------------- */

test('on touch, where x is always 0, the field keeps at least 0.4x its desktop magnitude', () => {
  // The worst case for touch is every direction the pointer could point in,
  // measured against the strongest desktop response at the same energy.
  let worst = Infinity;

  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const x = Math.cos(rad);
    const y = Math.sin(rad);

    const desktop = field.lean(1, x, y);
    // The contract: on a touch device intensity.x is ALWAYS 0.
    const touch = field.lean(1, 0, y);

    if (desktop.magnitude > 0) {
      worst = Math.min(worst, touch.magnitude / desktop.magnitude);
    }
  }

  assert.ok(
    worst >= 0.4,
    'touch parity floor is 0.4x desktop; worst ratio was ' + worst.toFixed(3)
  );
});

test('parity is met by keeping touch strong, not by flattening the desktop', () => {
  // If the desktop response had been shrunk to meet the floor, this would fail.
  const desktop = field.lean(1, 1, 1);
  assert.ok(
    desktop.magnitude > field.MAX_LEAN,
    'a full-strength diagonal must exceed a single axis of lean'
  );
});

test('a touch signal with no vertical direction still moves the field', () => {
  // x is 0 by contract and y is 0 here: only the floor keeps this alive.
  const flat = field.lean(1, 0, 0);
  assert.ok(flat.magnitude > 0, 'the vertical floor must carry the axis-free case');
  assert.ok(
    Math.abs(flat.y) >= field.MAX_LEAN * field.VERTICAL_FLOOR - 1e-9,
    'the floor is at least VERTICAL_FLOOR of the lean'
  );
});

/* -------------------------------------------------------------------------
   5. The response is bounded and monotonic
   ------------------------------------------------------------------------- */

test('the lean is capped however hard the signal is pushed', () => {
  for (const [a, x, y] of [[1, 1, 1], [99, 99, 99], [-5, -9, -9], [NaN, NaN, NaN]]) {
    const read = field.lean(a, x, y);
    assert.ok(Number.isFinite(read.magnitude), 'never NaN');
    assert.ok(
      read.magnitude <= field.MAX_LEAN * Math.SQRT2 + 1e-9,
      'the lean can never exceed both axes at full stretch'
    );
  }
});

test('zero energy is zero motion, and energy rises monotonically', () => {
  assert.equal(field.lean(0, 1, 1).magnitude, 0);

  let previous = -1;
  for (let a = 0; a <= 1.0001; a += 0.1) {
    const energy = field.lean(a, 1, 1).energy;
    assert.ok(energy >= previous - 1e-9, 'energy must not fall as amount rises');
    previous = energy;
  }
});

test('negative zero never leaks out as a real offset', () => {
  const read = field.lean(0, -0, -0);
  assert.ok(Object.is(read.x, 0), 'x must be +0');
  assert.ok(Object.is(read.y, 0), 'y must be +0');
});

/* -------------------------------------------------------------------------
   6. The palette keeps one home
   ------------------------------------------------------------------------- */

test('parseInk turns a token into shader floats, and survives rubbish', () => {
  assert.deepEqual(field.parseInk('#000000'), [0, 0, 0]);
  assert.deepEqual(field.parseInk('#ffffff'), [1, 1, 1]);

  const red = field.parseInk('#FF1A1A');
  assert.equal(red[0], 1);
  assert.ok(Math.abs(red[1] - 26 / 255) < 1e-9);

  // Shorthand, and whitespace as getPropertyValue returns it.
  assert.deepEqual(field.parseInk('  #fff  '), [1, 1, 1]);

  // Anything unparseable falls back rather than producing NaN uniforms.
  assert.deepEqual(field.parseInk('rebeccapurple', [1, 1, 1]), [1, 1, 1]);
  assert.deepEqual(field.parseInk('', [0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(field.parseInk(null, [0, 0, 0]), [0, 0, 0]);
});

test('css/dither.css declares no literal colour', () => {
  const hex = CSS_SRC.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || [];
  assert.deepEqual(hex, [], 'every ink comes from css/tokens.css');
  for (const fn of ['rgb(', 'rgba(', 'hsl(', 'hsla(']) {
    assert.ok(!CSS_SRC.includes(fn), 'no ' + fn + ' colour in css/dither.css');
  }
});

test('js/dither-field.js hard-codes no ink: it reads the tokens', () => {
  // The shader is handed uniforms; the values come from getComputedStyle.
  assert.match(MODULE_SRC, /--red-bright/, 'the red comes from the token');
  assert.match(MODULE_SRC, /--ground-bone/, 'the bone comes from the token');

  // Comments are stripped first. A hex in a doc example is documentation,
  // not a declared colour, and parseInk's example is clearer for having one.
  const code = MODULE_SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const hex = code.match(/#[0-9a-fA-F]{6}\b/g) || [];
  assert.deepEqual(hex, [], 'no literal hex colour in the executable module');
});

test('css/tokens.css owns the two numbers the owner would turn', () => {
  assert.match(TOKENS_SRC, /--field-amplitude:\s*[\d.]+/, 'amplitude is a token');
  assert.match(TOKENS_SRC, /--field-cell:\s*[\d.]+/, 'cell size is a token');
  assert.match(TOKENS_SRC, /--layer-field:\s*-1/, 'the field sits behind the content');
});

/* -------------------------------------------------------------------------
   7. The bans this layer could most easily break
   ------------------------------------------------------------------------- */

test('the ground glows nowhere and rasterises nothing on the CPU', () => {
  const banned = [
    ['filter', /(^|[\s;{])filter\s*:/],
    ['backdrop-filter', /backdrop-filter\s*:/],
    ['blur()', /\bblur\s*\(/],
    ['box-shadow', /box-shadow\s*:/],
    ['text-shadow', /text-shadow\s*:/],
    ['content-visibility', /content-visibility\s*:/],
  ];
  const found = banned.filter(([, re]) => re.test(CSS_SRC)).map(([name]) => name);
  assert.deepEqual(found, [], 'css/dither.css must declare none of these');
});

test('the vignette moves: its centre drifts and its radii breathe', () => {
  // A static vignette reads as a spotlight bolted to the middle of the page.
  const vignette = /float\s+inner\s*=([\s\S]*?)float\s+vig\s*=/.exec(MODULE_SRC);
  assert.ok(vignette, 'the shader must compute the vignette radii');
  assert.match(MODULE_SRC, /vec2\s+drift\s*=[^;]*uTime/, 'the centre wanders over time');
  assert.match(MODULE_SRC, /float\s+inner\s*=[^;]*uTime/, 'the inner radius breathes');
  assert.match(MODULE_SRC, /float\s+outer\s*=[^;]*uTime/, 'the outer radius breathes');
  assert.match(MODULE_SRC, /drift\s*\+=[^;]*uLean/, 'and the visitor moves it too');
});

test('every animated rate in the shader stays under the flash bound', () => {
  // Pull every `uTime * n` coefficient straight out of the shader source, so
  // this cannot drift out of date the way a hand-copied constant would.
  const rates = [...MODULE_SRC.matchAll(/uTime\s*\*\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  assert.ok(rates.length >= 3, 'expected the drift and breathing rates');

  for (const rate of rates) {
    const cyclesPerSecond = (field.TIME_SPEED * 10 * rate) / (2 * Math.PI);
    assert.ok(
      cyclesPerSecond < 3,
      'a term at rate ' + rate + ' runs at ' + cyclesPerSecond.toFixed(3) + ' cycles a second'
    );
  }
});

test('the field never animates faster than the flash threshold allows', () => {
  // The slowest term in the shader is the one a visitor could perceive as a
  // pulse. TIME_SPEED scales all of them, and at this value the fastest term
  // completes a cycle in many seconds, nowhere near 3 per second (R20).
  assert.ok(field.TIME_SPEED < 0.2, 'the field drifts, it does not pulse');

  const fastest = 0.4; // the largest per-term rate in the shader source
  const cyclesPerSecond = (field.TIME_SPEED * 10 * fastest) / (2 * Math.PI);
  assert.ok(
    cyclesPerSecond < 3,
    'no term may approach 3 cycles a second; got ' + cyclesPerSecond.toFixed(3)
  );
});

/* -------------------------------------------------------------------------
   The reading scrim: the field is held back where the paragraphs are
   ------------------------------------------------------------------------- */

test('the reading sections lay a scrim over the field, and the hero does not', () => {
  const rule = /\.section:not\(\.section--hero\)\s*\{([\s\S]*?)\}/
    .exec(CSS_SRC);
  assert.ok(rule, 'css/dither.css must hold the field back behind the reading sections');
  assert.match(rule[1], /background-color:\s*color-mix\(/, 'a wash of stock, not a filter');
  assert.match(rule[1], /var\(--ground-near-black\)/, 'the stock keeps one home');
  assert.match(rule[1], /var\(--field-dim\)/, 'the amount is a token the owner can turn');
});

test('the scrim is stated as an exclusion, so a new section is legible by default', () => {
  // A list of sections would silently omit whatever gets built next.
  assert.ok(
    !/\.section--crew[\s,]/.test(CSS_SRC) && !/\.section--mixes[\s,]/.test(CSS_SRC),
    'the scrim must not be an opt-in list of named sections'
  );
});

test('--field-dim is a percentage inside a sane range', () => {
  const match = /--field-dim:\s*([\d.]+)%/.exec(TOKENS_SRC);
  assert.ok(match, 'css/tokens.css must declare --field-dim as a percentage');
  const dim = parseFloat(match[1]);
  assert.ok(dim >= 50 && dim <= 95, 'held back, but the ground is still there: got ' + dim);
});

test('the hero blurb prints harder than the quiet band, because it has no scrim', () => {
  const sections = fs.readFileSync(path.join(ROOT, 'css', 'sections.css'), 'utf8');
  const rule = /\.hero__blurb\s*\{([\s\S]*?)\}/.exec(sections);
  assert.ok(rule, 'css/sections.css must style .hero__blurb');
  assert.match(rule[1], /font-weight:\s*var\(--info-weight\)/, 'upright, not hairline');
  assert.match(rule[1], /opacity:\s*var\(--ink-coverage-full\)/, 'full ink over the field');
});

test('the layer is capped by a token and the script never writes opacity', () => {
  assert.match(CSS_SRC, /opacity:\s*var\(--field-amplitude\)/, 'the ceiling is the token');
  assert.ok(
    !/\.style\.opacity\s*=/.test(MODULE_SRC),
    'the module must not write opacity: the token is the only ceiling'
  );

  const amplitude = parseFloat(/--field-amplitude:\s*([\d.]+)/.exec(TOKENS_SRC)[1]);
  assert.ok(amplitude > 0 && amplitude <= 0.45, 'a ground, not a picture');
});

/* -------------------------------------------------------------------------
   8. One input signal, and only one (R17)
   ------------------------------------------------------------------------- */

test('the field reads the intensity signal and never an input device', () => {
  for (const banned of [
    'pointermove', 'mousemove', 'touchmove', 'touchstart',
    'onscroll', "'scroll'", '"scroll"', 'wheel',
  ]) {
    assert.ok(
      !MODULE_SRC.includes('addEventListener(' + banned) &&
      !MODULE_SRC.includes(banned + ',') || banned === "'scroll'" && false,
      'js/dither-field.js must not listen to ' + banned
    );
  }
  // Positively: it takes the shared signal.
  assert.match(MODULE_SRC, /LUVIZ\.scenes\s*&&/, 'it prefers the shared signal');
  assert.match(MODULE_SRC, /\.on\(\s*'change'/, "it subscribes to 'change'");
});

test('the only listeners the module adds are resize and DOMContentLoaded', () => {
  const listeners = [...MODULE_SRC.matchAll(/addEventListener\(\s*'([a-zA-Z]+)'/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(
    [...new Set(listeners)],
    ['DOMContentLoaded', 'resize'],
    'anything else would be a second input path'
  );
});

/* -------------------------------------------------------------------------
   9. It is actually wired into the page
   ------------------------------------------------------------------------- */

test('index.html carries the canvas, hidden from assistive technology', () => {
  const canvas = /<canvas[^>]*id="dither-field"[^>]*>/.exec(INDEX_SRC);
  assert.ok(canvas, 'index.html must contain the #dither-field canvas');
  assert.match(canvas[0], /aria-hidden="true"/, 'decoration is not content');
  assert.match(canvas[0], /class="dither-field"/);
});

test('the canvas is a direct child of body, outside every transformed ancestor', () => {
  // position: fixed only means what it says outside a transformed ancestor,
  // which is why the masthead and the player bar live here too.
  const body = /<body[^>]*>([\s\S]*?)<main/.exec(INDEX_SRC);
  assert.ok(body, 'index.html must have a body');
  assert.match(body[1], /<canvas[^>]*id="dither-field"/, 'the canvas sits before <main>');
});

test('index.html declares the stylesheet and the script', () => {
  assert.match(INDEX_SRC, /<link[^>]*href="css\/dither\.css"/);
  assert.match(INDEX_SRC, /<script[^>]*src="js\/dither-field\.js"/);
});
