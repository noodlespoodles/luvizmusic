'use strict';

/**
 * U11 influences-wall tests (R26, R27, R28, R29).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/influences.js is split the same way U8 is: a pure, DOM-free half that
 * decides the layout, the legibility curve and the beat-flash rotation, and a
 * browser half (`mount`) that turns those decisions into elements. Everything
 * proved here is proved under Node, where there is no `document`, no
 * `matchMedia` and no GSAP, so the arithmetic is judged on its own.
 *
 * The names themselves come from content/influences.js, unmodified, because
 * the promise in R29 is about the owner's real list and not about a fixture.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_FILE = path.join(ROOT, 'js', 'influences.js');
const CONTENT_FILE = path.join(ROOT, 'content', 'influences.js');
const CSS_FILE = path.join(ROOT, 'css', 'influences.css');
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

function loadWall() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  loadFile(path.join(ROOT, 'js', 'namespace.js'));
  loadFile(CONTENT_FILE);
  loadFile(MODULE_FILE);
  return {
    wall: globalThis.LUVIZ.influencesWall,
    names: globalThis.LUVIZ.influences
  };
}

const { wall, names } = loadWall();

const MODULE_SRC = fs.readFileSync(MODULE_FILE, 'utf8');
const CSS_SRC = fs.readFileSync(CSS_FILE, 'utf8');
const INDEX_SRC = fs.readFileSync(INDEX_FILE, 'utf8');

/* -------------------------------------------------------------------------
   1. The list survives the pipeline (R29)
   ------------------------------------------------------------------------- */

test('the shipped list is a non-empty array of plain strings', () => {
  assert.ok(Array.isArray(names), 'content/influences.js must define an array');
  assert.ok(names.length > 50, 'the owner transcribed roughly ninety names');
  for (const name of names) {
    assert.equal(typeof name, 'string');
    assert.ok(name.trim().length > 0, 'no blank entries');
  }
});

test('every name appears exactly once in the generated layout, in source order', () => {
  const plan = wall.layout(names);
  assert.equal(plan.items.length, names.length);

  const seen = new Map();
  plan.items.forEach((item, i) => {
    seen.set(item.name, (seen.get(item.name) || 0) + 1);
    assert.equal(item.index, i, 'items carry their source index');
  });

  for (const name of names) {
    assert.equal(seen.get(name), 1, name + ' must appear exactly once');
  }
  assert.equal(seen.size, new Set(names).size);

  /* Source order is the reading order (R29): the depth layers are a paint
     concern, never a reordering of the content. */
  assert.deepEqual(plan.items.map((item) => item.name), names.slice());
});

