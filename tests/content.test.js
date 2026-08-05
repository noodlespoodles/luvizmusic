'use strict';

/**
 * U1 content-contract tests.
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * The content files are classic browser scripts, not modules (KTD1). To load
 * them under Node we shim `globalThis.window = globalThis` so that
 * `window.LUVIZ.x = ...` lands on a global we can inspect.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONTENT_KEYS = ['site', 'crew', 'mixes', 'events'];
const PROVIDERS = ['soundcloud', 'youtube', 'mixcloud', 'file'];

/**
 * Fixed reference date for assertions about the shipped placeholder set.
 * Deliberately a literal, never `Date.now()`: the suite must not turn red
 * simply because the clock moved past a hardcoded future date.
 */
const REFERENCE_NOW = Date.parse('2026-08-05T00:00:00Z');

function namespacePath() {
  return path.join(ROOT, 'js', 'namespace.js');
}

function contentPath(key) {
  return path.join(ROOT, 'content', key + '.js');
}

/** require() a classic script, capturing (not throwing) any load failure. */
function loadFile(file, failures) {
  try {
    delete require.cache[require.resolve(file)];
  } catch (err) {
    // Not previously required, or missing - the require below will report it.
  }
  try {
    require(file);
  } catch (err) {
    failures.push({ file: file, error: err });
  }
}

/**
 * Load namespace.js plus the named content files into a clean global.
 * Returns the resulting LUVIZ object and any load failures.
 */
function loadSite(keys, options) {
  const opts = options || {};
  const root = opts.root || ROOT;
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  const failures = [];
  loadFile(path.join(root, 'js', 'namespace.js'), failures);
  const wanted = keys || CONTENT_KEYS;
  for (const key of wanted) {
    loadFile(path.join(root, 'content', key + '.js'), failures);
  }
  return { LUVIZ: globalThis.LUVIZ, failures: failures };
}

function isIsoDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ---------------------------------------------------------------------------
// namespace.js: load bookkeeping
// ---------------------------------------------------------------------------

test('namespace.js loads on its own and reports every content file as missing', () => {
  const { LUVIZ, failures } = loadSite([]);
  assert.deepEqual(failures, [], 'namespace.js must load cleanly');
  assert.ok(LUVIZ, 'window.LUVIZ must exist after namespace.js runs');
  assert.equal(typeof LUVIZ._loaded, 'function');
  assert.equal(typeof LUVIZ._missing, 'function');
  assert.deepEqual(LUVIZ._missing().slice().sort(), CONTENT_KEYS.slice().sort());
});

test('every content file defines its expected window.LUVIZ key', () => {
  const { LUVIZ, failures } = loadSite();
  assert.deepEqual(
    failures.map((f) => path.basename(f.file)),
    [],
    'no content file may fail to load'
  );
  assert.ok(LUVIZ.site && typeof LUVIZ.site === 'object', 'site must be an object');
  assert.ok(Array.isArray(LUVIZ.crew), 'crew must be an array');
  assert.ok(Array.isArray(LUVIZ.mixes), 'mixes must be an array');
  assert.ok(Array.isArray(LUVIZ.events), 'events must be an array');
  assert.deepEqual(LUVIZ._missing(), [], 'nothing may be reported missing');
});

test('loading only some content files leaves the rest detectable by absence', () => {
  const { LUVIZ } = loadSite(['site', 'crew']);
  assert.deepEqual(LUVIZ._missing().slice().sort(), ['events', 'mixes']);
  assert.equal(LUVIZ.mixes, undefined);
  assert.match(LUVIZ.missingMessage(), /content[\\/]mixes\.js/);
});

// ---------------------------------------------------------------------------
// site
// ---------------------------------------------------------------------------

