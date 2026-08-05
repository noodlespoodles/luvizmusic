/* ==========================================================================
   LUVIZMUSIC - intensity.js
   --------------------------------------------------------------------------
   The one signal every moving thing on this page reads to know how hard the
   visitor is pushing, and in which direction.

   WHY A STRUCT AND NOT A SINGLE NUMBER (KTD10)

   A scalar cannot express direction. If this file emitted only "energy", a
   pointer-driven parallax would have no legal source, and whoever wrote it
   would reach for pointermove directly - which works on a laptop, does
   nothing on a phone, and passes every test we own. That is the silent R17
   break this contract exists to prevent. So the signal is:

       { amount, x, y }

       amount   0-1. How much energy there is right now.
       x, y     -1..1. Which way. 0,0 is neutral / dead centre.

   THE TWO INPUT CLASSES, AND WHY THEY REST IDENTICALLY

     (pointer: fine)   amount comes from pointer VELOCITY.
                       x / y come from pointer POSITION relative to the
                       centre of the viewport.

     touch / coarse    amount comes from scroll velocity.
                       y is the signed scroll direction (down is +1).
                       x is 0 - a finger scrolling a page has no horizontal
                       axis to read, and inventing one would make the two
                       classes behave differently.

   Both classes decay `amount` toward 0 at rest while HOLDING the last x / y.
   That is what makes a phone and a laptop come to rest in the same shape, so
   one effect can be written once against one signal (R17).

   FOUR RULES THIS FILE ENFORCES, EACH FOR A REASON:

   1. CONSUMERS READ ONLY THE SIGNAL. Nothing here hands out a pointer event,
      a touch, a scroll position or a device flag that an effect could branch
      on. If an effect needs to behave differently on touch, that difference
      belongs in this file, in the signal.

   2. INPUT IS NORMALISED IN ONE PLACE. GSAP's Observer unifies pointer,
      touch, wheel and scroll, so attach() prefers it and falls back to plain
      listeners when GSAP is absent - the same injection discipline the beat
      clock uses, so this unit is verifiable before U8 registers anything.

   3. `amount` IS CLAMPED AND SMOOTHED. A trackpad flick or touch momentum can
      report an enormous instantaneous velocity. Passing that straight through
      would slam every effect to full strength in one frame, which is both
      ugly and exactly the kind of large-area jolt R20 exists to bound.

   4. prefers-reduced-motion: reduce HOLDS THE SIGNAL AT NEUTRAL (R19).
      { amount: 0, x: 0, y: 0 }, no frame subscription, input ignored.

   A HYBRID DEVICE RESOLVES DETERMINISTICALLY. A touchscreen laptop answers
   yes to both `any-pointer: coarse` and `pointer: fine`, so the class is read
   from the PRIMARY pointer only - `any-pointer` is never consulted, or every
   such laptop would silently lose its pointer parallax. In the pathological
   case where a device claims both primary classes, coarse wins, always: it is
   a fixed rule rather than an evaluation order, and scroll-driven energy is
   the mode that works on every device.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /**
   * The input speed that counts as "full effort", in pixels per millisecond.
   * A brisk mouse flick is roughly 2-3 px/ms; a fast page scroll roughly 2.
   * Anything faster is clamped rather than allowed to overdrive an effect.
   */
  var POINTER_REFERENCE_VELOCITY = 2.5;
  var SCROLL_REFERENCE_VELOCITY = 2.0;

  /** Smoothing time constants: quick to wake, slower to settle. */
  var RISE_MS = 180;
  var FALL_MS = 520;

  /**
   * A pointer sample this long after the previous one is a fresh start, not a
   * movement: the visitor left the window and came back somewhere else, and
   * the distance between the two is not a velocity.
   */
  var STALE_INPUT_MS = 200;

  /** A scroll event with no measurable gap is treated as one frame's worth. */
  var NOMINAL_FRAME_MS = 16;

  var CHANGE_EPSILON = 1e-4;

  var EVENTS = ['change'];

  var PRIMARY_COARSE = '(pointer: coarse)';
  var PRIMARY_FINE = '(pointer: fine)';
  var REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function clamp(value, low, high) {
    if (!isNumber(value)) {
      return 0;
    }
    if (value < low) {
      return low;
    }
    if (value > high) {
      return high;
    }
    return value;
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  /* ------------------------------------------------------------------
     Which input class this device is - pure, and deliberately boring
     ------------------------------------------------------------------ */

  /**
   * resolveMode({ coarse, fine }) -> 'coarse' | 'fine'
   *
   * Coarse wins whenever it is reported, including the hybrid case. No answer
   * at all also resolves to coarse: scroll exists on every device, so it is
   * the mode that cannot leave a visitor with nothing.
   */
  function resolveMode(profile) {
    if (profile && profile.coarse) {
      return 'coarse';
    }
    if (profile && profile.fine) {
      return 'fine';
    }
    return 'coarse';
  }

  function askMedia(matchMedia, query) {
    if (typeof matchMedia !== 'function') {
      return false;
    }
    try {
      var result = matchMedia(query);
      return !!(result && result.matches);
    } catch (err) {
      return false;
    }
  }

  /**
   * readProfile(matchMedia) -> { coarse, fine, mode }
   * Only the PRIMARY pointer queries are asked. See the header.
   */
  function readProfile(matchMedia) {
    var profile = {
      coarse: askMedia(matchMedia, PRIMARY_COARSE),
      fine: askMedia(matchMedia, PRIMARY_FINE)
    };
    profile.mode = resolveMode(profile);
    return profile;
  }

  function readReducedMotion(matchMedia) {
    return askMedia(matchMedia, REDUCE_QUERY);
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function assertEvent(event) {
    if (EVENTS.indexOf(event) === -1) {
      throw new Error(
        'Unknown intensity event "' + String(event) + '". The signal emits: ' + EVENTS.join(', ') + '.'
      );
    }
  }

  function createEmitter() {
    var map = {};

    function drop(event, cb) {
      var list = map[event];
      if (!list) {
        return;
      }
      var index = list.indexOf(cb);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }

    return {
      on: function (event, cb) {
        assertEvent(event);
        if (typeof cb !== 'function') {
          throw new TypeError('on("' + event + '") needs a function to call.');
        }
        (map[event] || (map[event] = [])).push(cb);
        return function off() {
          drop(event, cb);
        };
      },
      off: function (event, cb) {
        assertEvent(event);
        drop(event, cb);
      },
      emit: function (event, payload) {
        var list = map[event];
        if (!list || list.length === 0) {
          return;
        }
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) {
          try {
            copy[i](payload);
          } catch (err) {
            /* One bad listener must never stop the signal. */
          }
        }
      },
      clear: function () {
        map = {};
      }
    };
  }

  /* ------------------------------------------------------------------
     The frame source

     Deliberately duplicated from js/beat-clock.js rather than shared: these
     two units are peers, and a shared helper would make one of them depend on
     the other's load order for no benefit at twenty lines.
     ------------------------------------------------------------------ */

  function defaultNow(host) {
    if (host && host.performance && typeof host.performance.now === 'function') {
      return function () {
        return host.performance.now();
      };
    }
    return function () {
      return Date.now();
    };
  }

  function frameSourceFor(options, host) {
    var injected = options && options.frames;

    if (injected && typeof injected.add === 'function' && typeof injected.remove === 'function') {
      return {
        name: 'injected',
        start: function (tick) {
          injected.add(tick);
          return function () {
            injected.remove(tick);
          };
        }
      };
    }

    if (typeof injected === 'function') {
      return {
        name: 'injected',
        start: function (tick) {
          var stop = injected(tick);
          return typeof stop === 'function' ? stop : function () {};
        }
      };
    }

    var gsap = (options && options.gsap) || (host && host.gsap);
    if (gsap && gsap.ticker && typeof gsap.ticker.add === 'function') {
      return {
        name: 'gsap.ticker',
        start: function (tick) {
          gsap.ticker.add(tick);
          return function () {
            gsap.ticker.remove(tick);
          };
        }
      };
    }

    if (host && typeof host.requestAnimationFrame === 'function') {
      return {
        name: 'requestAnimationFrame',
        start: function (tick) {
          var id = host.requestAnimationFrame(function loop() {
            id = host.requestAnimationFrame(loop);
            tick();
          });
          return function () {
            if (typeof host.cancelAnimationFrame === 'function') {
              host.cancelAnimationFrame(id);
            }
          };
        }
      };
    }

    return {
      name: 'none',
      start: function () {
        return function () {};
      }
    };
  }

  /* ------------------------------------------------------------------
     create()
     ------------------------------------------------------------------ */

  function create(options) {
    var opts = options || {};
    var host = opts.window || global;
    var now = typeof opts.now === 'function' ? opts.now : defaultNow(host);
    var frames = frameSourceFor(opts, host);
    var emitter = createEmitter();

    var matchMedia = typeof opts.matchMedia === 'function'
      ? opts.matchMedia
      : (host && typeof host.matchMedia === 'function'
        ? function (query) {
          return host.matchMedia(query);
        }
        : null);

    var profile = opts.profile ? readGiven(opts.profile) : readProfile(matchMedia);
    var mode = opts.mode === 'fine' || opts.mode === 'coarse' ? opts.mode : profile.mode;

    var reduced = typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : readReducedMotion(matchMedia);
    var active = opts.active === undefined ? true : !!opts.active;

    var riseMs = isNumber(opts.riseMs) && opts.riseMs > 0 ? opts.riseMs : RISE_MS;
    var fallMs = isNumber(opts.fallMs) && opts.fallMs > 0 ? opts.fallMs : FALL_MS;
    var pointerReference = isNumber(opts.pointerReference) && opts.pointerReference > 0
      ? opts.pointerReference
      : POINTER_REFERENCE_VELOCITY;
    var scrollReference = isNumber(opts.scrollReference) && opts.scrollReference > 0
      ? opts.scrollReference
      : SCROLL_REFERENCE_VELOCITY;

    var amount = 0;
    var x = 0;
    var y = 0;

    /* The strongest input seen since the last frame, already normalised. */
    var pending = 0;

    var hasSample = false;
    var sampleAt = 0;
    var sampleX = 0;
    var sampleY = 0;

    var started = false;
    var unsubscribe = null;
    var lastFrameAt = now();
    var announced = { amount: 0, x: 0, y: 0 };

    function readGiven(given) {
      var built = { coarse: !!given.coarse, fine: !!given.fine };
      built.mode = resolveMode(built);
      return built;
    }

    function viewport() {
      var source = opts.viewport;
      var view = typeof source === 'function' ? source() : source;
      if (view && isNumber(view.width) && isNumber(view.height) && view.width > 0 && view.height > 0) {
        return view;
      }
      var width = host && isNumber(host.innerWidth) && host.innerWidth > 0 ? host.innerWidth : 1;
      var height = host && isNumber(host.innerHeight) && host.innerHeight > 0 ? host.innerHeight : 1;
      return { width: width, height: height };
    }

    /** Under reduce, or while suspended, input is dropped on the floor. */
    function accepting() {
      return !reduced && active;
    }

    function running() {
      return started && !reduced;
    }

    function refresh() {
      if (running()) {
        if (!unsubscribe) {
          lastFrameAt = now();
          unsubscribe = frames.start(tick);
        }
        return;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }

    function offer(normalised) {
      var value = clamp01(normalised);
      if (value > pending) {
        pending = value;
      }
    }

    function neutralise() {
      amount = 0;
      x = 0;
      y = 0;
      pending = 0;
      hasSample = false;
      announce();
    }

    function announce() {
      if (
        Math.abs(amount - announced.amount) < CHANGE_EPSILON &&
        Math.abs(x - announced.x) < CHANGE_EPSILON &&
        Math.abs(y - announced.y) < CHANGE_EPSILON
      ) {
        return;
      }
      announced = { amount: amount, x: x, y: y };
      emitter.emit('change', { amount: amount, x: x, y: y });
    }

    /* --- the two input entry points ------------------------------- */

    /**
     * A pointer position, in viewport pixels. Ignored entirely on a coarse
     * profile: opening a second input path there is the R17 break.
     */
    function pointer(sample) {
      if (!accepting() || mode !== 'fine' || !sample) {
        return;
      }
      var px = Number(sample.x);
      var py = Number(sample.y);
      if (!isNumber(px) || !isNumber(py)) {
        return;
      }
      var at = isNumber(sample.t) ? sample.t : now();
      var view = viewport();

      x = clamp((px - view.width / 2) / (view.width / 2), -1, 1);
      y = clamp((py - view.height / 2) / (view.height / 2), -1, 1);

      if (hasSample) {
        var elapsed = at - sampleAt;
        if (elapsed > 0 && elapsed <= STALE_INPUT_MS) {
          var dx = px - sampleX;
          var dy = py - sampleY;
          var distance = Math.sqrt(dx * dx + dy * dy);
          offer(distance / elapsed / pointerReference);
        }
      }

      hasSample = true;
      sampleAt = at;
      sampleX = px;
      sampleY = py;
    }

    /**
     * A scroll or wheel delta, in pixels. Ignored entirely on a fine profile,
     * where the pointer is the richer and already-continuous signal.
     */
    function scroll(sample) {
      if (!accepting() || mode !== 'coarse' || !sample) {
        return;
      }
      var delta = Number(sample.deltaY);
      if (!isNumber(delta)) {
        return;
      }
      var at = isNumber(sample.t) ? sample.t : now();

      var elapsed = hasSample ? at - sampleAt : 0;
      if (!(elapsed > 0) || elapsed > STALE_INPUT_MS) {
        elapsed = NOMINAL_FRAME_MS;
      }

      x = 0; /* KTD10: a scrolling finger has no horizontal axis. */
      if (delta !== 0) {
        y = delta > 0 ? 1 : -1;
      }
      offer(Math.abs(delta) / elapsed / scrollReference);

      hasSample = true;
      sampleAt = at;
      sampleX = 0;
      sampleY = 0;
    }

    /* --- the frame ------------------------------------------------- */

    function tick() {
      if (!running()) {
        return;
      }
      var at = now();
      var elapsed = at - lastFrameAt;
      lastFrameAt = at;
      if (!(elapsed > 0)) {
        return;
      }

      var target = pending;
      pending = 0;

      /* Exponential smoothing, framerate-independent: a dropped frame eases
         by exactly as much as the two frames it replaced would have. */
      var tau = target > amount ? riseMs : fallMs;
      amount = clamp01(amount + (target - amount) * (1 - Math.exp(-elapsed / tau)));

      announce();
    }

    /* --- the public signal ----------------------------------------- */

    function observerFor(config) {
      var Observer = (config && config.Observer) ||
        opts.Observer ||
        (host && host.Observer) ||
        (host && host.gsap && host.gsap.Observer);
      return Observer && typeof Observer.create === 'function' ? Observer : null;
    }

    var signal = {
      /** The whole public surface. A fresh object, so no consumer can write it. */
      value: function () {
        return { amount: amount, x: x, y: y };
      },

      amount: function () {
        return amount;
      },

      x: function () {
        return x;
      },

      y: function () {
        return y;
      },

      /**
       * Which input class the signal is running as. DIAGNOSTIC ONLY - an
       * effect that branches on this has re-opened the R17 hole this file
       * closes. Branch on the signal, not on the device.
       */
      mode: function () {
        return mode;
      },

      profile: function () {
        return { coarse: profile.coarse, fine: profile.fine, mode: profile.mode };
      },

      frameSource: function () {
        return frames.name;
      },

      inputSource: function () {
        return observerFor(null) ? 'gsap.Observer' : 'listeners';
      },

      /* --- input, however it was captured -------------------------- */

      pointer: pointer,
      scroll: scroll,

      /* --- lifecycle ----------------------------------------------- */

      setReducedMotion: function (next) {
        var value = !!next;
        if (value === reduced) {
          return signal;
        }
        reduced = value;
        if (reduced) {
          neutralise();
        }
        hasSample = false;
        refresh();
        return signal;
      },

      /**
       * Suspends the signal without pretending the visitor left: input is
       * ignored and `amount` decays to rest, while x / y hold. This is the
       * seam a caller uses to quieten the page (for instance while playback
       * is paused); it is not the reduced-motion path, which is a promise
       * about motion rather than a mood.
       */
      setActive: function (next) {
        var value = !!next;
        if (value === active) {
          return signal;
        }
        active = value;
        pending = 0;
        hasSample = false;
        return signal;
      },

      start: function () {
        if (!started) {
          started = true;
          lastFrameAt = now();
          refresh();
        }
        return signal;
      },

      stop: function () {
        started = false;
        refresh();
        return signal;
      },

      /** One frame. The frame source calls this; tests call it by hand. */
      tick: tick,

      on: function (event, cb) {
        return emitter.on(event, cb);
      },

      off: function (event, cb) {
        emitter.off(event, cb);
      },

      /**
       * Wires real input up. Prefers GSAP's Observer, which normalises wheel,
       * touch, pointer and scroll in one place (KTD2); falls back to plain
       * listeners so this unit works before GSAP loads, and if it never does.
       *
       * Browser-only plumbing (KTD15): the tests cover the seam, the owner's
       * device check covers the events.
       */
      attach: function (config) {
        var cfg = config || {};
        var target = cfg.target || (host && host.document) || host;
        var Observer = observerFor(cfg);

        if (Observer) {
          var observer = Observer.create({
            target: target,
            /* one place, four input kinds - that is the whole point */
            type: 'wheel,touch,pointer,scroll',
            /* never swallow the visitor's scroll */
            preventDefault: false,
            tolerance: 0,
            onMove: function (self) {
              signal.pointer({ x: self.x, y: self.y });
            },
            onChangeY: function (self) {
              signal.scroll({ deltaY: self.deltaY });
            },
            onDrag: function (self) {
              signal.scroll({ deltaY: -self.deltaY });
            }
          });
          return function detach() {
            if (observer && typeof observer.kill === 'function') {
              observer.kill();
            }
          };
        }

        if (!target || typeof target.addEventListener !== 'function') {
          return function detach() {};
        }

        var lastScrollY = host && isNumber(host.scrollY) ? host.scrollY : 0;
        var bound = [
          ['pointermove', function (event) {
            signal.pointer({ x: event.clientX, y: event.clientY });
          }],
          ['wheel', function (event) {
            signal.scroll({ deltaY: event.deltaY });
          }],
          ['scroll', function () {
            var next = host && isNumber(host.scrollY) ? host.scrollY : lastScrollY;
            signal.scroll({ deltaY: next - lastScrollY });
            lastScrollY = next;
          }]
        ];

        for (var i = 0; i < bound.length; i++) {
          target.addEventListener(bound[i][0], bound[i][1], { passive: true });
        }

        return function detach() {
          for (var j = 0; j < bound.length; j++) {
            target.removeEventListener(bound[j][0], bound[j][1], { passive: true });
          }
        };
      },

      destroy: function () {
        signal.stop();
        emitter.clear();
        return signal;
      }
    };

    return signal;
  }

  /* ------------------------------------------------------------------ */

  LUVIZ.intensity = {
    EVENTS: EVENTS,
    POINTER_REFERENCE_VELOCITY: POINTER_REFERENCE_VELOCITY,
    SCROLL_REFERENCE_VELOCITY: SCROLL_REFERENCE_VELOCITY,
    RISE_MS: RISE_MS,
    FALL_MS: FALL_MS,

    resolveMode: resolveMode,
    readProfile: readProfile,
    readReducedMotion: readReducedMotion,
    create: create
  };
})(typeof window !== 'undefined' ? window : globalThis);
