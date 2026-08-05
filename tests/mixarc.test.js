'use strict';

/**
 * U1 mix-arc-model tests (R1, R3, R4, R6, R15, KTD1, KTD2, KTD6).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/mix-arc-model.js is the DOM-free half of the mixes arc. It decides how
 * big the circle is, how far apart the cards sit, and what one slot looks
 * like at one rotation. None of that needs a browser, so all of it is proved
 * here. js/mix-arc.js is the browser half and is verified by dragging it.
 *
 * THESE TESTS FIX RELATIONSHIPS, NOT NUMBERS. The calibration constants in
 * the module were read off the reference and are expected to be nudged
 * against a real browser. What must not drift is the behaviour underneath
 * them: the circle closes exactly, a bigger circle gives a shallower step,
 * a card turns with the ring, and the arrow keys walk the owner's mixes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODEL_FILE = path.join(ROOT, 'js', 'mix-arc-model.js');

/** Load the classic browser script under Node, exactly as index.html would. */
function loadModel() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  try {
    delete require.cache[require.resolve(MODEL_FILE)];
  } catch (err) {
    /* not previously required - the require below reports it */
  }
  require(MODEL_FILE);
  const model = globalThis.LUVIZ && globalThis.LUVIZ.mixArcModel;
  assert.ok(model, 'js/mix-arc-model.js must define window.LUVIZ.mixArcModel');
  return model;
}

