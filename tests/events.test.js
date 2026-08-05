'use strict';

/**
 * U4 events-model tests (R8, KTD15).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/events-model.js is deliberately DOM-free: Node has no `document` and the
 * no-install rule rules out jsdom (KTD15), so the partition rule - which night
 * is still to come, which has been and gone, and in what order they read - is
 * tested here as plain data in, plain data out. The DOM half of the events
 * section lives in js/sections.js and is verified in the browser.
 *
 * EVERY FIXTURE IS BUILT RELATIVE TO AN INJECTED "now". No test in this file
 * may read the real clock: a suite that hardcodes a future date turns red on
 * its own one morning and teaches everybody to ignore it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODEL_FILE = path.join(ROOT, 'js', 'events-model.js');

/** The injected clock. Arbitrary, fixed, and the only "today" in this file. */
const NOW = Date.parse('2027-05-14T13:45:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD string this many days either side of the injected now. */
function dayOffset(days) {
  return new Date(NOW + days * DAY).toISOString().slice(0, 10);
}

function night(title, days, extra) {
  const event = {
    title: title,
    date: dayOffset(days),
    venue: 'The Annexe',
    city: 'London',
  };
  return Object.assign(event, extra || {});
}

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
  const model = globalThis.LUVIZ && globalThis.LUVIZ.eventsModel;
  assert.ok(model, 'js/events-model.js must define window.LUVIZ.eventsModel');
  return model;
}

const titles = (list) => list.map((e) => e.title);

// ---------------------------------------------------------------------------
// KTD15: the module is pure
// ---------------------------------------------------------------------------

test('the events model is DOM-free and loads under Node (KTD15)', () => {
  const source = fs.readFileSync(MODEL_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [
    /\bdocument\b/,
    /\bnavigator\b/,
    /\blocalStorage\b/,
    /\bmatchMedia\b/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
  ]) {
    assert.ok(
      !forbidden.test(source),
      'js/events-model.js must stay DOM-free; found ' + forbidden
    );
  }
  assert.ok(
    !/^\s*(import|export)\b/m.test(source),
    'js/events-model.js must be a classic script, never a module (KTD1)'
  );
  const model = loadModel();
  assert.equal(typeof model.partition, 'function');
});

