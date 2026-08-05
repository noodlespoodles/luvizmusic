'use strict';

/**
 * U7 intensity-signal tests (R17, R19, R20; KTD10).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * ------------------------------------------------------------------------
 * HONEST LABEL - READ THIS BEFORE TRUSTING A GREEN RUN.
 *
 * The clock, the frames, the viewport and every input event below are
 * injected plain values. There is no DOM, no pointer, no touchscreen and no
 * GSAP (KTD15). These tests prove the SHAPE and the BOUNDS of the signal:
 * that `amount` cannot leave 0-1 however violent the input, that `x`/`y`
 * cannot leave -1..1, that touch resolves to x === 0 deterministically, and
 * that reduced motion holds everything at neutral. They cannot prove that a
 * real trackpad, a real touchscreen or GSAP's Observer feed the signal the
 * values these tests hand it. That is the owner's device check: the same
 * effects must respond on a phone as on a laptop (R17).
 * ------------------------------------------------------------------------
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INTENSITY = path.join(ROOT, 'js', 'intensity.js');

const VIEWPORT = { width: 1000, height: 800 };

// ---------------------------------------------------------------------------
// Loading the classic browser script under Node
// ---------------------------------------------------------------------------

function load(env) {
  const setup = env || {};
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  delete globalThis.gsap;
  delete globalThis.Observer;
  if (setup.gsap) {
    globalThis.gsap = setup.gsap;
  }
  if (setup.Observer) {
    globalThis.Observer = setup.Observer;
  }
  delete require.cache[require.resolve(INTENSITY)];
  require(INTENSITY);
  return globalThis.LUVIZ.intensity;
}

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
    add(fn) {
      callbacks.push(fn);
    },
    remove(fn) {
      const index = callbacks.indexOf(fn);
      if (index >= 0) {
        callbacks.splice(index, 1);
      }
    },
    live() {
      return callbacks.length;
    },
    fire() {
      callbacks.slice().forEach((fn) => fn());
    },
  };
}

function makeSignal(overrides) {
  const intensity = (overrides && overrides.intensity) || load();
  const time = makeTime(0);
  const frames = makeFrames();
  const signal = intensity.create(
    Object.assign(
      {
        now: time.now,
        frames: frames,
        viewport: () => VIEWPORT,
      },
      overrides || {}
    )
  );
  signal.start();
  return { intensity, signal, time, frames };
}

/** Runs `count` frames of `stepMs`, calling `input(i)` between each. */
function drive(ctx, count, stepMs, input) {
  for (let i = 0; i < count; i++) {
    ctx.time.advance(stepMs);
    if (input) {
      input(i);
    }
    ctx.frames.fire();
  }
}

// ---------------------------------------------------------------------------
// The shape of the signal
// ---------------------------------------------------------------------------