/** Source with block comments removed, so prose cannot satisfy a check. */
function readCode(file) {
  return fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The widths every geometry rule is checked across. */
const WIDTHS = [320, 375, 414, 568, 768, 1024, 1280, 1440, 1680, 1920, 2560];

// ---------------------------------------------------------------------------
// KTD6: the module is pure
// ---------------------------------------------------------------------------

test('the model never touches the DOM', () => {
  const code = readCode(MODEL_FILE);
  for (const forbidden of ['document', 'matchMedia', 'querySelector', 'getElementById']) {
    assert.ok(
      !code.includes(forbidden),
      `js/mix-arc-model.js must stay DOM-free, but its code mentions ${forbidden}`
    );
  }
});

test('the model loads under Node with no browser globals', () => {
  const model = loadModel();
  assert.equal(typeof model.geometry, 'function');
  assert.equal(typeof model.place, 'function');
  assert.equal(typeof model.wrap, 'function');
});

// ---------------------------------------------------------------------------
// KTD1: the geometry, and the invariant that lets the ring wrap
// ---------------------------------------------------------------------------

test('a whole number of slots closes the circle exactly, at every width', () => {
  const model = loadModel();
  for (const width of WIDTHS) {
    const g = model.geometry(width);
    assert.ok(Number.isInteger(g.slotCount), `slotCount must be whole at ${width}`);
    /* The seam test: if this is not 360 the wheel jumps once per turn. */
    assert.ok(
      Math.abs(g.slotCount * g.step - 360) < 1e-9,
      `slotCount * step must be exactly 360 at ${width}, got ${g.slotCount * g.step}`
    );
  }
});

test('the step stays inside the band that reads as an arc', () => {
  const model = loadModel();
  for (const width of WIDTHS) {
    const g = model.geometry(width);
    assert.ok(
      g.step >= model.STEP_MIN_DEG - 1 && g.step <= model.STEP_MAX_DEG + 1,
      `step at ${width} was ${g.step}, outside the ${model.STEP_MIN_DEG}-${model.STEP_MAX_DEG} band`
    );
  }
});

test('a bigger circle gives a shallower step at a fixed card width', () => {
  const model = loadModel();
  /*
    This is the relationship KTD1 turns on: shallow-step-over-large-radius is
    what separates an arc from a fan of playing cards. It is asserted on
    stepFor() rather than on geometry(), because card width and radius clamp
    at different viewport widths, so the step across viewports is NOT
    monotonic - it widens through the band where the card is still growing
    and the radius has already hit its floor. The underlying rule still holds
    and is what the module actually encodes.
  */
  const shallow = model.stepFor(240, 3200);
  const middle = model.stepFor(240, 2400);
  const steep = model.stepFor(240, 1600);
  assert.ok(shallow < middle, 'a 3200px circle must step shallower than a 2400px one');
  assert.ok(middle < steep, 'a 2400px circle must step shallower than a 1600px one');
});

test('a wider card needs a wider step at a fixed radius', () => {
  const model = loadModel();
  assert.ok(model.stepFor(270, 2800) > model.stepFor(180, 2800));
});

test('card width clamps to the reference band', () => {
  const model = loadModel();
  assert.equal(model.geometry(320).cardWidth, model.CARD_MIN, 'narrow viewport takes the floor');
  assert.equal(model.geometry(2560).cardWidth, model.CARD_MAX, 'wide viewport takes the ceiling');
  const mid = model.geometry(700).cardWidth;
  assert.ok(mid > model.CARD_MIN && mid < model.CARD_MAX, 'mid viewport scales between them');
});

test('radius clamps to its own band and never shrinks as the viewport grows', () => {
  const model = loadModel();
  assert.equal(model.geometry(320).radius, model.RADIUS_MIN);
  assert.equal(model.geometry(2560).radius, model.RADIUS_MAX);
  for (let i = 1; i < WIDTHS.length; i++) {
    assert.ok(
      model.geometry(WIDTHS[i]).radius >= model.geometry(WIDTHS[i - 1]).radius,
      `radius must not shrink between ${WIDTHS[i - 1]} and ${WIDTHS[i]}`
    );
  }
});

test('a nonsense viewport falls to the narrow floor rather than NaN', () => {
  const model = loadModel();
  for (const bad of [0, -1000, NaN, Infinity, undefined, null]) {
    const g = model.geometry(bad);
    assert.equal(g.cardWidth, model.CARD_MIN, `cardWidth for ${bad}`);
    assert.equal(g.radius, model.RADIUS_MIN, `radius for ${bad}`);
    assert.ok(Number.isFinite(g.step) && g.step > 0, `step for ${bad} must be a real angle`);
    assert.ok(Number.isInteger(g.slotCount) && g.slotCount >= 3, `slotCount for ${bad}`);
  }
});

test('a zero or negative radius cannot divide by zero', () => {
  const model = loadModel();
  for (const bad of [0, -50, NaN]) {
    const step = model.stepFor(240, bad);
    assert.ok(Number.isFinite(step) && step > 0, `stepFor(240, ${bad}) must be a real angle`);
  }
});

// ---------------------------------------------------------------------------
// KTD2 and R3: one cosine, five decisions
// ---------------------------------------------------------------------------

test('the slot dead ahead is fully lit, largest, highest and clickable', () => {
  const model = loadModel();
  const front = model.place(0, 8, 0);
  assert.ok(Math.abs(front.depth - 1) < 1e-9, 'depth dead ahead is 1');
  assert.equal(front.scale, model.SCALE_MAX);
  assert.ok(Math.abs(front.opacity - 1) < 1e-9);
  assert.equal(front.zIndex, 200);
  assert.equal(front.clickable, true);
});

test('a slot round the back is culled and unclickable', () => {
  const model = loadModel();
  const back = model.place(0, 8, 180);
  assert.ok(back.depth <= 0, 'half a turn away is behind the wheel');
  assert.equal(back.opacity, 0, 'a culled slot is fully transparent');
  assert.equal(back.clickable, false);
  assert.equal(back.scale, model.SCALE_MIN);
});

test('a card turns with the ring rather than staying upright (KTD2)', () => {
  const model = loadModel();
  /*
    The upright-card ellipse was the prototype's approach and KTD2 rejects it.
    If `rotate` ever comes back as a constant, the lean is gone and so is the
    signature of the display mode.
  */
  const step = 8;
  for (const i of [0, 1, 2, 3, 7]) {
    for (const spin of [0, -12, 33.5]) {
      assert.ok(
        Math.abs(model.place(i, step, spin).rotate - (i * step + spin)) < 1e-9,
        `slot ${i} at spin ${spin} must lean by its own angle`
      );
    }
  }
  assert.notEqual(model.place(3, step, 0).rotate, model.place(0, step, 0).rotate);
});

test('spinning the ring by one step hands the next slot the front position', () => {
  const model = loadModel();
  const step = 360 / 44;
  const before = model.place(1, step, 0);
  const after = model.place(1, step, -step);
  assert.ok(after.depth > before.depth, 'the slot rotates toward the viewer');
  assert.ok(Math.abs(after.depth - 1) < 1e-9, 'and lands dead ahead');
});

test('opacity, scale and z-index all rise with depth', () => {
  const model = loadModel();
  const step = 8;
  let previous = null;
  /* Walk from a quarter turn away back to dead ahead. */
  for (let spin = -88; spin <= 0; spin += 8) {
    const now = model.place(0, step, spin);
    if (previous) {
      assert.ok(now.depth >= previous.depth, 'depth rises');
      assert.ok(now.scale >= previous.scale, 'scale rises with depth');
      assert.ok(now.opacity >= previous.opacity, 'opacity rises with depth');
      assert.ok(now.zIndex >= previous.zIndex, 'z-index rises with depth');
    }
    previous = now;
  }
});

test('z-index is always a non-negative integer', () => {
  const model = loadModel();
  for (let spin = 0; spin < 360; spin += 7) {
    for (const i of [0, 5, 21, 43]) {
      const p = model.place(i, 8.18, spin);
      assert.ok(Number.isInteger(p.zIndex), 'z-index must be a whole number');
      assert.ok(p.zIndex >= 0, 'z-index must never go negative');
    }
  }
});

test('the click threshold is a hard edge, not a fade', () => {
  const model = loadModel();
  const edge = (Math.acos(model.CLICK_THRESHOLD) * 180) / Math.PI;
  assert.equal(model.place(0, 0, edge - 0.5).clickable, true, 'just inside the threshold');
  assert.equal(model.place(0, 0, edge + 0.5).clickable, false, 'just outside it');
});

test('a lit but half-turned card can be seen and still not be clicked', () => {
  const model = loadModel();
  /* This is the pairing that stops a card you can barely see stealing a tap. */
  const halfTurned = model.place(0, 0, 70);
  assert.ok(halfTurned.opacity > 0, 'still faintly visible');
  assert.equal(halfTurned.clickable, false, 'but not a fair target');
});

// ---------------------------------------------------------------------------
// R6: the arrow keys walk the owner's list, not the padding
// ---------------------------------------------------------------------------

test('wrap walks the real mixes and wraps at both ends', () => {
  const model = loadModel();
  assert.equal(model.wrap(0, 10), 0);
  assert.equal(model.wrap(9, 10), 9);
  assert.equal(model.wrap(10, 10), 0, 'past the end wraps to the start');
  assert.equal(model.wrap(-1, 10), 9, 'before the start wraps to the end');
  assert.equal(model.wrap(-11, 10), 9, 'and keeps wrapping');
  assert.equal(model.wrap(25, 10), 5);
});

test('wrap survives an empty or nonsense mix list', () => {
  const model = loadModel();
  for (const count of [0, -3, NaN, undefined, null]) {
    assert.equal(model.wrap(4, count), 0, `wrap with count ${count}`);
  }
  assert.equal(model.wrap(NaN, 10), 0);
});

test('wrap never returns an index outside the real list', () => {
  const model = loadModel();
  const count = 7;
  for (let i = -30; i <= 30; i++) {
    const w = model.wrap(i, count);
    assert.ok(Number.isInteger(w) && w >= 0 && w < count, `wrap(${i}, ${count}) = ${w}`);
  }
});

// ---------------------------------------------------------------------------
// U5 / KTD4: a clone is scenery, and must stay invisible to the player bar
// ---------------------------------------------------------------------------

const DRIVER_FILE = path.join(ROOT, 'js', 'mix-arc.js');

/**
 * The smallest element js/mix-arc.js's inertness pass actually uses. It needs
 * attributes, a tag name, a recursive descendant walk, and cloneNode - and
 * deliberately nothing else, so this cannot drift into a fake browser.
 */
function makeNode(tag, attributes) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: Object.assign({}, attributes),
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(node.attributes, name)
        ? node.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete node.attributes[name];
    },
    append(child) {
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    appendChild(child) {
      return node.append(child);
    },
    removeChild(child) {
      const at = node.children.indexOf(child);
      if (at >= 0) {
        node.children.splice(at, 1);
      }
      return child;
    },
    getElementsByTagName() {
      const out = [];
      (function walk(n) {
        for (const c of n.children) {
          out.push(c);
          walk(c);
        }
      })(node);
      return out;
    },
    cloneNode() {
      const copy = makeNode(tag, node.attributes);
      copy.className = node.className;
      for (const child of node.children) {
        copy.append(child.cloneNode());
      }
      return copy;
    },
  };

  /* The handful of layout-ish properties the driver reads or writes. None of
     them fakes layout: offsetHeight is a fixed number so sizeViewport has
     something real-shaped to work from. */
  node.className = '';
  node.style = { setProperty() {}, removeProperty() {} };
  node.offsetHeight = 240;
  Object.defineProperty(node, 'firstChild', {
    get: () => (node.children.length ? node.children[0] : null),
  });

  return node;
}