test('site carries a non-empty tagline and contactEmail', () => {
  const { LUVIZ } = loadSite();
  const site = LUVIZ.site;
  assert.equal(typeof site.tagline, 'string');
  assert.ok(site.tagline.trim().length > 0, 'tagline must not be empty');
  assert.equal(typeof site.blurb, 'string');
  assert.ok(site.blurb.trim().length > 0, 'blurb must not be empty');
  assert.equal(typeof site.contactEmail, 'string');
  assert.match(site.contactEmail, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  assert.ok(Array.isArray(site.socialLinks) && site.socialLinks.length > 0);
  for (const link of site.socialLinks) {
    assert.ok(link.label && link.label.trim().length > 0, 'social link needs a label');
    assert.match(link.url, /^https?:\/\//, 'social link needs an http(s) url');
  }
  assert.deepEqual(LUVIZ.validate.site(site), []);
});

// ---------------------------------------------------------------------------
// crew
// ---------------------------------------------------------------------------

test('every crew member has a non-empty name and bio', () => {
  const { LUVIZ } = loadSite();
  assert.ok(LUVIZ.crew.length >= 2, 'ship more than one placeholder crew member');
  for (const [index, member] of LUVIZ.crew.entries()) {
    assert.ok(
      typeof member.name === 'string' && member.name.trim().length > 0,
      'crew[' + index + '] needs a name'
    );
    assert.ok(
      typeof member.bio === 'string' && member.bio.trim().length > 0,
      'crew[' + index + '] needs a bio'
    );
  }
  assert.deepEqual(LUVIZ.validate.crew(LUVIZ.crew), []);
});

test('every crew member carries the supported fields', () => {
  const { LUVIZ } = loadSite();
  for (const member of LUVIZ.crew) {
    assert.equal(typeof member.alias, 'string');
    assert.equal(typeof member.photo, 'string');
    assert.ok(Array.isArray(member.links), 'links must be an array, even when empty');
  }
  // No floor on how many members have links. The crew is real people, and a
  // member with nothing to link to yet is a normal state, not a broken file.
  for (const member of LUVIZ.crew) {
    for (const link of member.links) {
      assert.ok(link.label && link.label.trim().length > 0);
      assert.match(
        link.url,
        /^(https?:\/\/|mailto:)/,
        'a crew link is a web profile or a booking address'
      );
    }
  }
});

test('the validator accepts a booking address but rejects a bare string', () => {
  const { LUVIZ } = loadSite();
  const member = (links) => [
    { name: 'Probe', alias: 'PROBE', bio: 'A bio.', photo: 'assets/crew/probe.jpg', links: links },
  ];
  assert.deepEqual(
    LUVIZ.validate.crew(member([{ label: 'Bookings', url: 'mailto:hi@example.com' }])),
    [],
    'a mailto booking address should be accepted'
  );
  assert.notDeepEqual(
    LUVIZ.validate.crew(member([{ label: 'Broken', url: 'soundcloud.com/no-scheme' }])),
    [],
    'a url with no scheme should still be rejected'
  );
});

// ---------------------------------------------------------------------------
// mixes
// ---------------------------------------------------------------------------

test('every mix declares a provider in the supported set', () => {
  const { LUVIZ } = loadSite();
  assert.ok(LUVIZ.mixes.length > 0, 'ship at least one placeholder mix');
  for (const [index, mix] of LUVIZ.mixes.entries()) {
    assert.ok(
      PROVIDERS.includes(mix.provider),
      'mixes[' + index + '] provider "' + mix.provider + '" is not supported'
    );
    assert.ok(typeof mix.title === 'string' && mix.title.trim().length > 0);
    assert.ok(typeof mix.url === 'string' && mix.url.trim().length > 0);
  }
  assert.deepEqual(LUVIZ.validate.mixes(LUVIZ.mixes), []);
});

// The shipped content is real (the crew's own Mixcloud uploads), so it is not a
// fixture and must not be asserted against as if it were. Provider breadth and
// beat-grid shape are properties of the VALIDATOR, proven here with synthetic
// mixes; the content tests below only check that whatever is actually shipped
// is well formed.
test('the validator accepts every supported provider', () => {
  const { LUVIZ } = loadSite();
  for (const provider of PROVIDERS) {
    const problems = LUVIZ.validate.mixes([
      { title: 'Probe', provider: provider, url: 'https://example.com/probe' },
    ]);
    assert.deepEqual(
      problems,
      [],
      'provider "' + provider + '" should be accepted by validate.mixes'
    );
  }
});

test('the validator enforces ordered, in-range beat grids', () => {
  const { LUVIZ } = loadSite();
  const base = { title: 'Probe', provider: 'mixcloud', url: 'https://example.com/p' };

  assert.deepEqual(
    LUVIZ.validate.mixes([
      Object.assign({}, base, {
        beatGrid: [{ atMs: 0, bpm: 118 }, { atMs: 1140000, bpm: 124 }],
      }),
    ]),
    [],
    'a well-formed multi-segment grid should validate'
  );

  assert.notDeepEqual(
    LUVIZ.validate.mixes([
      Object.assign({}, base, {
        beatGrid: [{ atMs: 1140000, bpm: 124 }, { atMs: 0, bpm: 118 }],
      }),
    ]),
    [],
    'an out-of-order grid should be rejected'
  );

  assert.notDeepEqual(
    LUVIZ.validate.mixes([
      Object.assign({}, base, { beatGrid: [{ atMs: 0, bpm: 400 }] }),
    ]),
    [],
    'a bpm outside 60-200 should be rejected'
  );
});

test('any beat grid in the shipped content is ordered and in range', () => {
  const { LUVIZ } = loadSite();
  const gridded = LUVIZ.mixes.filter((m) => Array.isArray(m.beatGrid));
  for (const mix of gridded) {
    let previous = -1;
    for (const [index, segment] of mix.beatGrid.entries()) {
      assert.ok(
        Number.isFinite(segment.atMs) && segment.atMs >= 0,
        mix.title + ' beatGrid[' + index + '].atMs must be a number >= 0'
      );
      assert.ok(
        Number.isFinite(segment.bpm) && segment.bpm >= 60 && segment.bpm <= 200,
        mix.title + ' beatGrid[' + index + '].bpm must be between 60 and 200'
      );
      assert.ok(
        segment.atMs > previous,
        mix.title + ' beatGrid must be ordered by atMs'
      );
      previous = segment.atMs;
    }
    assert.equal(LUVIZ.validate.pulses(mix), true, mix.title + ' should pulse');
  }
});

test('a mix with no beatGrid validates and is marked non-pulsing', () => {
  const { LUVIZ } = loadSite();
  const ungridded = LUVIZ.mixes.filter((m) => m.beatGrid === undefined);
  assert.ok(ungridded.length > 0, 'at least one placeholder mix must omit beatGrid');
  for (const mix of ungridded) {
    assert.deepEqual(LUVIZ.validate.mixes([mix]), []);
    assert.equal(LUVIZ.validate.pulses(mix), false, mix.title + ' must not pulse');
  }
});

test('validate.mixes names an unsupported provider and a bad beat grid in plain English', () => {
  const { LUVIZ } = loadSite();
  const errors = LUVIZ.validate.mixes([
    { title: 'Wrong Provider', provider: 'spotify', url: 'https://example.com/x' },
    {
      title: 'Wrong Grid',
      provider: 'file',
      url: 'media/x.mp3',
      beatGrid: [
        { atMs: 0, bpm: 480 },
        { atMs: -1, bpm: 124 },
      ],
    },
  ]);
  assert.ok(errors.length >= 3, 'expected several plain-English errors');
  assert.ok(errors.some((e) => /spotify/.test(e) && /soundcloud/.test(e)));
  assert.ok(errors.some((e) => /bpm/i.test(e) && /60/.test(e) && /200/.test(e)));
  assert.ok(errors.some((e) => /atMs/i.test(e)));
  for (const message of errors) {
    assert.ok(!/undefined|\[object Object\]/.test(message), 'errors must read as English');
  }
});

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

test('every event date parses as a valid ISO date', () => {
  const { LUVIZ } = loadSite();
  assert.ok(LUVIZ.events.length > 0, 'ship at least one placeholder event');
  for (const [index, event] of LUVIZ.events.entries()) {
    assert.ok(isIsoDay(event.date), 'events[' + index + '].date must be YYYY-MM-DD');
    assert.ok(
      Number.isFinite(Date.parse(event.date + 'T00:00:00Z')),
      'events[' + index + '].date must be a real calendar date'
    );
    assert.ok(typeof event.title === 'string' && event.title.trim().length > 0);
    assert.ok(typeof event.venue === 'string' && event.venue.trim().length > 0);
    assert.ok(typeof event.city === 'string' && event.city.trim().length > 0);
  }
  assert.deepEqual(LUVIZ.validate.events(LUVIZ.events), []);
});

test('event fixtures built from an injected now stay time-stable', () => {
  const { LUVIZ } = loadSite();
  // The fixtures below are built RELATIVE to an injected "now", so this test
  // asserts the same thing forever: it cannot go red when the real clock
  // passes a hardcoded future date.
  const now = Date.parse('2030-03-01T00:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const fixtures = [
    { title: 'Long Past', date: iso(now - 400 * day), venue: 'The Annexe', city: 'London' },
    { title: 'Recent Past', date: iso(now - 3 * day), venue: 'The Annexe', city: 'London' },
    { title: 'Soon', date: iso(now + 9 * day), venue: 'Bath House', city: 'Bristol' },
    {
      title: 'Later',
      date: iso(now + 120 * day),
      venue: 'Bath House',
      city: 'Bristol',
      ticketUrl: 'https://tickets.example/later',
    },
  ];
  assert.deepEqual(LUVIZ.validate.events(fixtures), []);
  assert.equal(LUVIZ.validate.isUpcoming(fixtures[0], now), false);
  assert.equal(LUVIZ.validate.isUpcoming(fixtures[1], now), false);
  assert.equal(LUVIZ.validate.isUpcoming(fixtures[2], now), true);
  assert.equal(LUVIZ.validate.isUpcoming(fixtures[3], now), true);
  // An event dated today is still upcoming: the night has not happened yet.
  assert.equal(LUVIZ.validate.isUpcoming({ date: iso(now) }, now), true);
});

test('placeholder events include both a past and an upcoming date (fixed reference)', () => {
  const { LUVIZ } = loadSite();
  const stamps = LUVIZ.events.map((e) => Date.parse(e.date + 'T00:00:00Z'));
  assert.ok(
    stamps.some((t) => t < REFERENCE_NOW),
    'placeholders must include a past event, to demonstrate R8'
  );
  assert.ok(
    stamps.some((t) => t >= REFERENCE_NOW),
    'placeholders must include an upcoming event, to demonstrate R8'
  );
  assert.ok(
    LUVIZ.events.some((e) => typeof e.ticketUrl === 'string'),
    'placeholders must demonstrate the optional ticketUrl field'
  );
});

test('validate.events reports a broken date in plain English', () => {
  const { LUVIZ } = loadSite();
  const errors = LUVIZ.validate.events([
    { title: 'Bad Date', date: '5 August 2026', venue: 'The Annexe', city: 'London' },
    { title: 'Impossible Date', date: '2026-02-31', venue: 'The Annexe', city: 'London' },
  ]);
  assert.ok(errors.length >= 2);
  assert.ok(errors.every((e) => /YYYY-MM-DD/.test(e)));
  for (const message of errors) {
    assert.ok(!/undefined|\[object Object\]/.test(message));
  }
});

// ---------------------------------------------------------------------------
// whole-content validation
// ---------------------------------------------------------------------------

test('validate.all passes on the shipped placeholder content', () => {
  const { LUVIZ } = loadSite();
  const report = LUVIZ.validate.all(LUVIZ);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missing, []);
  assert.equal(report.ok, true);
});

// ---------------------------------------------------------------------------
// resilience (R9a)
// ---------------------------------------------------------------------------

test('a content file with a syntax error yields a named, human-readable failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luviz-content-'));
  try {
    fs.mkdirSync(path.join(dir, 'js'));
    fs.mkdirSync(path.join(dir, 'content'));
    fs.copyFileSync(namespacePath(), path.join(dir, 'js', 'namespace.js'));
    for (const key of ['site', 'crew', 'events']) {
      fs.copyFileSync(contentPath(key), path.join(dir, 'content', key + '.js'));
    }
    const broken = path.join(dir, 'content', 'mixes.js');
    fs.copyFileSync(contentPath('mixes'), broken);
    // Deliberate corruption: an unclosed quote. The whole file fails to parse,
    // so nothing in it runs - including its _loaded('mixes') call.
    fs.appendFileSync(
      broken,
      "\nwindow.LUVIZ.mixes.push({ title: 'unclosed quote });\n"
    );

    const { LUVIZ, failures } = loadSite(CONTENT_KEYS, { root: dir });

    assert.equal(failures.length, 1, 'exactly one file should fail');
    assert.equal(failures[0].error.name, 'SyntaxError');
    assert.equal(LUVIZ.mixes, undefined, 'the broken key must be absent, not half-built');
    assert.deepEqual(LUVIZ._missing(), ['mixes']);
    // The other three files still loaded: one bad file does not take the page down.
    assert.ok(LUVIZ.site && LUVIZ.crew && LUVIZ.events);

    const explanation = LUVIZ.explain('content/mixes.js', failures[0].error);
    assert.match(explanation, /content\/mixes\.js/);
    assert.match(explanation, /line \d+/);
    assert.match(explanation, /quote/i);
    assert.ok(!/undefined|\[object Object\]/.test(explanation));

    const report = LUVIZ.validate.all(LUVIZ);
    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, ['mixes']);
    assert.match(LUVIZ.missingMessage(), /content[\\/]mixes\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// KTD1 / script-order guards
// ---------------------------------------------------------------------------

test('content and namespace files are classic scripts, never modules (KTD1)', () => {
  const files = [namespacePath()].concat(CONTENT_KEYS.map(contentPath));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(
      !/^\s*(import|export)\b/m.test(source),
      path.basename(file) + ' must not use ES module syntax - it breaks over file://'
    );
    assert.ok(
      !/\bfetch\s*\(|XMLHttpRequest/.test(source),
      path.basename(file) + ' must not fetch anything - it breaks over file://'
    );
  }
});

test('index.html declares the whole script order, namespace first and app last', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0, 'index.html must declare script tags');
  assert.equal(srcs[0], 'js/namespace.js', 'namespace.js must load first');
  assert.equal(srcs[srcs.length - 1], 'js/app.js', 'app.js must load last');

  const at = (src) => srcs.indexOf(src);
  for (const key of CONTENT_KEYS) {
    assert.ok(at('content/' + key + '.js') > 0, 'content/' + key + '.js must be declared');
  }
  assert.ok(
    at('content/events.js') < at('js/app.js'),
    'content must load before the app boots'
  );
  // Files later units create are declared now, so no unit has to touch index.html.
  for (const src of [
    'js/provider-url.js',
    'js/events-model.js',
    'js/player-state.js',
    'js/scene-plan.js',
    'js/marquee-model.js',
    'js/pointer-mode.js',
    'js/beat-clock.js',
    'js/intensity.js',
    'js/sections.js',
    'js/players/adapter.js',
    'js/player-bar.js',
    'js/scenes.js',
    'js/cursor.js',
    'js/marquee.js',
    'js/section-fx.js',
  ]) {
    assert.ok(at(src) > 0, src + ' must be declared in index.html');
  }
  // GSAP is pinned (KTD2) and loads before anything that uses it.
  const gsap = srcs.filter((s) => /cdn\.jsdelivr\.net/.test(s));
  assert.equal(gsap.length, 4, 'core + ScrollTrigger + SplitText + Observer');
  for (const src of gsap) {
    assert.match(src, /gsap@3\.15\.0\//, 'GSAP must be version-pinned');
  }
  assert.ok(
    srcs.indexOf(gsap[gsap.length - 1]) < at('js/scenes.js'),
    'GSAP must load before the scene code'
  );

  const links = [...html.matchAll(/<link[^>]*\bhref="([^"]+\.css)"/g)].map((m) => m[1]);
  for (const href of [
    'css/tokens.css',
    'css/texture.css',
    'css/type.css',
    'css/base.css',
    'css/layout.css',
    'css/sections.css',
    'css/player.css',
    'css/motion.css',
    'css/section-fx.css',
  ]) {
    assert.ok(links.includes(href), href + ' must be declared in index.html');
  }
});

