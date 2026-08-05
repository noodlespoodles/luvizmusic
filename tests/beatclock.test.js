'use strict';

/**
 * U7 beat-clock tests (R16, R19, R20; KTD3).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * ------------------------------------------------------------------------
 * HONEST LABEL - READ THIS BEFORE TRUSTING A GREEN RUN.
 *
 * Everything below runs on an INJECTED clock and an INJECTED frame source.
 * There is no timer, no DOM, no audio and no provider (KTD15). That proves
 * the tempo maths, the phase, the drift rule and the R20 rate bound. It
 * cannot prove that a real SoundCloud widget reports position the way the
 * drift correction assumes, and it cannot prove the pulse LOOKS on the beat.
 * Closing that gap is the owner's ten-minute listen over PREVIEW-SITE.bat:
 * a mix with a beat grid should still be visibly on the beat at minute ten,
 * not only at the start.
 * ------------------------------------------------------------------------
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BEAT_CLOCK = path.join(ROOT, 'js', 'beat-clock.js');
const NAMESPACE = path.join(ROOT, 'js', 'namespace.js');
const MIXES = path.join(ROOT, 'content', 'mixes.js');

/** R20's ceiling, restated here so the test does not read it off the source. */
const MAX_EVENTS_PER_SECOND = 2.5;

// ---------------------------------------------------------------------------
// Loading the classic browser script under Node
// ---------------------------------------------------------------------------

function fresh(file) {
  delete require.cache[require.resolve(file)];
  require(file);
}

/**
 * Loads js/beat-clock.js against a chosen set of globals, so the frame-source
 * fallback chain (gsap.ticker -> requestAnimationFrame -> none) can be tested
 * before GSAP exists in this project at all.
 */
function load(env) {
  const setup = env || {};
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  delete globalThis.gsap;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  if (setup.gsap) {
    globalThis.gsap = setup.gsap;
  }
  if (setup.raf) {
    globalThis.requestAnimationFrame = setup.raf.request;
    globalThis.cancelAnimationFrame = setup.raf.cancel;
  }
  fresh(BEAT_CLOCK);
  return globalThis.LUVIZ.beatClock;
}

// ---------------------------------------------------------------------------
// Injected clock and injected frame source
// ---------------------------------------------------------------------------

function makeTime(start) {
  let t = typeof start === 'number' ? start : 0;
  return {
    now() {
      return t;
    },
    advance(ms) {
      t += ms;
    },
  };
}

/** A gsap.ticker-shaped frame source that only ticks when a test says so. */
function makeFrames() {
  const callbacks = [];
  return {
    adds: 0,
    removes: 0,
    add(fn) {
      callbacks.push(fn);
      this.adds += 1;
    },
    remove(fn) {
      const index = callbacks.indexOf(fn);
      if (index >= 0) {
        callbacks.splice(index, 1);
      }
      this.removes += 1;
    },
    live() {
      return callbacks.length;
    },
    fire() {
      callbacks.slice().forEach((fn) => fn());
    },
  };
}

/** Plays `ms` of the mix at `step`-millisecond frames. */
function play(time, frames, ms, step) {
  const dt = step || 16;
  for (let elapsed = 0; elapsed < ms; elapsed += dt) {
    time.advance(dt);
    frames.fire();
  }
}

function harness(options) {
  const opts = options || {};
  const beatClock = opts.beatClock || load();
  const time = makeTime(0);
  const frames = makeFrames();
  const clock = beatClock.create(
    Object.assign(
      {
        now: time.now,
        frames: frames,
        playing: true,
      },
      opts.create || {}
    )
  );
  const beats = [];
  clock.on('beat', (beat) => beats.push(beat));
  clock.start();
  return { beatClock, clock, time, frames, beats };
}

// ---------------------------------------------------------------------------
// Tempo maths
// ---------------------------------------------------------------------------

test('120 BPM computes a 500ms beat interval', () => {
  const beatClock = load();
  assert.equal(beatClock.intervalFor(120), 500);
  assert.equal(beatClock.intervalFor(60), 1000);
  assert.equal(beatClock.intervalFor(124), 60000 / 124);
});