test('the signal is exactly { amount, x, y } and cannot be mutated from outside', () => {
  const ctx = makeSignal({ mode: 'fine' });
  const value = ctx.signal.value();

  assert.deepEqual(Object.keys(value).sort(), ['amount', 'x', 'y']);

  value.amount = 99;
  value.x = 99;
  assert.equal(ctx.signal.value().amount, 0, 'a consumer must not be able to write the signal');
  assert.equal(ctx.signal.value().x, 0);
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

test('amount stays within 0-1 for arbitrarily large input velocities', () => {
  const fine = makeSignal({ mode: 'fine' });
  let px = 500;
  drive(fine, 200, 16, (i) => {
    px += 1e9 * (i % 2 === 0 ? 1 : -1);
    fine.signal.pointer({ x: px, y: 400 });
    const value = fine.signal.value();
    assert.ok(value.amount >= 0 && value.amount <= 1, 'amount left 0-1: ' + value.amount);
  });
  assert.ok(fine.signal.value().amount <= 1);

  const coarse = makeSignal({ mode: 'coarse' });
  drive(coarse, 200, 16, (i) => {
    coarse.signal.scroll({ deltaY: 1e9 * (i % 2 === 0 ? 1 : -1) });
    const value = coarse.signal.value();
    assert.ok(value.amount >= 0 && value.amount <= 1, 'amount left 0-1: ' + value.amount);
  });
  assert.ok(coarse.signal.value().amount <= 1);
});

test('x and y stay within -1..1 however far outside the viewport the input goes', () => {
  const ctx = makeSignal({ mode: 'fine' });

  [
    { x: -999999, y: -999999 },
    { x: 999999, y: 999999 },
    { x: 0, y: 0 },
    { x: VIEWPORT.width, y: VIEWPORT.height },
  ].forEach((point) => {
    ctx.time.advance(16);
    ctx.signal.pointer(point);
    ctx.frames.fire();
    const value = ctx.signal.value();
    assert.ok(value.x >= -1 && value.x <= 1, 'x left -1..1: ' + value.x);
    assert.ok(value.y >= -1 && value.y <= 1, 'y left -1..1: ' + value.y);
  });

  /* Dead centre is 0,0; the corners are the extremes. */
  ctx.time.advance(16);
  ctx.signal.pointer({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
  ctx.frames.fire();
  assert.equal(ctx.signal.value().x, 0);
  assert.equal(ctx.signal.value().y, 0);

  ctx.time.advance(16);
  ctx.signal.pointer({ x: 250, y: 600 });
  ctx.frames.fire();
  assert.ok(Math.abs(ctx.signal.value().x - -0.5) < 1e-9, 'a quarter across is -0.5');
  assert.ok(Math.abs(ctx.signal.value().y - 0.5) < 1e-9, 'three quarters down is 0.5');
});

// ---------------------------------------------------------------------------
// The two input classes rest identically (KTD10)
// ---------------------------------------------------------------------------

test('touch input yields x === 0 deterministically, and y carries the scroll direction', () => {
  const ctx = makeSignal({ mode: 'coarse' });

  drive(ctx, 20, 16, () => ctx.signal.scroll({ deltaY: 90 }));
  let value = ctx.signal.value();
  assert.equal(value.x, 0, 'touch has no horizontal axis to read');
  assert.equal(value.y, 1, 'scrolling down is +1');
  assert.ok(value.amount > 0, 'scroll velocity must carry energy');

  drive(ctx, 20, 16, () => ctx.signal.scroll({ deltaY: -90 }));
  value = ctx.signal.value();
  assert.equal(value.x, 0);
  assert.equal(value.y, -1, 'scrolling up is -1');

  /* A stray pointer event on a touch profile must not open a second input
     path: that is exactly the silent R17 break KTD10 exists to prevent. */
  drive(ctx, 5, 16, () => ctx.signal.pointer({ x: 0, y: 0 }));
  assert.equal(ctx.signal.value().x, 0, 'a pointer event must not move x on a touch profile');
  assert.equal(ctx.signal.value().y, -1, 'a pointer event must not move y on a touch profile');
});

test('amount decays toward 0 at rest while x and y hold, on both input classes', () => {
  /* Fine pointer. */
  const fine = makeSignal({ mode: 'fine' });
  let px = 500;
  drive(fine, 60, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    fine.signal.pointer({ x: px, y: 400 });
  });
  fine.time.advance(16);
  fine.signal.pointer({ x: 250, y: 600 });
  fine.frames.fire();

  const movingFine = fine.signal.value();
  assert.ok(movingFine.amount > 0.3, 'sustained movement must build energy, got ' + movingFine.amount);

  drive(fine, 60, 50, null);
  const restingFine = fine.signal.value();
  assert.ok(restingFine.amount < 0.05, 'amount must decay at rest, got ' + restingFine.amount);
  assert.equal(restingFine.x, movingFine.x, 'x must hold its last value at rest');
  assert.equal(restingFine.y, movingFine.y, 'y must hold its last value at rest');

  /* Touch. */
  const coarse = makeSignal({ mode: 'coarse' });
  drive(coarse, 60, 16, () => coarse.signal.scroll({ deltaY: 60 }));
  const movingCoarse = coarse.signal.value();
  assert.ok(movingCoarse.amount > 0.3, 'sustained scrolling must build energy');

  drive(coarse, 60, 50, null);
  const restingCoarse = coarse.signal.value();
  assert.ok(restingCoarse.amount < 0.05, 'amount must decay at rest, got ' + restingCoarse.amount);
  assert.equal(restingCoarse.x, 0);
  assert.equal(restingCoarse.y, movingCoarse.y, 'y must hold its last direction at rest');

  /* The whole point of KTD10: both classes come to rest in the same shape. */
  assert.ok(Math.abs(restingFine.amount - restingCoarse.amount) < 0.05);
});

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

test('smoothing damps a single large spike rather than passing it through', () => {
  const ctx = makeSignal({ mode: 'fine' });

  ctx.time.advance(16);
  ctx.signal.pointer({ x: 500, y: 400 });
  ctx.frames.fire();
  assert.equal(ctx.signal.value().amount, 0, 'the first sample sets a reference, not a velocity');

  /* One trackpad flick that would saturate the raw signal. */
  ctx.time.advance(16);
  ctx.signal.pointer({ x: 5500, y: 400 });
  ctx.frames.fire();

  const spike = ctx.signal.value().amount;
  assert.ok(spike > 0, 'the flick must register');
  assert.ok(spike < 0.25, 'one frame of a saturating flick reached ' + spike.toFixed(3) + ' of full effect');

  /* Held input still reaches full strength, so smoothing is a lag, not a cap. */
  let px = 500;
  drive(ctx, 120, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
  });
  assert.ok(ctx.signal.value().amount > 0.8, 'sustained input must still reach full strength');
});

// ---------------------------------------------------------------------------
// Pointer class resolution
// ---------------------------------------------------------------------------

test('a hybrid coarse+fine device resolves deterministically, not by evaluation order', () => {
  const intensity = load();

  assert.equal(intensity.resolveMode({ fine: true, coarse: false }), 'fine');
  assert.equal(intensity.resolveMode({ fine: false, coarse: true }), 'coarse');

  /* The pathological case: a device claiming both. The answer must be the
     same whichever key is written first and whichever query is asked first. */
  assert.equal(intensity.resolveMode({ fine: true, coarse: true }), 'coarse');
  assert.equal(intensity.resolveMode({ coarse: true, fine: true }), 'coarse');

  function recorder(order) {
    const asked = [];
    const matchMedia = (query) => {
      asked.push(query);
      return { matches: true, media: query };
    };
    matchMedia.asked = asked;
    matchMedia.order = order;
    return matchMedia;
  }

  const first = recorder('a');
  const second = recorder('b');
  assert.equal(intensity.readProfile(first).mode, intensity.readProfile(second).mode);
  assert.equal(intensity.readProfile(first).mode, 'coarse');

  /* A touchscreen laptop: the PRIMARY pointer is fine, and `any-pointer`
     must never be consulted, or every such laptop loses pointer parallax. */
  const laptopAsked = [];
  const laptop = (query) => {
    laptopAsked.push(query);
    return { matches: /\(\s*pointer:\s*fine\s*\)/.test(query) || /any-pointer:\s*coarse/.test(query) };
  };
  assert.equal(intensity.readProfile(laptop).mode, 'fine');
  assert.equal(
    laptopAsked.filter((q) => q.indexOf('any-pointer') >= 0).length,
    0,
    'mode must come from the primary pointer alone'
  );

  /* No matchMedia at all: fall back to the class that works everywhere. */
  assert.equal(intensity.readProfile(null).mode, 'coarse');

  /* And the resolution survives into the instance. */
  const ctx = makeSignal({ intensity: intensity, matchMedia: recorder('c') });
  assert.equal(ctx.signal.mode(), 'coarse');
});

// ---------------------------------------------------------------------------
// Reduced motion (R19)
// ---------------------------------------------------------------------------

test('under prefers-reduced-motion: reduce the signal holds at neutral', () => {
  const ctx = makeSignal({ mode: 'fine', reducedMotion: true });

  assert.equal(ctx.frames.live(), 0, 'reduced motion must not even subscribe to frames');

  let px = 500;
  drive(ctx, 60, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
    ctx.signal.scroll({ deltaY: 200 });
  });

  assert.deepEqual(ctx.signal.value(), { amount: 0, x: 0, y: 0 });

  /* Turning the preference off mid-session brings the signal back. */
  ctx.signal.setReducedMotion(false);
  drive(ctx, 60, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
  });
  assert.ok(ctx.signal.value().amount > 0.3, 'clearing the preference must restore the signal');

  /* And turning it on mid-session snaps back to neutral immediately. */
  ctx.signal.setReducedMotion(true);
  assert.deepEqual(ctx.signal.value(), { amount: 0, x: 0, y: 0 });
});

