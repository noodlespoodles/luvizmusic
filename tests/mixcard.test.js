'use strict';

/**
 * U3 mix-card structure tests (R7, R13, R14, KTD3, KTD8).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/sections.js builds the DOM, so unlike js/mix-arc-model.js it cannot be
 * tested without one. The stub below is the smallest document that file
 * actually uses - createElement, createTextNode, getElementById, className,
 * classList, setAttribute, appendChild, textContent, firstChild/removeChild,
 * plus the four image properties its broken-cover guard reads. It is
 * deliberately not a browser: it proves STRUCTURE, which is the part that
 * breaks silently. Layout and motion are verified by looking at the page.
 *
 * WHY THIS FILE EXISTS AT ALL. Two contracts here have no error path. The
 * player bar finds cards with `.mix-card[data-mix-index]` and appends its
 * play button to whatever it finds, so if the index ever migrates back to
 * the <li> the button lands on the arc slot and slides off down the circle.
 * And a <div> inside a <ul> is invalid markup that no browser will complain
 * about. Neither would throw. Both would ship.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/namespace.js', 'js/mix-art.js', 'js/sections.js'];

// ---------------------------------------------------------------------------
// The smallest document js/sections.js actually uses
// ---------------------------------------------------------------------------

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    attributes: {},
    _text: '',

    setAttribute(name, value) {
      el.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attributes, name)
        ? el.attributes[name]
        : null;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = el.children.indexOf(child);
      if (at >= 0) {
        el.children.splice(at, 1);
      }
      return child;
    },
  };

  el.classList = {
    add(...names) {
      const have = new Set(el.className.split(/\s+/).filter(Boolean));
      names.forEach((n) => have.add(n));
      el.className = [...have].join(' ');
    },
    remove(...names) {
      const have = new Set(el.className.split(/\s+/).filter(Boolean));
      names.forEach((n) => have.delete(n));
      el.className = [...have].join(' ');
    },
    contains(name) {
      return el.className.split(/\s+/).includes(name);
    },
  };

  Object.defineProperty(el, 'firstChild', {
    get() {
      return el.children.length ? el.children[0] : null;
    },
  });

  Object.defineProperty(el, 'textContent', {
    get() {
      return el.children.length
        ? el.children.map((c) => c.textContent || '').join('')
        : el._text;
    },
    set(value) {
      el._text = String(value);
      el.children.length = 0;
    },
  });

  /* The broken-cover guard reads these. Defaulting to a healthy image keeps
     the fallback path off unless a test asks for it. */
  el.complete = false;
  el.naturalWidth = 1;

  return el;
}

function makeDocument() {
  const byId = new Map();
  const doc = {
    createElement: (tag) => makeElement(tag),
    createTextNode: (text) => {
      const node = makeElement('#text');
      node.textContent = text;
      return node;
    },
    getElementById: (id) => byId.get(id) || null,
    _register(id, el) {
      byId.set(id, el);
      return el;
    },
  };
  return doc;
}

/** Load the classic browser scripts under Node, in index.html's order. */
function loadSections() {
  const doc = makeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  delete globalThis.LUVIZ;

  for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    try {
      delete require.cache[require.resolve(file)];
    } catch (err) {
      /* not previously required - the require below reports it */
    }
    require(file);
  }

  const sections = globalThis.LUVIZ && globalThis.LUVIZ.sections;
  assert.ok(sections, 'js/sections.js must define window.LUVIZ.sections');
  return { sections, doc };
}

/** Render a mix list into a registered #mix-list and hand back the slots. */
function renderMixes(mixes) {
  const { sections, doc } = loadSections();
  const list = doc._register('mix-list', makeElement('ul'));
  const ok = sections.mixes(mixes);
  return { ok, list, slots: list.children };
}