test('a zero, negative or nonsense BPM is rejected, never an infinite interval', () => {
  const beatClock = load();
  [0, -1, -120, NaN, Infinity, -Infinity, null, undefined, '120', {}].forEach((bpm) => {
    const interval = beatClock.intervalFor(bpm);
    assert.equal(interval, 0, 'bpm ' + String(bpm) + ' must not yield an interval');
    assert.ok(isFinite(interval), 'bpm ' + String(bpm) + ' must not yield an infinite interval');
  });

  /* A grid made only of nonsense is the same as no grid at all: no pulse. */
  const plan = beatClock.plan([{ atMs: 0, bpm: 0 }, { atMs: 1000, bpm: -120 }]);
  assert.deepEqual(plan, []);

  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 0 }] },
  });
  play(time, frames, 10000);
  assert.equal(beats.length, 0, 'a rejected tempo must produce silence, not a runaway pulse');
  assert.equal(clock.beatIntervalMs(), 0);
  assert.equal(clock.pulses(), false);
});

test('a segment above 150 BPM subdivides so nothing can tick faster than 2.5 per second', () => {
  const beatClock = load();
  assert.equal(beatClock.subdivisionFor(120), 1);
  assert.equal(beatClock.subdivisionFor(150), 1, '150 BPM is exactly 2.5 beats per second');
  assert.equal(beatClock.subdivisionFor(151), 2);
  assert.equal(beatClock.subdivisionFor(180), 2);
  assert.equal(beatClock.subdivisionFor(200), 2);

  [60, 100, 120, 150, 151, 174, 180, 200].forEach((bpm) => {
    const rate = 1000 / (beatClock.intervalFor(bpm) * beatClock.subdivisionFor(bpm));
    assert.ok(
      rate <= MAX_EVENTS_PER_SECOND + 1e-9,
      bpm + ' BPM would drive consumers at ' + rate.toFixed(2) + ' events per second'
    );
  });
});

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

test('beat phase advances 0 to 1 across one interval and wraps', () => {
  const beatClock = load();
  const plan = beatClock.plan([{ atMs: 0, bpm: 120 }]);

  assert.equal(beatClock.phaseAt(plan, 0), 0);
  assert.equal(beatClock.phaseAt(plan, 125), 0.25);
  assert.equal(beatClock.phaseAt(plan, 250), 0.5);
  assert.equal(beatClock.phaseAt(plan, 375), 0.75);
  assert.equal(beatClock.phaseAt(plan, 500), 0, 'phase wraps at the beat, it does not reach 1');
  assert.equal(beatClock.phaseAt(plan, 625), 0.25);

  /* Every sample is a normalised 0-1 value, wrapping exactly once per beat. */
  let wraps = 0;
  let previous = beatClock.phaseAt(plan, 0);
  for (let pos = 10; pos <= 5000; pos += 10) {
    const phase = beatClock.phaseAt(plan, pos);
    assert.ok(phase >= 0 && phase < 1, 'phase left 0-1 at ' + pos + 'ms');
    if (phase < previous) {
      wraps += 1;
    }
    previous = phase;
  }
  assert.equal(wraps, 10, '5000ms at 120 BPM is ten wraps');
});

test('a position inside the second segment uses THAT segment tempo, not the first', () => {
  const beatClock = load();
  const plan = beatClock.plan([
    { atMs: 0, bpm: 118 },
    { atMs: 1140000, bpm: 124 },
    { atMs: 2760000, bpm: 128 },
  ]);

  assert.equal(beatClock.segmentAt(plan, 0).bpm, 118);
  assert.equal(beatClock.segmentAt(plan, 1139999).bpm, 118);
  assert.equal(beatClock.segmentAt(plan, 1140000).bpm, 124, 'the segment owns its own anchor');
  assert.equal(beatClock.segmentAt(plan, 1500000).bpm, 124);
  assert.equal(beatClock.segmentAt(plan, 1500000).beatMs, 60000 / 124);
});