test('a suspended signal ignores input and decays to rest', () => {
  const ctx = makeSignal({ mode: 'fine' });

  let px = 500;
  drive(ctx, 60, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
  });
  const moving = ctx.signal.value();
  assert.ok(moving.amount > 0.3);

  ctx.signal.setActive(false);
  drive(ctx, 60, 50, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
  });
  const suspended = ctx.signal.value();
  assert.ok(suspended.amount < 0.05, 'a suspended signal must not keep responding');
  assert.equal(suspended.x, moving.x, 'x holds while suspended');

  ctx.signal.setActive(true);
  drive(ctx, 60, 16, (i) => {
    px = i % 2 === 0 ? 900 : 100;
    ctx.signal.pointer({ x: px, y: 400 });
  });
  assert.ok(ctx.signal.value().amount > 0.3, 'resuming brings the signal back');
});

// ---------------------------------------------------------------------------
// Change notification and the input seam
// ---------------------------------------------------------------------------

test('consumers can subscribe to the signal instead of polling it', () => {
  const ctx = makeSignal({ mode: 'coarse' });
  const seen = [];
  const off = ctx.signal.on('change', (value) => seen.push(value));

  drive(ctx, 10, 16, () => ctx.signal.scroll({ deltaY: 80 }));
  assert.ok(seen.length > 0, 'a moving signal must notify');
  assert.deepEqual(Object.keys(seen[0]).sort(), ['amount', 'x', 'y']);

  off();
  const before = seen.length;
  drive(ctx, 10, 16, () => ctx.signal.scroll({ deltaY: 80 }));
  assert.equal(seen.length, before, 'unsubscribing must stop the notifications');
});