test("a name containing an apostrophe survives unescaped", () => {
  const apostrophe = names.filter((n) => n.indexOf("'") !== -1);
  assert.ok(apostrophe.length > 0, "the shipped list contains TRUS'ME");
  assert.ok(apostrophe.indexOf("TRUS'ME") !== -1);

  const plan = wall.layout(["TRUS'ME", 'RON TRENT', "D'MARC"]);
  assert.equal(plan.items[0].name, "TRUS'ME");
  assert.equal(plan.items[2].name, "D'MARC");
  assert.ok(plan.items[0].id.length > 0, 'an id is still derivable');
  assert.ok(!/&#|&apos|\\'/.test(plan.items[0].name), 'no escaping crept in');

  const picked = wall.flash(plan, 0, []);
  for (const name of picked.names) {
    assert.ok(plan.items.some((item) => item.name === name));
  }
});

/* -------------------------------------------------------------------------
   2. The field is art-directed, not shuffled (R26)
   ------------------------------------------------------------------------- */

test('the layout is deterministic: the same list gives the same layout twice', () => {
  const a = wall.layout(names);
  const b = wall.layout(names);
  assert.deepEqual(a, b);

  /* And across a fresh load of the module, so nothing is seeded from a clock
     or from Math.random. */
  const reloaded = loadWall();
  assert.deepEqual(reloaded.wall.layout(names), a);
});

test('nothing in the module reaches for Math.random or the clock', () => {
  assert.ok(!/Math\.random/.test(MODULE_SRC), 'a shuffling layout is noise, not art direction');
  assert.ok(!/new Date\(\)|Date\.now\(\)\s*%/.test(MODULE_SRC));
});

test('the field is composed across three or four depth layers in different scale bands', () => {
  const plan = wall.layout(names);
  assert.ok(wall.LAYERS.length >= 3 && wall.LAYERS.length <= 4);

  const steps = new Set();
  const depths = new Set();
  for (const layer of wall.LAYERS) {
    assert.equal(typeof layer.id, 'string');
    assert.equal(typeof layer.step, 'string');
    assert.ok(/^--step-/.test(layer.step), 'scale comes from the css/type.css scale');
    assert.equal(typeof layer.depth, 'number');
    steps.add(layer.step);
    depths.add(layer.depth);
  }
  assert.equal(steps.size, wall.LAYERS.length, 'each layer sits in its own scale band');
  assert.equal(depths.size, wall.LAYERS.length, 'each layer parallaxes at its own rate');

  /* Every layer is actually used, and every item lands on a real one. */
  const used = new Set(plan.items.map((item) => item.layer));
  assert.equal(used.size, wall.LAYERS.length);
  for (const item of plan.items) {
    assert.ok(wall.LAYERS.some((layer) => layer.id === item.layer));
    assert.equal(typeof item.rotate, 'number');
    assert.ok(Math.abs(item.rotate) <= wall.MAX_ROTATION_DEG);
  }
});

test('the largest band bleeds past the edge rather than shrinking to timidity', () => {
  const biggest = wall.LAYERS[wall.LAYERS.length - 1];
  assert.ok(biggest.bleed === true, 'the nearest layer is allowed off the trim edge');
  assert.ok(/bleed/.test(CSS_SRC), 'css/influences.css carries the bleed rule');
});

/* -------------------------------------------------------------------------
   3. Legibility is intensity, inverted (R27)
   ------------------------------------------------------------------------- */

test('at amount 0 the plates sit in register and the names are fully legible', () => {
  for (const [x, y] of [[0, 0], [1, 1], [-1, 0.5], [0, -1]]) {
    const read = wall.legibility(0, x, y);
    assert.equal(read.dx, 0, 'no horizontal plate offset at rest');
    assert.equal(read.dy, 0, 'no vertical plate offset at rest');
    assert.equal(read.separation, 0);
    assert.equal(read.ghost, 0, 'the ghost plates are invisible at rest');
    assert.equal(read.inkOpacity, 1, 'the true impression is at full strength');
    assert.equal(read.legibility, 1);
  }
});

test('legibility is monotonic in amount: more intensity is never more legible', () => {
  for (const [x, y] of [[1, 0], [0, 1], [0, 0], [-0.4, -0.9], [0.6, 0.2]]) {
    let previous = wall.legibility(0, x, y);
    for (let step = 1; step <= 40; step++) {
      const amount = step / 40;
      const read = wall.legibility(amount, x, y);
      assert.ok(
        read.legibility <= previous.legibility + 1e-9,
        'legibility must not rise with amount at ' + amount
      );
      assert.ok(
        read.separation >= previous.separation - 1e-9,
        'separation must not fall with amount at ' + amount
      );
      assert.ok(read.inkOpacity <= previous.inkOpacity + 1e-9);
      assert.ok(read.ghost >= previous.ghost - 1e-9);
      previous = read;
    }
  }
});

test('separation is clamped at the stated maximum whatever the input magnitude', () => {
  assert.equal(typeof wall.MAX_SEPARATION_PX, 'number');
  assert.ok(wall.MAX_SEPARATION_PX > 0);

  const wild = [
    [1, 1e6, -1e6],
    [1e9, 1, 1],
    [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [0.5, -1e4, 1e4],
    [1, Infinity, -Infinity],
    [1, NaN, NaN]
  ];
  for (const [amount, x, y] of wild) {
    const read = wall.legibility(amount, x, y);
    assert.ok(Number.isFinite(read.dx), 'dx stays a number for ' + x);
    assert.ok(Number.isFinite(read.dy), 'dy stays a number for ' + y);
    assert.ok(Number.isFinite(read.separation));
    assert.ok(
      read.separation <= wall.MAX_SEPARATION_PX + 1e-9,
      'separation ' + read.separation + ' exceeded the cap'
    );
    assert.ok(read.ghost >= 0 && read.ghost <= 1);
    assert.ok(read.inkOpacity >= 0 && read.inkOpacity <= 1);
  }
});

test('on touch, where intensity.x is 0 by contract, the effect does not flatten', () => {
  const rest = wall.legibility(0, 0, 0);
  const moving = wall.legibility(1, 0, 0);

  assert.equal(moving.dx, 0, 'no horizontal cue is available on touch');
  assert.ok(Math.abs(moving.dy) > 0, 'the vertical axis must still carry the smear');
  assert.ok(moving.separation > wall.MAX_SEPARATION_PX * 0.25, 'and carry a real amount of it');
  assert.ok(moving.ghost > rest.ghost, 'opacity is the second, axis-free cue');
  assert.ok(moving.inkOpacity < rest.inkOpacity);
  assert.ok(moving.legibility < 0.2, 'the wall does go illegible on a phone');

  /* A pure vertical flick still resolves in both directions. */
  assert.ok(wall.legibility(1, 0, 1).dy > 0);
  assert.ok(wall.legibility(1, 0, -1).dy < 0);
});

test('the depth layers parallax off the one signal, and never off an input device', () => {
  assert.ok(!/pointermove|mousemove|touchmove|['"]scroll['"]|wheel/.test(MODULE_SRC),
    'the wall reads window.LUVIZ.intensity and nothing else (R17)');

  const near = wall.parallax(wall.LAYERS[wall.LAYERS.length - 1], 1, 1);
  const far = wall.parallax(wall.LAYERS[0], 1, 1);
  assert.ok(Math.abs(near.x) > Math.abs(far.x), 'nearer layers travel further');
  assert.ok(Math.abs(near.y) > Math.abs(far.y));

  const still = wall.parallax(wall.LAYERS[0], 0, 0);
  assert.equal(still.x, 0);
  assert.equal(still.y, 0);

  for (const layer of wall.LAYERS) {
    const wildest = wall.parallax(layer, 1e6, -1e6);
    assert.ok(Math.abs(wildest.x) <= wall.MAX_PARALLAX_PX + 1e-9);
    assert.ok(Math.abs(wildest.y) <= wall.MAX_PARALLAX_PX + 1e-9);
  }
});

/* -------------------------------------------------------------------------
   4. The beat flash (R28, R20)
   ------------------------------------------------------------------------- */

test('the beat-flash selector returns at most the stated maximum per boundary', () => {
  const plan = wall.layout(names);
  assert.equal(typeof wall.FLASH_MAX, 'number');
  assert.ok(wall.FLASH_MAX <= 6, 'a handful, not a wall');

  let previous = [];
  for (let boundary = 0; boundary < 400; boundary++) {
    const picked = wall.flash(plan, boundary, previous);
    assert.ok(Array.isArray(picked.names));
    assert.ok(picked.names.length <= wall.FLASH_MAX, 'boundary ' + boundary);
    assert.ok(picked.names.length > 0, 'a boundary that lights nothing is a dead effect');
    assert.equal(new Set(picked.names).size, picked.names.length, 'no name twice in one flash');
    previous = picked.names;
  }
});

test('the beat flash never lights the same name on two consecutive boundaries', () => {
  const plan = wall.layout(names);
  let previous = [];
  for (let boundary = 0; boundary < 400; boundary++) {
    const picked = wall.flash(plan, boundary, previous);
    for (const name of picked.names) {
      assert.ok(previous.indexOf(name) === -1,
        name + ' was still lit from the previous boundary');
    }
    previous = picked.names;
  }
});

test('the beat flash is deterministic for the same boundary and history', () => {
  const plan = wall.layout(names);
  const previous = wall.flash(plan, 11, []).names;
  const once = wall.flash(plan, 12, previous);
  const twice = wall.flash(plan, 12, previous);
  assert.deepEqual(once, twice);
});

test('the flash is small in area and never red on red', () => {
  const plan = wall.layout(names);

  /* Bone ink on the near-black ground. Red-on-red is the one pairing that
     WCAG treats more strictly than any other, and red is the whole palette. */
  assert.equal(wall.FLASH_INK, 'bone');

  let previous = [];
  for (let boundary = 0; boundary < 200; boundary++) {
    const picked = wall.flash(plan, boundary, previous);
    assert.equal(picked.ink, 'bone');
    for (const item of picked.items) {
      assert.notEqual(item.ink, 'red', item.name + ' would flash red on red');
      assert.ok(item.flashable, 'only small-area names are eligible');
      const layer = wall.LAYERS.filter((l) => l.id === item.layer)[0];
      assert.ok(!layer.bleed, 'a bleeding name is not a small area');
    }
    assert.ok(
      picked.names.length / plan.items.length <= wall.MAX_FLASH_AREA,
      'the lit fraction stays far below a full-viewport change'
    );
    previous = picked.names;
  }
});

test('the flash rotation is inert when nothing drives it', () => {
  const plan = wall.layout(names);
  assert.deepEqual(wall.flash(plan, 0, []).names, wall.flash(plan, 0, []).names);
  /* The shipped mixes carry no tempo maps, so the clock never emits. The
     module must still be correct, and must not synthesise its own beat. */
  assert.ok(!/setInterval|setTimeout\(\s*tick/.test(MODULE_SRC),
    'the wall does not invent a beat of its own');
});

/* -------------------------------------------------------------------------
   5. Reduced motion keeps the content and drops the treatment (R29, R19)
   ------------------------------------------------------------------------- */

test('under reduced motion the module reports a static, legible layout', () => {
  const plan = wall.layout(names, { reducedMotion: true });

  assert.equal(plan.reducedMotion, true);
  assert.equal(plan.items.length, names.length);
  assert.deepEqual(plan.items.map((item) => item.name), names.slice());

  for (const item of plan.items) {
    assert.equal(item.layer, wall.STATIC_LAYER, 'one plain band, no depth');
    assert.equal(item.rotate, 0, 'nothing is tilted');
    assert.equal(item.parallax, 0);
    assert.equal(item.flashable, false, 'nothing flashes');
    assert.equal(item.ink, 'bone', 'the full list is set in the legible ink');
  }
});

test('under reduced motion every offset is zero at every amount', () => {
  for (const amount of [0, 0.25, 0.5, 0.75, 1, 12]) {
    for (const [x, y] of [[0, 0], [1, 1], [-1, -1]]) {
      const read = wall.legibility(amount, x, y, { reducedMotion: true });
      assert.equal(read.dx, 0);
      assert.equal(read.dy, 0);
      assert.equal(read.separation, 0);
      assert.equal(read.ghost, 0);
      assert.equal(read.inkOpacity, 1);
      assert.equal(read.legibility, 1);
    }
  }
  for (const layer of wall.LAYERS) {
    const moved = wall.parallax(layer, 1, 1, { reducedMotion: true });
    assert.equal(moved.x, 0);
    assert.equal(moved.y, 0);
  }
  const picked = wall.flash(wall.layout(names, { reducedMotion: true }), 3, []);
  assert.deepEqual(picked.names, []);
});

/* -------------------------------------------------------------------------
   6. Compositor and palette discipline
   ------------------------------------------------------------------------- */

test('the wall animates transform and opacity only', () => {
  assert.ok(!/backdrop-filter/.test(CSS_SRC), 'no backdrop-filter');
  assert.ok(!/content-visibility/.test(CSS_SRC), 'content-visibility breaks ScrollTrigger');
  assert.ok(!/feTurbulence|filter:\s*url\(/.test(CSS_SRC), 'no animated SVG filters');

  const transitions = CSS_SRC.match(/transition:[^;]+;/g) || [];
  for (const rule of transitions) {
    assert.ok(/^transition:\s*(none|(transform|opacity|color)[^;]*)$/.test(rule.replace(/;$/, '')),
      'only transform, opacity and colour transition: ' + rule);
  }
});

test('css/influences.css declares no literal colour', () => {
  const stripped = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(stripped), 'no hex literals');
  assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/.test(stripped), 'no colour functions');
  assert.ok(/var\(--ink-bone\)|var\(--red-/.test(stripped), 'colour comes from the tokens');
});

test('the wall reuses the U3 misregistration primitives rather than reinventing them', () => {
  assert.ok(/--misreg-x|misreg/.test(CSS_SRC), 'composed from css/texture.css');
});

/* -------------------------------------------------------------------------
   7. Wiring
   ------------------------------------------------------------------------- */

test('index.html carries the section, the content file, the module and the stylesheet', () => {
  assert.ok(/<section id="influences"/.test(INDEX_SRC));
  assert.ok(/content\/influences\.js/.test(INDEX_SRC));
  assert.ok(/js\/influences\.js/.test(INDEX_SRC));
  assert.ok(/css\/influences\.css/.test(INDEX_SRC));

  const influences = INDEX_SRC.indexOf('<section id="influences"');
  const mixes = INDEX_SRC.indexOf('<section id="mixes"');
  const events = INDEX_SRC.indexOf('<section id="events"');
  assert.ok(mixes > -1 && events > -1);
  assert.ok(influences > mixes, 'the wall sits after the mixes');
  assert.ok(influences < events, 'and before the dates');

  /* content/influences.js must load before js/influences.js reads it. */
  assert.ok(
    INDEX_SRC.indexOf('src="content/influences.js"') < INDEX_SRC.indexOf('src="js/influences.js"'),
    'the names must be on the page before the module that draws them'
  );

  /* R29: the names are real text, so a screen reader gets the list and only
     the decorative duplicates are hidden from it. */
  assert.ok(/aria-hidden['"],\s*['"]true|aria-hidden="true"/.test(MODULE_SRC),
    'the offset plates are aria-hidden duplicates');
});

test('the module boots defensively, the way js/app.js expects', () => {
  assert.equal(typeof wall.mount, 'function');
  /* No document in Node: mount must decline rather than throw. */
  assert.doesNotThrow(() => wall.mount());
  assert.equal(wall.mount(), false);
});

test('SplitText is used for the per-line treatment on resolved names', () => {
  assert.ok(/SplitText/.test(MODULE_SRC), 'KTD2 pinned SplitText for exactly this');
  assert.ok(/typeof\s+\w*\.?SplitText|typeof SplitText/.test(MODULE_SRC),
    'and it is feature-detected, so a blocked CDN cannot stop the page');
});

/* -------------------------------------------------------------------------
   9. The bleed cannot reach the document (R18)
   -------------------------------------------------------------------------
   The bleeding band is drawn wider than the screen on purpose, so SOMETHING
   has to clip it or the whole page scrolls sideways.

   That containment used to be written against the section the wall happened
   to sit in. When the wall moved into the contact section the rule was left
   behind pointing at `.section--influences`, a class no element carried any
   more: it matched nothing, nothing clipped, and a 390px phone got an 857px
   document with a fixed masthead stretched across all of it.

   These two tests are the fence around that. The first says the clip lives
   on the wall itself, so it travels with the thing that bleeds. The second
   says no clip in this stylesheet may name a class index.html does not
   actually use, which is the general shape of the bug.
   ------------------------------------------------------------------------- */

/** Selectors of every rule in css/influences.css that clips horizontally. */
function horizontalClipSelectors() {
  /* Comments first: this stylesheet carries more prose than declarations. */
  const source = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(source)) !== null) {
    if (/overflow-x\s*:\s*clip/.test(match[2])) {
      found.push(match[1].replace(/\s+/g, ' ').trim());
    }
  }
  return found;
}

/** The classes index.html actually puts on the wall root. */
function wallClasses() {
  const tag = INDEX_SRC.match(/<div[^>]*id="influences-wall"[^>]*>/);
  assert.ok(tag, 'index.html has a wall root for the clip to sit on');
  const attr = tag[0].match(/class="([^"]*)"/);
  return attr ? attr[1].trim().split(/\s+/) : [];
}

/** Does `selector` name `.cls` itself, rather than a longer class sharing it? */
function selectorNames(selector, cls) {
  return new RegExp('\\.' + cls + '(?![\\w-])').test(selector);
}

test('the wall clips its own bleed, so the page never scrolls sideways (R18)', () => {
  const selectors = horizontalClipSelectors();
  assert.ok(selectors.length > 0, 'css/influences.css declares no horizontal clip at all');

  const carried = wallClasses();
  assert.ok(
    selectors.some((selector) => carried.some((cls) => selectorNames(selector, cls))),
    'the clip must be declared on a class the wall root itself carries (' +
    carried.join(', ') + '), not on whichever section happens to host it. Found: ' +
    selectors.join(' | ')
  );

  /* `hidden` first, `clip` second. Safari before 16 has no `clip` at all and
     would otherwise be left with no containment whatsoever. */
  assert.match(
    CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, ''),
    /overflow-x:\s*hidden;\s*overflow-x:\s*clip/,
    'the clip keeps its overflow-x: hidden fallback for Safari before 16'
  );
});

test('no clip in this stylesheet names a class index.html has dropped', () => {
  const selectors = horizontalClipSelectors();
  assert.ok(selectors.length > 0, 'css/influences.css declares no horizontal clip at all');

  selectors.forEach((selector) => {
    (selector.match(/\.[A-Za-z_][\w-]*/g) || []).forEach((dotted) => {
      const cls = dotted.slice(1);
      assert.ok(
        new RegExp('class="[^"]*\\b' + cls + '(?![\\w-])').test(INDEX_SRC),
        'the clip rule "' + selector + '" targets .' + cls + ', which nothing in ' +
        'index.html carries - so it clips nothing and the bleed reaches the document'
      );
    });
  });
});