test('a position past the last anchor uses the last segment', () => {
  const beatClock = load();
  const plan = beatClock.plan([
    { atMs: 0, bpm: 118 },
    { atMs: 1140000, bpm: 124 },
    { atMs: 2760000, bpm: 128 },
  ]);
  assert.equal(beatClock.segmentAt(plan, 2760000).bpm, 128);
  assert.equal(beatClock.segmentAt(plan, 9000000).bpm, 128, 'nine minutes past the end still pulses');

  /* And a position before the first anchor holds the first segment. */
  assert.equal(beatClock.segmentAt(plan, -5000).bpm, 118);
});

test('phase is continuous across a segment boundary', () => {
  const beatClock = load();

  /* A deliberately UNBEATMATCHED transition: 10250ms is half a beat past the
     20th beat of a 120 BPM segment. A naive re-anchor at atMs would jump the
     phase from 0.498 to 0, which a consumer sees as a stuttered beat. */
  const plan = beatClock.plan([
    { atMs: 0, bpm: 120 },
    { atMs: 10250, bpm: 96 },
  ]);

  let previous = beatClock.phaseAt(plan, 10000);
  let worst = 0;
  for (let pos = 10002; pos <= 10500; pos += 2) {
    const phase = beatClock.phaseAt(plan, pos);
    let step = phase - previous;
    if (step < -0.5) {
      step += 1; /* an ordinary wrap, not a discontinuity */
    }
    worst = Math.max(worst, Math.abs(step));
    previous = phase;
  }
  assert.ok(worst < 0.02, 'phase jumped by ' + worst.toFixed(3) + ' across the segment boundary');

  /* A beatmatched transition still anchors phase 0 exactly on the new atMs. */
  const aligned = beatClock.plan([
    { atMs: 0, bpm: 120 },
    { atMs: 10000, bpm: 96 },
  ]);
  assert.equal(beatClock.phaseAt(aligned, 10000), 0);
});

// ---------------------------------------------------------------------------
// Beat boundary events
// ---------------------------------------------------------------------------

test('a 120 BPM segment fires two beat boundaries a second, on the beat', () => {
  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }] },
  });

  play(time, frames, 10000);

  assert.ok(beats.length >= 18 && beats.length <= 20, 'ten seconds at 120 BPM is ~20 beats, got ' + beats.length);
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i].positionMs - beats[i - 1].positionMs;
    assert.ok(Math.abs(gap - 500) <= 20, 'beat ' + i + ' landed ' + gap.toFixed(1) + 'ms after the last');
  }
  assert.equal(clock.beatIntervalMs(), 500);
  assert.equal(clock.pulseIntervalMs(), 500);
  assert.ok(clock.phase() >= 0 && clock.phase() < 1);
});

test('a 180 BPM segment yields boundary events at or below 2.5 per second (R20)', () => {
  const { time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 180 }] },
  });

  const seconds = 20;
  play(time, frames, seconds * 1000);

  const rate = beats.length / seconds;
  assert.ok(beats.length > 0, '180 BPM must still pulse, just not three times a second');
  assert.ok(
    rate <= MAX_EVENTS_PER_SECOND,
    '180 BPM drove consumers at ' + rate.toFixed(2) + ' events per second'
  );

  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i].positionMs - beats[i - 1].positionMs;
    assert.ok(gap >= 1000 / MAX_EVENTS_PER_SECOND - 20, 'two boundaries only ' + gap.toFixed(1) + 'ms apart');
  }
});

test('an absent or empty beat grid produces no beat events at all (R16)', () => {
  const beatClock = load();

  const cases = [
    { label: 'no beatGrid key', mix: { title: 'Panorama - System Test, 3am', provider: 'mixcloud' } },
    { label: 'an empty beatGrid', mix: { title: 'x', provider: 'file', beatGrid: [] } },
    { label: 'a null beatGrid', mix: { title: 'x', provider: 'file', beatGrid: null } },
  ];

  cases.forEach((entry) => {
    const time = makeTime(0);
    const frames = makeFrames();
    const clock = beatClock.create({ now: time.now, frames: frames, playing: true, mix: entry.mix });
    const beats = [];
    clock.on('beat', (beat) => beats.push(beat));
    clock.start();
    play(time, frames, 30000);

    assert.equal(beats.length, 0, entry.label + ' must stay silent rather than pulse wrongly');
    assert.equal(clock.pulses(), false, entry.label);
    assert.equal(clock.phase(), 0, entry.label);
    assert.equal(clock.bpm(), 0, entry.label);
  });
});