test('the model never reads the clock for itself', () => {
  const source = fs.readFileSync(MODEL_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/Date\.now\s*\(/.test(source) && !/new\s+Date\s*\(\s*\)/.test(source),
    '"now" must always be injected, so the caller decides what today is'
  );
});

// ---------------------------------------------------------------------------
// R8: the partition
// ---------------------------------------------------------------------------

test('an event dated in the future partitions to upcoming', () => {
  const model = loadModel();
  const result = model.partition([night('Night 020', 12)], NOW);
  assert.deepEqual(titles(result.upcoming), ['Night 020']);
  assert.deepEqual(titles(result.past), []);
  assert.deepEqual(result.problems, []);
});

test('an event dated in the past partitions to past', () => {
  const model = loadModel();
  const result = model.partition([night('Night 003', -12)], NOW);
  assert.deepEqual(titles(result.upcoming), []);
  assert.deepEqual(titles(result.past), ['Night 003']);
});

test('an event dated exactly today counts as upcoming (the night has not happened yet)', () => {
  const model = loadModel();
  const result = model.partition([night('Tonight', 0)], NOW);
  assert.deepEqual(titles(result.upcoming), ['Tonight']);
  assert.deepEqual(titles(result.past), []);
});

test('yesterday is past even a minute after midnight', () => {
  const model = loadModel();
  const justAfterMidnight = Date.parse(dayOffset(0) + 'T00:01:00Z');
  const result = model.partition([night('Last Night', -1)], justAfterMidnight);
  assert.deepEqual(titles(result.past), ['Last Night']);
  assert.deepEqual(titles(result.upcoming), []);
});

test('upcoming events read soonest-first', () => {
  const model = loadModel();
  const result = model.partition(
    [night('Later', 120), night('Soon', 3), night('Middle', 30)],
    NOW
  );
  assert.deepEqual(titles(result.upcoming), ['Soon', 'Middle', 'Later']);
});

test('past events read most-recent-first', () => {
  const model = loadModel();
  const result = model.partition(
    [night('Long Ago', -400), night('Last Week', -7), night('Last Month', -35)],
    NOW
  );
  assert.deepEqual(titles(result.past), ['Last Week', 'Last Month', 'Long Ago']);
});

test('a mixed list splits and sorts in one pass, leaving the input untouched', () => {
  const model = loadModel();
  const input = [
    night('Past B', -20),
    night('Future B', 40),
    night('Past A', -2),
    night('Future A', 6),
  ];
  const before = input.slice();
  const result = model.partition(input, NOW);
  assert.deepEqual(titles(result.upcoming), ['Future A', 'Future B']);
  assert.deepEqual(titles(result.past), ['Past A', 'Past B']);
  assert.deepEqual(input, before, 'partition must not reorder the caller\'s array');
  assert.equal(result.upcoming[0], input[3], 'entries are passed through by reference');
});

test('two nights on the same date keep the order they were written in', () => {
  const model = loadModel();
  const result = model.partition(
    [night('First Written', 9), night('Second Written', 9)],
    NOW
  );
  assert.deepEqual(titles(result.upcoming), ['First Written', 'Second Written']);
});

test('now may be given as a Date as well as a number of milliseconds', () => {
  const model = loadModel();
  const events = [night('Soon', 5), night('Gone', -5)];
  const fromNumber = model.partition(events, NOW);
  const fromDate = model.partition(events, new Date(NOW));
  assert.deepEqual(titles(fromDate.upcoming), titles(fromNumber.upcoming));
  assert.deepEqual(titles(fromDate.past), titles(fromNumber.past));
});

// ---------------------------------------------------------------------------
// Empty and malformed input
// ---------------------------------------------------------------------------

test('an empty list returns empty partitions rather than throwing', () => {
  const model = loadModel();
  const result = model.partition([], NOW);
  assert.deepEqual(result.upcoming, []);
  assert.deepEqual(result.past, []);
  assert.deepEqual(result.problems, []);
  assert.equal(result.total, 0);
});

test('a missing events list is reported, not thrown', () => {
  const model = loadModel();
  for (const bad of [undefined, null, 'not a list', 42, {}]) {
    const result = model.partition(bad, NOW);
    assert.deepEqual(result.upcoming, []);
    assert.deepEqual(result.past, []);
    assert.equal(result.problems.length, 1, 'expected one plain-English problem');
    assert.match(result.problems[0].message, /content\/events\.js/);
  }
});

test('a malformed date is reported rather than silently dropped', () => {
  const model = loadModel();
  const result = model.partition(
    [
      night('Good Night', 10),
      { title: 'Wrong Format', date: '19/09/2027', venue: 'Bath House', city: 'Bristol' },
      { title: 'Impossible Day', date: '2027-02-31', venue: 'Bath House', city: 'Bristol' },
      { title: 'No Date At All', venue: 'Bath House', city: 'Bristol' },
    ],
    NOW
  );

  assert.deepEqual(titles(result.upcoming), ['Good Night']);
  assert.deepEqual(titles(result.past), []);
  assert.equal(result.problems.length, 3, 'every unreadable date must be reported');

  const reported = result.problems.map((p) => p.event.title).sort();
  assert.deepEqual(reported, ['Impossible Day', 'No Date At All', 'Wrong Format']);

  for (const problem of result.problems) {
    assert.match(problem.message, /YYYY-MM-DD/, 'say what a date should look like');
    assert.ok(
      problem.message.indexOf(problem.event.title) !== -1,
      'name the night that is wrong: ' + problem.message
    );
    assert.ok(
      !/undefined|\[object Object\]|NaN/.test(problem.message),
      'problems must read as English: ' + problem.message
    );
  }

  // Nothing is lost: every entry is either partitioned or reported.
  assert.equal(
    result.upcoming.length + result.past.length + result.problems.length,
    result.total
  );
});

test('an entry that is not a block at all is reported, not crashed on', () => {
  const model = loadModel();
  const result = model.partition([null, 'a bare string', night('Real', 4)], NOW);
  assert.deepEqual(titles(result.upcoming), ['Real']);
  assert.equal(result.problems.length, 2);
  for (const problem of result.problems) {
    assert.ok(!/undefined|\[object Object\]/.test(problem.message), problem.message);
  }
});

// ---------------------------------------------------------------------------
// Date formatting: pure here, so the view stays thin
// ---------------------------------------------------------------------------

test('a date formats to fixed English parts, with no locale in the way', () => {
  const model = loadModel();
  const parts = model.formatDate('2027-09-19');
  assert.equal(parts.iso, '2027-09-19');
  assert.equal(parts.day, '19');
  assert.equal(parts.month, 'SEP');
  assert.equal(parts.year, '2027');
  assert.equal(parts.weekday, 'SUN');
  assert.equal(parts.long, 'Sunday 19 September 2027');
});

test('formatting an unreadable date says so instead of printing NaN', () => {
  const model = loadModel();
  const parts = model.formatDate('19/09/2027');
  assert.equal(parts.ok, false);
  assert.ok(!/NaN|undefined/.test(parts.long + parts.day + parts.month), parts.long);
});

// ---------------------------------------------------------------------------
// The whole shipped placeholder set, judged against an injected now
// ---------------------------------------------------------------------------

test('the shipped placeholder events split into both lists at a fixed reference date', () => {
  const model = loadModel();
  globalThis.window = globalThis;
  delete require.cache[require.resolve(path.join(ROOT, 'js', 'namespace.js'))];
  require(path.join(ROOT, 'js', 'namespace.js'));
  delete require.cache[require.resolve(path.join(ROOT, 'content', 'events.js'))];
  require(path.join(ROOT, 'content', 'events.js'));

  const events = globalThis.LUVIZ.events;
  const reference = Date.parse('2026-08-05T00:00:00Z');
  const result = model.partition(events, reference);

  assert.deepEqual(result.problems, [], 'the shipped placeholders must all be readable');
  assert.ok(result.upcoming.length > 0, 'placeholders must demonstrate an upcoming night');
  assert.ok(result.past.length > 0, 'placeholders must demonstrate a past night');
  for (let i = 1; i < result.upcoming.length; i += 1) {
    assert.ok(result.upcoming[i - 1].date <= result.upcoming[i].date, 'upcoming ascends');
  }
  for (let i = 1; i < result.past.length; i += 1) {
    assert.ok(result.past[i - 1].date >= result.past[i].date, 'past descends');
  }
});
