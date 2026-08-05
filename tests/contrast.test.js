'use strict';

/**
 * U3 visual-system tests: palette contrast, two-ink discipline, and the
 * flash-safety bound on the grain overlay.
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * These tests read `css/tokens.css` and `css/texture.css` as text. There is no
 * browser and no CSS library in this project (KTD1: classic scripts, no build
 * step), so the token values are parsed with a small scanner and the WCAG
 * relative-luminance maths is computed here from first principles. That keeps
 * the palette claims in the plan - "#FF1A1A scores 5.105 on #0A0A0A" - under
 * test rather than sitting in a comment.
 *
 * Requirements under test: R2 (two reds, each AA on its own ground),
 * R3 (print artefact, not neon glow), R20 (flash safety).
 * Decisions instantiated: KTD6 (grain is a pre-rendered data URI stepped by
 * transform, no filter animates), KTD9 (exactly two red tokens).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TOKENS_FILE = path.join(ROOT, 'css', 'tokens.css');
const TEXTURE_FILE = path.join(ROOT, 'css', 'texture.css');

/** WCAG 2.2 contrast floors. */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/**
 * R20's ceiling: no repeating effect may change large-area relative luminance
 * by more than 10% between frames. Expressed on the 0..1 relative-luminance
 * scale, matching WCAG 2.3.1's general flash threshold.
 */
const FLASH_LUMINANCE_LIMIT = 0.1;

/** KTD6's step-rate band, in grain positions per second. */
const GRAIN_RATE_MIN = 8;
const GRAIN_RATE_MAX = 12;

/** Misregistration is an off-press artefact, not a drop shadow: 1-3px. */
const MISREG_MIN_PX = 1;
const MISREG_MAX_PX = 3;

// ---------------------------------------------------------------------------
// File access
// ---------------------------------------------------------------------------

function readCss(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    assert.fail(
      'Could not read ' + path.relative(ROOT, file) + ': ' + err.message
    );
    return '';
  }
}

// ---------------------------------------------------------------------------
// A very small CSS scanner. Enough to pull custom properties out and to prove
// the file is structurally sound; deliberately not a full parser.
// ---------------------------------------------------------------------------

/**
 * Drop comments and blank out string bodies, so later brace scanning cannot be
 * confused by punctuation inside a data URI.
 */
function stripCommentsAndStrings(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      assert.ok(end !== -1, 'unterminated /* comment');
      i = end + 2;
      continue;
    }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < css.length && css[i] !== quote) {
        if (css[i] === '\\') i += 1;
        i += 1;
      }
      assert.ok(i < css.length, 'unterminated ' + quote + ' string');
      i += 1;
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Assert braces and parentheses balance and nothing is left open. */
function assertStructurallyValid(css, label) {
  const text = stripCommentsAndStrings(css);
  let brace = 0;
  let paren = 0;
  for (const ch of text) {
    if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    assert.ok(brace >= 0, label + ': a } closes a block that was never opened');
    assert.ok(paren >= 0, label + ': a ) closes a group that was never opened');
  }
  assert.equal(brace, 0, label + ': unbalanced { }');
  assert.equal(paren, 0, label + ': unbalanced ( )');
  assert.ok(
    !/@import/.test(text),
    label + ': @import is banned - the stylesheet order in index.html is the contract'
  );
}

/** Every custom property declared anywhere in the file, last-wins. */
function readCustomProperties(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = new Map();
  const pattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)[;}]/g;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/** Resolve a `var(--x)` reference chain down to a literal. */
function resolveValue(properties, value, depth) {
  const level = depth || 0;
  const text = String(value).trim();
  if (level > 8) return text;
  const match = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/.exec(text);
  if (!match) return text;
  if (properties.has(match[1])) {
    return resolveValue(properties, properties.get(match[1]), level + 1);
  }
  return match[2] ? match[2].trim() : text;
}