/** Depth-first search for the first descendant whose class list has `name`. */
function find(node, name) {
  for (const child of node.children) {
    if (child.classList && child.classList.contains(name)) {
      return child;
    }
    const deeper = find(child, name);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

/** The direct children of `node` that carry `name`, in source order. */
function classOrder(node) {
  return node.children.map((c) => (c.className || '').split(/\s+/)[0]);
}

const MIXES = [
  {
    title: 'Shadowmixer 0321',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/shadowmixer-0321/',
    artwork: 'assets/mixes/shadowmixer-0321.jpg',
    credit: 'raboobi on Mixcloud',
  },
  {
    /* No artwork and no credit: the two optional fields, both absent. */
    title: 'Mac Banana 3',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/mac-banana-3/',
  },
  {
    title: 'Steady State',
    provider: 'file',
    url: 'media/mixes/steady-state.mp3',
    artwork: 'assets/mixes/steady-state.jpg',
    credit: 'Uploaded by LUVIZMUSIC',
    beatGrid: [{ atMs: 0, bpm: 122 }],
  },
];

// ---------------------------------------------------------------------------
// KTD8: the slot and the card are two elements
// ---------------------------------------------------------------------------

test('the list holds only list items, so the markup stays valid', () => {
  const { slots } = renderMixes(MIXES);
  assert.equal(slots.length, MIXES.length);
  for (const slot of slots) {
    assert.equal(slot.tagName, 'LI', 'a <ul> may only contain <li>');
    assert.ok(slot.classList.contains('mix-arc__slot'), 'each <li> is an arc slot');
  }
});

test('each slot wraps exactly one card, and the card is not the slot', () => {
  const { slots } = renderMixes(MIXES);
  for (const slot of slots) {
    const cards = slot.children.filter((c) => c.classList.contains('mix-card'));
    assert.equal(cards.length, 1, 'one card per slot');
    assert.equal(cards[0].tagName, 'ARTICLE', 'the card is an <article> inside the slot');
    assert.ok(
      !slot.classList.contains('mix-card'),
      'the slot must not also be the card - the arc leans the slot about a point ' +
        'thousands of pixels away, which would drag the play button off the arc'
    );
  }
});

test('the mix index lives on the card the player bar claims, not on the slot', () => {
  const { slots } = renderMixes(MIXES);
  slots.forEach((slot, i) => {
    const card = find(slot, 'mix-card');
    assert.equal(
      card.getAttribute('data-mix-index'),
      String(i),
      'data-mix-index is sequential and sits on the card'
    );
    assert.equal(
      slot.getAttribute('data-mix-index'),
      null,
      'the slot must not carry an index, or the player bar claims the wrong element'
    );
  });
});

test('exactly one indexed card exists per mix', () => {
  const { list } = renderMixes(MIXES);
  let indexed = 0;
  (function walk(node) {
    for (const child of node.children) {
      if (child.classList && child.classList.contains('mix-card') &&
          child.getAttribute('data-mix-index') !== null) {
        indexed += 1;
      }
      walk(child);
    }
  })(list);
  assert.equal(indexed, MIXES.length, 'the player bar must find one card per mix');
});

// ---------------------------------------------------------------------------
// R13: the reference's card anatomy, in the reference's order
// ---------------------------------------------------------------------------

test('the card prints tags, cover, title, credit and link, in that order', () => {
  const { slots } = renderMixes(MIXES);
  const card = find(slots[0], 'mix-card');
  assert.deepEqual(classOrder(card), [
    'mix-card__meta',
    'mix-card__figure',
    'mix-card__title',
    'mix-card__credit',
    'link-row',
  ]);
});

test('the tags row comes before the cover, which is the change from the grid', () => {
  const { slots } = renderMixes(MIXES);
  for (const slot of slots) {
    const card = find(slot, 'mix-card');
    const order = classOrder(card);
    assert.ok(
      order.indexOf('mix-card__meta') < order.indexOf('mix-card__figure'),
      'the reference puts its tags above the cover'
    );
  }
});

test('a mix with no credit prints no empty credit line', () => {
  const { slots } = renderMixes(MIXES);
  const card = find(slots[1], 'mix-card');
  assert.equal(find(card, 'mix-card__credit'), null);
  assert.ok(find(card, 'mix-card__title'), 'but it still has a title');
});

test('only a mix the page can pulse to gets a BPM chip', () => {
  const { slots } = renderMixes(MIXES);
  const plain = find(find(slots[0], 'mix-card'), 'mix-card__meta');
  const pulsing = find(find(slots[2], 'mix-card'), 'mix-card__meta');
  assert.equal(plain.children.length, 1, 'provider chip only');
  assert.equal(pulsing.children.length, 2, 'provider chip plus BPM');
  assert.ok(pulsing.textContent.includes('122'), 'the BPM is the one in the beat grid');
});

// ---------------------------------------------------------------------------
// KTD3 and R14: the cover stays square, and never prints a broken image
// ---------------------------------------------------------------------------

test('the cover is square, not the reference 2:3 portrait (KTD3)', () => {
  const { slots } = renderMixes(MIXES);
  const figure = find(find(slots[0], 'mix-card'), 'mix-card__figure');
  assert.ok(
    figure.classList.contains('media--square'),
    'Mixcloud artwork and the generated covers are square; cropping to a book shape ruins both'
  );
});

test('the cover is marked for the cursor layer U9 will add', () => {
  const { slots } = renderMixes(MIXES);
  const figure = find(find(slots[0], 'mix-card'), 'mix-card__figure');
  assert.equal(figure.getAttribute('data-cursor'), 'view');
});

test('a mix with no artwork falls back to a generated cover, not a broken image', () => {
  const { slots } = renderMixes(MIXES);
  const figure = find(find(slots[1], 'mix-card'), 'mix-card__figure');
  assert.ok(figure.classList.contains('media--fallback'), 'the fallback tile took over');
  assert.equal(figure.getAttribute('aria-hidden'), 'true', 'the tile repeats the title, so it is decorative');

  const img = figure.children.find((c) => c.tagName === 'IMG');
  assert.ok(img, 'the fallback draws a cover rather than announcing an absence');
  assert.ok(
    String(img.attributes.src || img.src || '').startsWith('data:image/svg+xml'),
    'js/mix-art.js generates it inline, so it works with no network'
  );
});

// ---------------------------------------------------------------------------
// R7: the link out survives, so a card works with no player at all
// ---------------------------------------------------------------------------

test('every mix keeps a link out to where it is hosted', () => {
  const { slots } = renderMixes(MIXES);
  for (const slot of slots) {
    const row = find(find(slot, 'mix-card'), 'link-row');
    assert.ok(row, 'the honest fallback when no player is wired');
  }
});

test('an off-site mix opens in a new tab, a self-hosted one does not', () => {
  const { slots } = renderMixes(MIXES);
  const hosted = find(find(slots[0], 'mix-card'), 'link-row');
  const own = find(find(slots[2], 'mix-card'), 'link-row');
  const anchorOf = (row) => row.children[0].children[0];
  assert.equal(anchorOf(hosted).target, '_blank');
  assert.equal(anchorOf(own).target, undefined, 'a file we host stays in the tab');
});

// ---------------------------------------------------------------------------
// The states that are not a list of mixes
// ---------------------------------------------------------------------------

test('an empty mix list prints a notice rather than nothing', () => {
  const { ok, list } = renderMixes([]);
  assert.equal(ok, true);
  assert.equal(list.children.length, 1);
  assert.ok(list.textContent.toLowerCase().includes('shelf empty'));
});

test('a missing content file names itself', () => {
  const { ok, list } = renderMixes(undefined);
  assert.equal(ok, false);
  assert.ok(list.textContent.includes('content/mixes.js'));
});

test('a malformed entry is skipped without taking the whole section down', () => {
  const { slots } = renderMixes([MIXES[0], null, 'nonsense', MIXES[2]]);
  assert.equal(slots.length, 2, 'the two real mixes still render');
});