test('input is sourced through GSAP Observer when present, plain listeners when not', () => {
  /* With Observer: one place normalises pointer, touch, wheel and scroll. */
  const created = [];
  const withObserver = load({
    Observer: {
      create(config) {
        created.push(config);
        return { kill() {} };
      },
    },
  });
  const target = { addEventListener() {}, removeEventListener() {} };
  const observed = withObserver.create({ now: () => 0, viewport: () => VIEWPORT, mode: 'fine' });
  const detachObserver = observed.attach({ target: target });

  assert.equal(observed.inputSource(), 'gsap.Observer');
  assert.equal(created.length, 1);
  ['wheel', 'touch', 'pointer', 'scroll'].forEach((type) => {
    assert.ok(
      String(created[0].type).indexOf(type) >= 0,
      'Observer must normalise ' + type + ', or R17 needs a second input path'
    );
  });
  detachObserver();

  /* Without Observer: plain listeners, same signal, same contract. */
  const bare = load();
  const listeners = {};
  const plainTarget = {
    addEventListener(type, cb) {
      (listeners[type] || (listeners[type] = [])).push(cb);
    },
    removeEventListener(type, cb) {
      const list = listeners[type] || [];
      const index = list.indexOf(cb);
      if (index >= 0) {
        list.splice(index, 1);
      }
    },
  };
  const plain = bare.create({ now: () => 0, viewport: () => VIEWPORT, mode: 'fine' });
  const detachPlain = plain.attach({ target: plainTarget });

  assert.equal(plain.inputSource(), 'listeners');
  assert.ok(Object.keys(listeners).length > 0, 'the fallback must actually listen for something');

  detachPlain();
  Object.keys(listeners).forEach((type) => {
    assert.equal(listeners[type].length, 0, 'detach must remove the ' + type + ' listener');
  });
});