test('no beat events under prefers-reduced-motion: reduce (R19)', () => {
  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }], reducedMotion: true },
  });

  play(time, frames, 20000);

  assert.equal(beats.length, 0, 'reduced motion must emit no boundary events');
  assert.equal(clock.phase(), 0, 'reduced motion holds phase at rest');
  assert.equal(frames.live(), 0, 'reduced motion must not even subscribe to frames');

  /* And it resumes if the visitor turns the preference off mid-session. */
  clock.setReducedMotion(false);
  play(time, frames, 3000);
  assert.ok(beats.length > 0, 'clearing the preference must bring the pulse back');
});

test('the pulse suspends while playback is paused and resumes on play', () => {
  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }], playing: false },
  });

  play(time, frames, 5000);
  assert.equal(beats.length, 0, 'a paused mix must not pulse');
  assert.equal(clock.positionMs(), 0, 'a paused mix does not advance');

  clock.setPlaying(true);
  play(time, frames, 5000);
  const afterPlay = beats.length;
  assert.ok(afterPlay > 0, 'the pulse must come back on play');
  assert.ok(Math.abs(clock.positionMs() - 5000) <= 20, 'position resumes from where it paused');

  clock.setPlaying(false);
  play(time, frames, 5000);
  assert.equal(beats.length, afterPlay, 'pausing again must stop the boundary events');
});

// ---------------------------------------------------------------------------
// Drift correction
// ---------------------------------------------------------------------------

test('a drift larger than the threshold resyncs; a smaller one does not', () => {
  const { clock, time, frames } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }], driftToleranceMs: 120 },
  });

  play(time, frames, 1000, 10);
  assert.ok(Math.abs(clock.positionMs() - 1000) <= 1, 'the clock runs itself between corrections');

  /* Small disagreement: the widget's own reporting jitter. Ignore it, or the
     pulse stutters on every progress event. */
  assert.equal(clock.sync(1050), false, '50ms of jitter must not resync');
  assert.ok(Math.abs(clock.positionMs() - 1000) <= 1, 'an ignored correction must not move the clock');

  assert.equal(clock.sync(1119), false, 'just inside the threshold is still jitter');

  /* Real disagreement: the visitor scrubbed, or the tab was throttled. */
  assert.equal(clock.sync(20000), true, 'a large disagreement must resync');
  assert.ok(Math.abs(clock.positionMs() - 20000) <= 1, 'a resync must adopt the widget position');
});

test('a resync does not fire a burst of catch-up beats', () => {
  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }] },
  });

  play(time, frames, 1000);
  const before = beats.length;

  clock.sync(600000); /* the visitor scrubbed ten minutes in */
  time.advance(16);
  frames.fire();

  assert.ok(beats.length - before <= 1, 'a ten-minute jump must not replay every skipped beat');
});

test('progress reported in seconds is accepted, since that is what the adapter emits', () => {
  const { clock, time, frames } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }] },
  });

  play(time, frames, 1000);
  assert.equal(clock.syncSeconds(45), true);
  assert.ok(Math.abs(clock.positionMs() - 45000) <= 1);
});

// ---------------------------------------------------------------------------
// Frame source injection (verifiable before U8 registers GSAP)
// ---------------------------------------------------------------------------