/** A slot shaped like the one js/sections.js renders, wired by the player bar. */
function makeSlot(index) {
  const slot = makeNode('li', { class: 'mix-arc__slot' });
  /* js/sections.js sets this through el(), and the driver reads the property
     rather than the attribute when it decides which children are slots. */
  slot.className = 'mix-arc__slot';
  const card = slot.append(
    makeNode('article', { 'data-mix-index': String(index), 'data-cue': 'true' })
  );
  card.append(makeNode('button', { type: 'button', 'aria-label': 'Play' }));
  card.append(makeNode('a', { href: 'https://example.invalid/mix' }));
  card.append(makeNode('figure', { id: 'cover-' + index }));
  return slot;
}

function loadDriver() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  for (const file of [MODEL_FILE, DRIVER_FILE]) {
    try {
      delete require.cache[require.resolve(file)];
    } catch (err) {
      /* not previously required - the require below reports it */
    }
    require(file);
  }
  const arc = globalThis.LUVIZ && globalThis.LUVIZ.mixArc;
  assert.ok(arc, 'js/mix-arc.js must define window.LUVIZ.mixArc');
  return arc;
}

/** Every node in the tree still carrying a mix index. */
function indexed(node) {
  const out = [];
  if (node.getAttribute('data-mix-index') !== null) {
    out.push(node);
  }
  for (const child of node.getElementsByTagName('*')) {
    if (child.getAttribute('data-mix-index') !== null) {
      out.push(child);
    }
  }
  return out;
}