/** Every custom property, with var() references resolved to literals. */
function resolvedProperties(css) {
  const raw = readCustomProperties(css);
  const resolved = new Map();
  for (const [name, value] of raw) {
    resolved.set(name, resolveValue(raw, value));
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHexColour(value) {
  return HEX_PATTERN.test(String(value).trim());
}

/** #rgb or #rrggbb to channel fractions in 0..1. */
function parseHex(value) {
  const match = HEX_PATTERN.exec(String(value).trim());
  assert.ok(match, 'not a hex colour: ' + value);
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255
  ];
}

/** sRGB channel to linear light, per WCAG 2.x. */
function toLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB triple in 0..1. */
function relativeLuminance(rgb) {
  return (
    0.2126 * toLinear(rgb[0]) +
    0.7152 * toLinear(rgb[1]) +
    0.0722 * toLinear(rgb[2])
  );
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function round(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/**
 * Is this colour a red ink? Catches a third red creeping in under a name that
 * does not say "red". Hue within 30 degrees of 0, saturated enough to read as
 * an ink rather than a warm neutral.
 */
function isRedHue(rgb) {
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return false;
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25) return false;
  let hue;
  if (max === r) hue = 60 * ((g - b) / delta);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  hue = ((hue % 360) + 360) % 360;
  return hue <= 30 || hue >= 330;
}

// ---------------------------------------------------------------------------
// Grain flash-safety model (R20 / KTD6)
// ---------------------------------------------------------------------------

/**
 * W3C compositing soft-light, per channel: backdrop Cb, source Cs. The grain
 * overlay is a mean-0.5 noise field composited soft-light at
 * `--grain-amplitude`, so this is the blend the browser actually performs.
 */
function softLight(cb, cs) {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

/** One composited channel at overlay opacity `amplitude`. */
function composite(cb, cs, amplitude) {
  return (1 - amplitude) * cb + amplitude * softLight(cb, cs);
}

/**
 * Worst-case frame-to-frame relative-luminance delta over a base colour.
 *
 * The grain steps by translating a fixed noise field, so between two frames a
 * given large area is covered by a different sample of that field. We do not
 * lean on how tightly a fractalNoise field's large-area mean is concentrated;
 * we take the absolute worst case, that mean swinging the whole way from 0 to
 * 1 between consecutive frames. Whatever the field really does, it cannot
 * exceed this.
 */
function grainFrameDelta(rgb, amplitude) {
  const darkFrame = rgb.map(function (c) { return composite(c, 0, amplitude); });
  const lightFrame = rgb.map(function (c) { return composite(c, 1, amplitude); });
  return Math.abs(relativeLuminance(lightFrame) - relativeLuminance(darkFrame));
}

/** The same, maximised across the whole neutral tone scale. */
function worstGrainFrameDelta(amplitude) {
  let worst = 0;
  let worstBase = 0;
  for (let step = 0; step <= 255; step += 1) {
    const base = step / 255;
    const delta = grainFrameDelta([base, base, base], amplitude);
    if (delta > worst) {
      worst = delta;
      worstBase = base;
    }
  }
  return { delta: worst, base: worstBase };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function tokens() {
  return resolvedProperties(readCss(TOKENS_FILE));
}

function colourTokens(properties, prefix) {
  const found = [];
  for (const [name, value] of properties) {
    if (name.startsWith(prefix) && isHexColour(value)) {
      found.push({ name: name, value: value, rgb: parseHex(value) });
    }
  }
  return found;
}

function grounds(properties) {
  return colourTokens(properties, '--ground-');
}

/** Red tokens are named by an exact `red` segment, so `--layered-x` is safe. */
function redTokens(properties) {
  const found = [];
  for (const [name, value] of properties) {
    const segments = name.replace(/^--/, '').split('-');
    if (segments.indexOf('red') !== -1) {
      found.push({ name: name, value: value });
    }
  }
  return found;
}

function requireToken(properties, name) {
  assert.ok(properties.has(name), 'css/tokens.css must declare ' + name);
  return properties.get(name);
}

function numberFrom(value, name) {
  const parsed = parseFloat(String(value));
  assert.ok(
    Number.isFinite(parsed),
    name + ' must be numeric, got ' + JSON.stringify(value)
  );
  return parsed;
}

/** Return the body of every @keyframes block in the file. */
function keyframeBodies(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies = [];
  const pattern = /@keyframes\s+[A-Za-z0-9_-]+\s*\{/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    bodies.push(text.slice(start, i - 1));
  }
  return bodies;
}

/** Return the body of the first @media block matching `condition`. */
function mediaBody(css, condition) {
  const pattern = new RegExp('@media[^{]*' + condition + '[^{]*\\{', 'g');
  const match = pattern.exec(css);
  if (!match) return null;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(start, i - 1);
}

// ---------------------------------------------------------------------------
// The maths itself, checked against known values before it judges the palette
// ---------------------------------------------------------------------------

test('the contrast maths reproduces known WCAG values', function () {
  assert.equal(round(contrastRatio([1, 1, 1], [0, 0, 0]), 2), 21);
  assert.equal(round(contrastRatio([0, 0, 0], [0, 0, 0]), 2), 1);
  // #767676 on white is the canonical 4.54:1 AA boundary case.
  assert.ok(contrastRatio(parseHex('#767676'), [1, 1, 1]) >= 4.5);
  assert.ok(contrastRatio(parseHex('#777777'), [1, 1, 1]) < 4.5);
});

// ---------------------------------------------------------------------------
// R2 / KTD9: the palette
// ---------------------------------------------------------------------------

test('bright red on the near-black ground meets AA for text (R2)', function () {
  const t = tokens();
  const ground = parseHex(requireToken(t, '--ground-near-black'));
  const bright = parseHex(requireToken(t, '--red-bright'));
  const ratio = contrastRatio(bright, ground);
  assert.ok(
    ratio >= AA_TEXT,
    'bright red on near-black is ' + round(ratio, 3) + ':1, needs ' + AA_TEXT
  );
});

test('bone white on the near-black ground meets AA for text (R2)', function () {
  const t = tokens();
  const ground = parseHex(requireToken(t, '--ground-near-black'));
  const bone = parseHex(requireToken(t, '--ink-bone'));
  const ratio = contrastRatio(bone, ground);
  assert.ok(
    ratio >= AA_TEXT,
    'bone on near-black is ' + round(ratio, 3) + ':1, needs ' + AA_TEXT
  );
});

test('deep red on bone white meets AA for text (R2)', function () {
  const t = tokens();
  const bone = parseHex(requireToken(t, '--ground-bone'));
  const deep = parseHex(requireToken(t, '--red-deep'));
  const ratio = contrastRatio(deep, bone);
  assert.ok(
    ratio >= AA_TEXT,
    'deep red on bone is ' + round(ratio, 3) + ':1, needs ' + AA_TEXT
  );
});

test('one red cannot serve both grounds, which is why there are two (KTD9)', function () {
  const t = tokens();
  const nearBlack = parseHex(requireToken(t, '--ground-near-black'));
  const bone = parseHex(requireToken(t, '--ground-bone'));
  const bright = parseHex(requireToken(t, '--red-bright'));
  const deep = parseHex(requireToken(t, '--red-deep'));

  // If either of these ever passes, the second red token is redundant and the
  // decision needs revisiting rather than this test relaxing.
  assert.ok(
    contrastRatio(bright, bone) < AA_TEXT,
    'bright red now passes AA on bone; KTD9 assumed it does not'
  );
  assert.ok(
    contrastRatio(deep, nearBlack) < AA_TEXT,
    'deep red now passes AA on near-black; KTD9 assumed it does not'
  );
});

test('the token file declares exactly two red tokens (KTD9)', function () {
  const t = tokens();
  const names = redTokens(t).map(function (r) { return r.name; }).sort();
  assert.deepEqual(
    names,
    ['--red-bright', '--red-deep'],
    'exactly two red tokens are allowed; found ' + JSON.stringify(names)
  );
});

test('no third red creeps in under a name that does not say red (KTD9)', function () {
  const css = readCss(TOKENS_FILE);
  const raw = readCustomProperties(css);
  assert.ok(raw.size > 0, 'tokens.css declares no custom properties at all');

  const redValues = new Set();
  const literals =
    css.replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || [];
  for (const literal of literals) {
    if (isRedHue(parseHex(literal))) redValues.add(literal.toLowerCase());
  }
  assert.equal(
    redValues.size,
    2,
    'exactly two distinct red inks are allowed; found ' +
      JSON.stringify(Array.from(redValues).sort())
  );
});

test('the palette ships exactly two stocks, near-black and bone', function () {
  const t = tokens();
  const names = grounds(t).map(function (g) { return g.name; }).sort();
  assert.deepEqual(
    names,
    ['--ground-bone', '--ground-near-black'],
    'grounds are the two print stocks; found ' + JSON.stringify(names)
  );
});

// ---------------------------------------------------------------------------
// Focus rings
// ---------------------------------------------------------------------------

test('every declared focus-ring colour clears 3:1 against every ground', function () {
  const t = tokens();
  const rings = colourTokens(t, '--focus-ring');
  const stocks = grounds(t);
  assert.ok(rings.length > 0, 'tokens.css declares no --focus-ring colour');
  assert.ok(stocks.length > 0, 'tokens.css declares no --ground- colour');

  const failures = [];
  for (const ring of rings) {
    for (const stock of stocks) {
      const ratio = contrastRatio(ring.rgb, stock.rgb);
      if (ratio < AA_NON_TEXT) {
        failures.push(
          ring.name + ' on ' + stock.name + ' is ' + round(ratio, 3) + ':1'
        );
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    'focus rings must clear ' + AA_NON_TEXT + ':1 on every ground: ' +
      failures.join('; ')
  );
});

// ---------------------------------------------------------------------------
// R20 / KTD6: grain flash safety
// ---------------------------------------------------------------------------

test('the declared grain amplitude keeps frame-to-frame luminance under 10% (R20)', function () {
  const t = tokens();
  const amplitude = numberFrom(
    requireToken(t, '--grain-amplitude'),
    '--grain-amplitude'
  );
  assert.ok(
    amplitude > 0 && amplitude <= 1,
    '--grain-amplitude must be an opacity in (0, 1], got ' + amplitude
  );

  const worst = worstGrainFrameDelta(amplitude);
  assert.ok(
    worst.delta < FLASH_LUMINANCE_LIMIT,
    'grain at amplitude ' + amplitude + ' shifts large-area relative luminance by ' +
      round(worst.delta, 4) + ' between frames (worst base ' +
      round(worst.base, 3) + '), over the ' + FLASH_LUMINANCE_LIMIT + ' limit'
  );

  for (const stock of grounds(t)) {
    const delta = grainFrameDelta(stock.rgb, amplitude);
    assert.ok(
      delta < FLASH_LUMINANCE_LIMIT,
      'grain over ' + stock.name + ' shifts luminance by ' + round(delta, 4)
    );
  }
});

test('the flash-safety bound is not vacuous: a loud grain fails it', function () {
  // If this ever passes, the model above has stopped measuring anything and
  // the R20 test is decorative.
  const worst = worstGrainFrameDelta(0.5);
  assert.ok(
    worst.delta > FLASH_LUMINANCE_LIMIT,
    'an amplitude of 0.5 should breach the 10% bound but computed ' +
      round(worst.delta, 4)
  );
});

test('the grain steps at 8-12 positions per second (KTD6)', function () {
  const t = tokens();
  const rate = numberFrom(requireToken(t, '--grain-rate'), '--grain-rate');
  assert.ok(
    rate >= GRAIN_RATE_MIN && rate <= GRAIN_RATE_MAX,
    '--grain-rate must sit in ' + GRAIN_RATE_MIN + '-' + GRAIN_RATE_MAX +
      ' positions per second, got ' + rate
  );
});

test('misregistration offsets stay in the 1-3px off-press band', function () {
  const t = tokens();
  for (const name of ['--misreg-x', '--misreg-y']) {
    const px = Math.abs(numberFrom(requireToken(t, name), name));
    assert.ok(
      px >= MISREG_MIN_PX && px <= MISREG_MAX_PX,
      name + ' must be ' + MISREG_MIN_PX + '-' + MISREG_MAX_PX + 'px, got ' + px + 'px'
    );
  }
});

// ---------------------------------------------------------------------------
// R3 / KTD6: the texture layer is print, not glow, and no filter animates
// ---------------------------------------------------------------------------

test('both stylesheets parse: balanced blocks, no stray @import', function () {
  assertStructurallyValid(readCss(TOKENS_FILE), 'css/tokens.css');
  assertStructurallyValid(readCss(TEXTURE_FILE), 'css/texture.css');
});

test('grain turbulence is rendered once and never animated (KTD6)', function () {
  const texture = readCss(TEXTURE_FILE);
  const turbulences = texture.match(/feTurbulence/g) || [];
  assert.equal(
    turbulences.length,
    1,
    'feTurbulence must appear exactly once, pre-rendered to a data URI; found ' +
      turbulences.length
  );
  assert.ok(
    !/(<|%3C)animate/i.test(texture),
    'no SVG animation elements: the filter is static, the transform moves'
  );
  for (const body of keyframeBodies(texture)) {
    assert.ok(
      !/(^|[\s;{])filter\s*:/.test(body),
      'no @keyframes may animate filter - live SVG filters are a no-go (KTD6)'
    );
    assert.ok(
      !/base[Ff]requency/.test(body),
      'no @keyframes may animate baseFrequency (KTD6)'
    );
  }
});

test('the grain overlay is fixed, blended, inert and stepped (KTD6)', function () {
  const texture = readCss(TEXTURE_FILE);
  assert.ok(
    /position\s*:\s*fixed/.test(texture),
    'grain overlay must be position: fixed'
  );
  assert.ok(
    /mix-blend-mode\s*:\s*soft-light/.test(texture),
    'grain overlay must composite with mix-blend-mode: soft-light'
  );
  assert.ok(
    /pointer-events\s*:\s*none/.test(texture),
    'grain overlay must be pointer-events: none'
  );
  assert.ok(
    /steps\(\s*1\b/.test(texture),
    'grain must jump in discrete steps(), not tween'
  );
});

test('reduced motion freezes the grain but keeps the texture', function () {
  const texture = readCss(TEXTURE_FILE);
  const body = mediaBody(texture, 'prefers-reduced-motion\\s*:\\s*reduce');
  assert.ok(body, 'texture.css must handle prefers-reduced-motion: reduce');
  assert.ok(
    /animation\s*:\s*none/.test(body),
    'reduced motion must set animation: none on the grain'
  );
  assert.ok(
    !/background-image\s*:\s*none/.test(body) && !/display\s*:\s*none/.test(body),
    'reduced motion must keep the grain visible, only frozen'
  );
});

test('the texture layer glows nowhere: no shadows, no blur (R3)', function () {
  const texture = readCss(TEXTURE_FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  const banned = [
    ['box-shadow', /box-shadow\s*:/],
    ['text-shadow', /text-shadow\s*:/],
    ['blur()', /\bblur\s*\(/],
    ['drop-shadow()', /\bdrop-shadow\s*\(/],
    ['feGaussianBlur', /feGaussianBlur/]
  ];
  const found = banned
    .filter(function (entry) { return entry[1].test(texture); })
    .map(function (entry) { return entry[0]; });
  assert.deepEqual(
    found,
    [],
    'every effect must be attributable to a press or darkroom process; found ' +
      found.join(', ')
  );
});

test('the texture layer holds no colour of its own (two inks, R3)', function () {
  const texture = readCss(TEXTURE_FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = texture.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || [];
  assert.deepEqual(
    literals,
    [],
    'texture.css must take every colour from a token; found ' + JSON.stringify(literals)
  );
  const named =
    texture.match(
      /:\s*(red|crimson|magenta|cyan|aqua|lime|orange|yellow|blue|fuchsia)\b/g
    ) || [];
  assert.deepEqual(named, [], 'no named CSS colours in texture.css');
});

test('no keyframe flashes the viewport red (R20)', function () {
  const texture = readCss(TEXTURE_FILE);
  for (const body of keyframeBodies(texture)) {
    assert.ok(
      !/--red-/.test(body),
      'no @keyframes may drive a red: R20 bans a full-viewport red flash'
    );
    assert.ok(
      !/(^|[\s;{])background(-color)?\s*:/.test(body),
      'no @keyframes may repaint a background - grain moves by transform only'
    );
  }
});