test('index.html ships the five section landmarks with noscript fallbacks', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const id of ['hero', 'crew', 'mixes', 'events', 'contact']) {
    const section = new RegExp(
      '<section[^>]*id="' + id + '"[\\s\\S]*?</section>'
    ).exec(html);
    assert.ok(section, 'index.html must contain a #' + id + ' section');
    assert.match(section[0], /<h[12][^>]*>/, '#' + id + ' needs a heading');
    assert.match(section[0], /<noscript>/, '#' + id + ' needs a noscript fallback');
  }
});

// The hero tagline is deliberately duplicated: content/site.js is the source of
// truth that JavaScript renders, while index.html carries a static copy so the
// line survives with JavaScript disabled (R22). Because JS overwrites the static
// copy at boot, editing only index.html looks like it works and then silently
// reverts. This asserts the two stay in step.
test('hero tagline in index.html matches content/site.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const site = fs.readFileSync(path.join(ROOT, 'content', 'site.js'), 'utf8');

  const fromContent = /tagline:\s*(['"])([\s\S]*?)\1/.exec(site);
  assert.ok(fromContent, 'content/site.js must declare a tagline');

  const hero = /<section[^>]*id="hero"[\s\S]*?<\/section>/.exec(html);
  assert.ok(hero, 'index.html must contain a #hero section');

  const staticCopy = /<p[^>]*>([^<]+)<\/p>/.exec(hero[0]);
  assert.ok(staticCopy, '#hero must carry a static tagline paragraph');

  assert.strictEqual(
    staticCopy[1].trim(),
    fromContent[2].trim(),
    'Tagline drift: edit content/site.js, then mirror it into the #hero <p> in ' +
      'index.html. content/site.js is what visitors actually see.'
  );
});

// Same trap, same guard, for the blurb. Both live twice on purpose: content/
// site.js is what JavaScript renders and what visitors read, index.html carries
// a static copy so the words survive with JavaScript off (R22). Editing only the
// HTML looks like it worked and then silently reverts on the next load.
test('hero blurb in index.html matches content/site.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const { LUVIZ } = loadSite();

  const staticCopy = /<p[^>]*id="hero-blurb"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(staticCopy, 'index.html must carry a #hero-blurb paragraph');

  assert.strictEqual(
    staticCopy[1].replace(/\s+/g, ' ').trim(),
    LUVIZ.site.blurb.replace(/\s+/g, ' ').trim(),
    'Blurb drift: edit content/site.js, then mirror it into #hero-blurb in ' +
      'index.html. content/site.js is what visitors actually see.'
  );
});

// Same trap as the tagline, one field along. The blurb is duplicated between
// content/site.js (what JS renders) and index.html (the no-JS fallback), and
// the owner has now edited the markup copy twice expecting it to show. This
// fails loudly and says which file to edit.
test('hero blurb in index.html matches content/site.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const site = fs.readFileSync(path.join(ROOT, 'content', 'site.js'), 'utf8');

  const declared = /blurb:([\s\S]*?)\n\s*\n/.exec(site);
  assert.ok(declared, 'content/site.js must declare a blurb');
  const fromContent = (declared[1].match(/'([^']*)'/g) || [])
    .map((chunk) => chunk.slice(1, -1))
    .join('')
    .trim();
  assert.ok(fromContent.length > 0, 'the blurb must not be empty');

  const staticCopy = /<p class="hero__blurb[^"]*"[^>]*>([^<]+)<\/p>/.exec(html);
  assert.ok(staticCopy, 'index.html must carry a static hero blurb');

  assert.strictEqual(
    staticCopy[1].trim(),
    fromContent,
    'Blurb drift: edit content/site.js, then mirror it into the #hero-blurb <p> ' +
      'in index.html. content/site.js is what visitors actually see.'
  );
});