test('the driver loads and exposes the inertness contract', () => {
  const arc = loadDriver();
  assert.equal(typeof arc.makeInert, 'function');
  assert.equal(typeof arc.isClone, 'function');
});

test('a clone is marked and hidden from assistive technology', () => {
  const arc = loadDriver();
  const clone = arc.makeInert(makeSlot(0).cloneNode());
  assert.equal(clone.getAttribute('data-arc-clone'), 'true');
  assert.equal(clone.getAttribute('aria-hidden'), 'true');
  assert.equal(arc.isClone(clone), true);
});

test('an original is not a clone', () => {
  const arc = loadDriver();
  assert.equal(arc.isClone(makeSlot(0)), false);
});

test('a clone carries no mix index anywhere in its subtree (KTD4)', () => {
  const arc = loadDriver();
  const original = makeSlot(3);
  assert.equal(indexed(original).length, 1, 'the original has exactly one indexed card');

  const clone = arc.makeInert(original.cloneNode());
  assert.equal(
    indexed(clone).length,
    0,
    'a clone that kept its index would be handed a second, dead play button by the player bar'
  );
});

test('padding the ring with clones cannot change what the player bar claims', () => {
  const arc = loadDriver();
  const model = loadDriver() && globalThis.LUVIZ.mixArcModel;

  /*
    THE ASSERTION THIS WHOLE UNIT EXISTS FOR. The ring holds far more slots
    than there are mixes. `.mix-card[data-mix-index]` is how js/player-bar.js
    decides what to claim, so that count must equal the number of real mixes
    no matter how much padding is added.
  */
  const REAL = 10;
  const originals = Array.from({ length: REAL }, (unused, i) => makeSlot(i));
  const slotCount = model.geometry(1440).slotCount;
  assert.ok(slotCount > REAL, 'the circle needs more slots than there are mixes');

  const ring = makeNode('ul', {});
  originals.forEach((slot) => ring.append(slot));
  for (let i = REAL; i < slotCount; i++) {
    ring.append(arc.makeInert(originals[i % REAL].cloneNode()));
  }

  assert.equal(ring.children.length, slotCount, 'the circle is full');
  assert.equal(
    indexed(ring).length,
    REAL,
    `the ring holds ${slotCount} slots but must expose exactly ${REAL} indexed cards`
  );
});