test('the frame source is injectable, defaults to gsap.ticker, and falls back to rAF', () => {
  /* 1. Injected source wins over everything. */
  const injected = harness({
    beatClock: load({ gsap: { ticker: { add() {}, remove() {} } } }),
    create: { beatGrid: [{ atMs: 0, bpm: 120 }] },
  });
  assert.equal(injected.clock.frameSource(), 'injected');
  assert.equal(injected.frames.live(), 1, 'start() subscribes exactly one frame callback');
  injected.clock.stop();
  assert.equal(injected.frames.live(), 0, 'stop() unsubscribes');

  /* 2. GSAP present, nothing injected: gsap.ticker drives the frames. */
  const ticker = { added: [], add(fn) { ticker.added.push(fn); }, remove(fn) { ticker.added = ticker.added.filter((f) => f !== fn); } };
  const withGsap = load({ gsap: { ticker: ticker } });
  const gsapClock = withGsap.create({ beatGrid: [{ atMs: 0, bpm: 120 }], playing: true });
  assert.equal(gsapClock.frameSource(), 'gsap.ticker');
  gsapClock.start();
  assert.equal(ticker.added.length, 1);
  gsapClock.stop();
  assert.equal(ticker.added.length, 0);

  /* 3. No GSAP: requestAnimationFrame. This is the case U7 must work in,
        because U8 has not registered anything yet. */
  const raf = { requests: 0, cancels: 0 };
  const withRaf = load({
    raf: {
      request: () => {
        raf.requests += 1;
        return raf.requests;
      },
      cancel: () => {
        raf.cancels += 1;
      },
    },
  });
  const rafClock = withRaf.create({ beatGrid: [{ atMs: 0, bpm: 120 }], playing: true });
  assert.equal(rafClock.frameSource(), 'requestAnimationFrame');
  rafClock.start();
  assert.equal(raf.requests, 1);
  rafClock.stop();
  assert.equal(raf.cancels, 1);

  /* 4. Neither: the clock still exists and can be stepped by hand. */
  const bare = load();
  const bareClock = bare.create({ beatGrid: [{ atMs: 0, bpm: 120 }], playing: true });
  assert.equal(bareClock.frameSource(), 'none');
});

test('polling only corrects drift; frames alone advance the phase', () => {
  const { clock, time, frames, beats } = harness({
    create: { beatGrid: [{ atMs: 0, bpm: 120 }] },
  });

  /* Three seconds of progress events with NO frames at all. */
  for (let i = 1; i <= 6; i++) {
    time.advance(500);
    clock.sync(i * 500);
  }
  assert.equal(beats.length, 0, 'progress events must never drive the pulse');

  play(time, frames, 3000);
  assert.ok(beats.length > 0, 'frames drive the pulse');
});

// ---------------------------------------------------------------------------
// The real content
// ---------------------------------------------------------------------------

test('every beat grid in content/mixes.js plans cleanly and respects the R20 bound', () => {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  fresh(NAMESPACE);
  fresh(MIXES);
  fresh(BEAT_CLOCK);
  const LUVIZ = globalThis.LUVIZ;
  const beatClock = LUVIZ.beatClock;

  const mixes = LUVIZ.mixes;
  assert.ok(Array.isArray(mixes) && mixes.length > 0, 'content/mixes.js must load');

  let withGrid = 0;
  let withoutGrid = 0;

  mixes.forEach((mix) => {
    const plan = beatClock.plan(mix);
    if (!LUVIZ.validate.pulses(mix)) {
      withoutGrid += 1;
      assert.deepEqual(plan, [], (mix.title || 'a mix') + ' has no grid, so it must not pulse');
      return;
    }
    withGrid += 1;
    assert.equal(
      plan.length,
      mix.beatGrid.length,
      (mix.title || 'a mix') + ': every authored segment must survive planning'
    );
    plan.forEach((segment) => {
      assert.ok(isFinite(segment.pulseMs) && segment.pulseMs > 0);
      assert.ok(
        1000 / segment.pulseMs <= MAX_EVENTS_PER_SECOND + 1e-9,
        (mix.title || 'a mix') + ' would pulse faster than R20 allows'
      );
    });
  });

  // No floor on withGrid. The shipped content is the crew's real Mixcloud
  // uploads and none carries a tempo map yet, which is the correct state: a
  // wrong bpm drifts visibly out of time within minutes, so no pulse beats a
  // guessed pulse. Multi- and single-segment planning is proven above against
  // synthetic grids, where it belongs.
  assert.equal(
    withGrid + withoutGrid,
    mixes.length,
    'every shipped mix must be classified as pulsing or not'
  );
});