test('nothing inside a clone can be reached by keyboard', () => {
  const arc = loadDriver();
  const clone = arc.makeInert(makeSlot(0).cloneNode());
  for (const node of clone.getElementsByTagName('*')) {
    const tabindex = node.getAttribute('tabindex');
    if (tabindex !== null) {
      assert.ok(Number(tabindex) < 0, `${node.tagName} must not be tabbable inside a clone`);
    }
    for (const focusable of ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']) {
      if (node.tagName === focusable) {
        assert.equal(tabindex, '-1', `a cloned <${focusable.toLowerCase()}> must be taken out of the tab order`);
      }
    }
  }
});

test('a clone duplicates no id, which would break the labels on the original', () => {
  const arc = loadDriver();
  const clone = arc.makeInert(makeSlot(0).cloneNode());
  for (const node of clone.getElementsByTagName('*')) {
    assert.equal(node.getAttribute('id'), null);
  }
});

// ---------------------------------------------------------------------------
// U6 / R10, R11, R12: every reason not to build leaves the grid standing
// ---------------------------------------------------------------------------

const SECTIONS_CSS = path.join(ROOT, 'css', 'sections.css');

/**
 * A page with the arc markup in it, plus switches for each thing init()
 * checks. Nothing here fakes layout: these tests prove only that the guards
 * fire and that a refusal leaves no state behind.
 */
function makePage(options) {
  const opts = Object.assign(
    { reduced: false, width: 1440, gsap: true, cards: 3 },
    options
  );

  const viewport = makeNode('div', { class: 'mix-arc__viewport' });
  const shell = makeNode('div', { class: 'mix-arc', 'data-mix-arc': '' });
  shell.append(viewport);
  shell.querySelector = (sel) => (sel === '.mix-arc__viewport' ? viewport : null);
  shell.addEventListener = () => {};

  const ring = makeNode('ul', { id: 'mix-list' });
  for (let i = 0; i < opts.cards; i++) {
    ring.append(makeSlot(i));
  }

  globalThis.window = globalThis;
  globalThis.document = {
    querySelector: (sel) => (sel === '[data-mix-arc]' ? shell : null),
    getElementById: (id) => (id === 'mix-list' ? ring : null),
  };
  globalThis.matchMedia = () => ({ matches: opts.reduced });
  globalThis.innerWidth = opts.width;
  /* The driver watches for resizes. Node has no window to listen on, and a
     no-op listener means the debounced rebuild never fires - so the real
     timers are deliberately left alone rather than stubbed out under the
     test runner's feet. */
  globalThis.addEventListener = () => {};
  globalThis.gsap = opts.gsap ? { registerPlugin() {}, getProperty: () => 0, utils: { snap: () => (v) => v } } : undefined;
  globalThis.Draggable = opts.gsap ? { create() {} } : undefined;

  return { shell, ring };
}

function loadDriverForPage() {
  delete globalThis.LUVIZ;
  for (const file of [MODEL_FILE, DRIVER_FILE]) {
    try {
      delete require.cache[require.resolve(file)];
    } catch (err) {
      /* not previously required */
    }
    require(file);
  }
  return globalThis.LUVIZ.mixArc;
}

/** Run init() against a stubbed page and report what it left behind. */
function tryInit(options) {
  const { shell, ring } = makePage(options);
  const arc = loadDriverForPage();
  const built = arc.init();
  return { built, state: shell.getAttribute('data-arc-state'), shell, ring };
}

test('under reduced motion the arc is never constructed at all (R10)', () => {
  const run = tryInit({ reduced: true });
  assert.equal(run.built, false, 'it must not build');
  assert.equal(
    run.state,
    null,
    'and must leave no state behind - every arc rule in the stylesheet hangs off ' +
      '[data-arc-state], so no attribute means the plain grid stands'
  );
});

test('below the breakpoint the grid stands (R10, KD3)', () => {
  const arc = loadDriverForPage();
  const run = tryInit({ width: arc.MIN_VIEWPORT - 1 });
  assert.equal(run.built, false);
  assert.equal(run.state, null);
});

test('at the breakpoint the arc does build', () => {
  const arc = loadDriverForPage();
  const run = tryInit({ width: arc.MIN_VIEWPORT });
  assert.equal(run.built, true);
  assert.equal(run.state, 'live');
});

test('with GSAP blocked the section still prints every mix (R11)', () => {
  const run = tryInit({ gsap: false });
  assert.equal(run.built, false);
  assert.equal(run.state, null);
  assert.equal(run.ring.children.length, 3, 'the cards are left exactly as rendered');
});

test('with no mixes to show there is no ring to build', () => {
  const run = tryInit({ cards: 0 });
  assert.equal(run.built, false);
  assert.equal(run.state, null, 'an empty state must not be hidden behind a pending viewport');
});

test('a refusal never leaves clones behind', () => {
  for (const options of [{ reduced: true }, { width: 320 }, { gsap: false }]) {
    const run = tryInit(options);
    const clones = run.ring.children.filter(
      (c) => c.getAttribute('data-arc-clone') !== null
    );
    assert.equal(clones.length, 0, `clones leaked with ${JSON.stringify(options)}`);
  }
});

test('a successful build pads the ring and leaves the real mixes claimable', () => {
  const run = tryInit({ cards: 3 });
  assert.equal(run.built, true);
  assert.ok(run.ring.children.length > 3, 'the circle is padded out');
  assert.equal(indexed(run.ring).length, 3, 'but only the real mixes carry an index');
});

// ---------------------------------------------------------------------------
// R12: the full-bleed must not put a horizontal scrollbar on the page
// ---------------------------------------------------------------------------

test('the arc never breaks out with 100vw (R12)', () => {
  const css = fs.readFileSync(SECTIONS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const arcRules = css.split(/(?=\.mix-arc)/).filter((block) => block.startsWith('.mix-arc'));
  assert.ok(arcRules.length > 0, 'the arc must have rules to check');
  for (const block of arcRules) {
    assert.ok(
      !/width:\s*100vw/.test(block),
      '100vw counts the scrollbar, so it widens the document and R18 forbids it'
    );
  }
});

test('an idle arc never clips the grid it hands back', () => {
  const css = fs.readFileSync(SECTIONS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  /*
    A viewport resized below the breakpoint keeps data-arc-state="idle" and
    the inline height the arc measured for it. If the clipping rule matched a
    bare [data-arc-state] it would still apply, and the grid would render
    inside a fixed-height box with most of it cut off.
  */
  const viewportRules = css
    .split('}')
    .filter((block) => block.includes('.mix-arc__viewport') && block.includes('overflow'));
  assert.ok(viewportRules.length > 0, 'the viewport must have a clipping rule to check');
  for (const block of viewportRules) {
    assert.ok(
      !/\.mix-arc\[data-arc-state\]\s/.test(block),
      'the clipping rule must name pending and live, not any state'
    );
  }
});

test('the driver clears the measured height when it hands the grid back', () => {
  const code = readCode(DRIVER_FILE);
  assert.ok(
    /data-arc-state',\s*'idle'\);[\s\S]{0,200}?viewport\.style\.height\s*=\s*''/.test(code),
    'going idle must clear the inline height, which no stylesheet rule can undo'
  );
});

test('the mixes section clips its own overflow rather than scrolling', () => {
  const css = fs.readFileSync(SECTIONS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    /#mixes\s*\{[^}]*overflow-x:\s*clip/.test(css),
    'the break-out is contained by clipping #mixes; without it the negative ' +
      'margins overshoot by the scrollbar width and the page scrolls sideways'
  );
});

test('an already-tabbable element inside a clone is taken out of the tab order', () => {
  const arc = loadDriver();
  const slot = makeSlot(0);
  slot.children[0].append(makeNode('div', { tabindex: '0' }));
  const clone = arc.makeInert(slot.cloneNode());
  const div = clone.getElementsByTagName('*').find((n) => n.tagName === 'DIV');
  assert.equal(div.getAttribute('tabindex'), '-1');
});
