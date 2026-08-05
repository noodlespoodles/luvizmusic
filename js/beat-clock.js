/* ==========================================================================
   LUVIZMUSIC - beat-clock.js
   --------------------------------------------------------------------------
   The pulse. Everything on the page that moves in time with the music reads
   this file and nothing else.

   WHY A TEMPO MAP AND NOT ONE BPM NUMBER (KTD3)

   A DJ mix is several tracks at different tempos, beatmatched into each
   other. One scalar BPM cannot describe that. Worse, it degrades quietly: at
   124 BPM an error of 0.1 BPM accumulates half a beat of phase error in about
   five minutes, so a single number is visibly wrong by minute five and
   randomly phased by minute forty. Correcting the POSITION does not fix a
   wrong TEMPO - it just re-lands the same drift from a new starting point.

   So each mix declares a tempo map in content/mixes.js:

       beatGrid: [ { atMs: 0, bpm: 118 }, { atMs: 1140000, bpm: 124 } ]

   and this file finds the segment that contains the current playback
   position, computes 60000 / bpm for that segment, and anchors the phase to
   that segment. A one-entry grid is the constant-tempo case. NO GRID AT ALL
   IS A VALID CHOICE and produces no pulse whatsoever: silence beats pulsing
   at the wrong speed.

   THE FIVE RULES THIS FILE ENFORCES, EACH FOR A REASON:

   1. FRAMES DRIVE THE PHASE. POLLING ONLY CORRECTS DRIFT. A SoundCloud
      progress event arrives every few hundred milliseconds and every getter
      is asynchronous over postMessage, so anything driven by polling would
      pulse in visible steps. The clock runs itself off the frame source and
      only accepts a reported position when it disagrees badly enough to be
      real (see DRIFT_TOLERANCE_MS).

   2. THE FRAME SOURCE IS INJECTED. It defaults to gsap.ticker and falls back
      to requestAnimationFrame when GSAP is absent. U8 is what registers GSAP,
      and U8 depends on this file - so this file has to be verifiable before
      GSAP exists at all.

   3. THE PULSE IS BOTH CONTINUOUS AND DISCRETE. phase() is a 0-1 ramp for
      consumers that want to breathe; the `beat` event is the downbeat for
      consumers that want to snap.

   4. ABOVE 150 BPM THE BOUNDARY EVENT FIRES ON EVERY SECOND BEAT (R20). This
      is a seizure-safety bound, not a stylistic one. A 180 BPM drum-and-bass
      segment would otherwise fire three times a second, over WCAG 2.3.1's
      three-flashes-per-second limit - and WCAG applies a stricter threshold
      again to saturated red, which is this site's entire palette. Halving
      keeps every consumer at or below 2.5 events per second at any tempo.

   5. PAUSED IS SILENT, AND SO IS prefers-reduced-motion: reduce (R19). Under
      reduce the clock does not even subscribe to the frame source.

   PHASE ACROSS A TEMPO CHANGE. Phase is anchored at the segment's atMs, so a
   beatmatched transition - the authored case, where atMs lands on a downbeat
   of the previous segment - puts phase 0 exactly on atMs. When the authored
   atMs is NOT on a beat, the anchor is nudged by less than one beat so the
   phase carries over continuously instead of stuttering. A hand-typed tempo
   map is never perfect, and a stutter at every transition would be the most
   visible artefact on the page.

   OWNERS: you never need to edit this file. Edit the beatGrid values in
   content/mixes.js.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* R20's ceiling for anything this clock can drive. */
  var MAX_EVENTS_PER_SECOND = 2.5;
  var MIN_PULSE_MS = 1000 / MAX_EVENTS_PER_SECOND; /* 400ms */

  /* The tempo at which one beat per pulse stops being safe: 60000/400. */
  var FAST_BPM = 60000 / MIN_PULSE_MS; /* 150 */

  /**
   * How far the widget's reported position may disagree with our own running
   * clock before we believe the widget. Below this it is reporting jitter -
   * embeds round, batch and lag their progress events - and resyncing on it
   * would stutter the pulse several times a second. Above it, something real
   * happened: a scrub, a stall, or a throttled background tab.
   */
  var DRIFT_TOLERANCE_MS = 120;

  var EVENTS = ['beat', 'frame', 'segment'];

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  /* ------------------------------------------------------------------
     Tempo maths - pure, and the part worth testing hardest
     ------------------------------------------------------------------ */

  /**
   * intervalFor(bpm) -> milliseconds per beat, or 0 when the tempo is unusable.
   * A zero, negative, missing or non-numeric BPM is REJECTED here rather than
   * turned into an infinite or negative interval further downstream.
   */
  function intervalFor(bpm) {
    if (!isNumber(bpm) || bpm <= 0) {
      return 0;
    }
    return 60000 / bpm;
  }

  /**
   * subdivisionFor(bpm) -> how many beats each emitted pulse spans.
   * 1 up to 150 BPM, 2 above it, 4 above 300, and so on. Derived from the R20
   * bound rather than hard-coded, so the guarantee holds at any tempo.
   */
  function subdivisionFor(bpm) {
    var beatMs = intervalFor(bpm);
    if (beatMs <= 0) {
      return 0;
    }
    var subdivision = 1;
    while (beatMs * subdivision < MIN_PULSE_MS - 1e-9) {
      subdivision *= 2;
    }
    return subdivision;
  }

  function gridFrom(source) {
    if (Array.isArray(source)) {
      return source;
    }
    if (source && Array.isArray(source.beatGrid)) {
      return source.beatGrid;
    }
    return null;
  }

  /** Where in its pulse a given segment is at `positionMs`, as 0-1. */
  function phaseIn(segment, positionMs) {
    if (!segment || !(segment.pulseMs > 0)) {
      return 0;
    }
    var turns = (positionMs - segment.anchorMs) / segment.pulseMs;
    var phase = turns - Math.floor(turns);
    if (!(phase >= 0) || phase >= 1) {
      return 0;
    }
    return phase;
  }

  /**
   * plan(mixOrGrid) -> the normalised tempo map this clock actually runs on.
   *
   * Every segment that cannot be used is DROPPED rather than repaired: an
   * unusable tempo, a missing or negative atMs, or an atMs that goes backwards
   * (content validation in namespace.js already tells the owner about these in
   * plain English). A grid with nothing usable left plans to [], which means
   * no pulse, which is the honest outcome.
   */
  function plan(source) {
    var grid = gridFrom(source);
    var planned = [];
    if (!grid) {
      return planned;
    }

    for (var i = 0; i < grid.length; i++) {
      var raw = grid[i] || {};
      var beatMs = intervalFor(raw.bpm);
      if (beatMs <= 0) {
        continue;
      }

      var atMs = raw.atMs;
      if (!isNumber(atMs) || atMs < 0) {
        if (planned.length > 0) {
          continue;
        }
        atMs = 0; /* a first segment with no anchor starts at the start */
      }

      var previous = planned.length > 0 ? planned[planned.length - 1] : null;
      if (previous && atMs <= previous.atMs) {
        continue;
      }

      var subdivision = subdivisionFor(raw.bpm);
      var segment = {
        atMs: atMs,
        bpm: raw.bpm,
        beatMs: beatMs,
        subdivision: subdivision,
        pulseMs: beatMs * subdivision,
        anchorMs: atMs
      };

      if (previous) {
        /* Carry the phase across the transition. On a beatmatched grid the
           carried phase is 0 and the anchor stays exactly on atMs. */
        segment.anchorMs = atMs - phaseIn(previous, atMs) * segment.pulseMs;
      }

      planned.push(segment);
    }

    return planned;
  }

  /**
   * The segment containing `positionMs`. Before the first anchor holds the
   * first segment; past the last anchor holds the last one, so a mix that runs
   * longer than its map still pulses at the last declared tempo.
   */
  function segmentAt(planned, positionMs) {
    if (!planned || planned.length === 0) {
      return null;
    }
    var position = isNumber(positionMs) ? positionMs : 0;
    var found = planned[0];
    for (var i = 1; i < planned.length; i++) {
      if (planned[i].atMs <= position) {
        found = planned[i];
      } else {
        break;
      }
    }
    return found;
  }

  /** The 0-1 pulse phase at a position. 0 when there is nothing to pulse to. */
  function phaseAt(planned, positionMs) {
    var segment = segmentAt(planned, positionMs);
    if (!segment) {
      return 0;
    }
    return phaseIn(segment, isNumber(positionMs) ? positionMs : 0);
  }

  function pulses(source) {
    return plan(source).length > 0;
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function assertEvent(event) {
    if (EVENTS.indexOf(event) === -1) {
      throw new Error(
        'Unknown beat-clock event "' + String(event) + '". The clock emits: ' + EVENTS.join(', ') + '.'
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
            /* One bad listener must never stop the pulse. */
          }
        }
      },
      clear: function () {
        map = {};
      }
    };
  }

  /* ------------------------------------------------------------------
     The frame source (rule 2)
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

  /**
   * Resolves, in order: an injected source, gsap.ticker, requestAnimationFrame,
   * nothing. "Nothing" is a working clock that only moves when tick() is called
   * by hand, which is how the tests drive it.
   */
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

    var planned = plan(opts.beatGrid !== undefined ? opts.beatGrid : opts.mix);
    var driftToleranceMs = isNumber(opts.driftToleranceMs) ? opts.driftToleranceMs : DRIFT_TOLERANCE_MS;

    var reduced = !!opts.reducedMotion;
    var playing = !!opts.playing;
    var started = false;
    var unsubscribe = null;

    /* The clock's own idea of where the mix is, and when it last agreed with
       the wall clock. positionNow() extrapolates between corrections. */
    var positionMs = isNumber(opts.positionMs) ? opts.positionMs : 0;
    var anchorWall = now();

    var phase = 0;
    var hasPhase = false;
    var currentSegment = null;
    var lastBeatWall = -Infinity;

    function positionNow() {
      if (!playing) {
        return positionMs;
      }
      return positionMs + (now() - anchorWall);
    }

    function holdPosition() {
      positionMs = positionNow();
      anchorWall = now();
    }

    function shouldRun() {
      return started && playing && !reduced && planned.length > 0;
    }

    function refresh() {
      if (shouldRun()) {
        if (!unsubscribe) {
          unsubscribe = frames.start(tick);
        }
        return;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }

    function tick() {
      if (!shouldRun()) {
        return;
      }

      var position = positionNow();
      var segment = segmentAt(planned, position);
      if (!segment) {
        return;
      }

      if (segment !== currentSegment) {
        currentSegment = segment;
        emitter.emit('segment', {
          bpm: segment.bpm,
          beatIntervalMs: segment.beatMs,
          pulseIntervalMs: segment.pulseMs,
          subdivision: segment.subdivision,
          positionMs: position
        });
      }

      var next = phaseIn(segment, position);
      var wrapped = hasPhase && next < phase;
      phase = next;

      if (!hasPhase) {
        /* The first frame after a start, a resume or a resync establishes the
           phase. It never emits: a resume must not fire a stray downbeat, and
           a ten-minute scrub must not replay every beat it skipped. */
        hasPhase = true;
      } else if (wrapped) {
        var wall = now();
        /* The R20 floor, enforced on the way out as well as in the tempo maths:
           whatever the grid says, no consumer is driven faster than 2.5/sec. */
        if (wall - lastBeatWall >= MIN_PULSE_MS - 1) {
          lastBeatWall = wall;
          emitter.emit('beat', {
            positionMs: position,
            phase: next,
            bpm: segment.bpm,
            beatIntervalMs: segment.beatMs,
            pulseIntervalMs: segment.pulseMs,
            subdivision: segment.subdivision
          });
        }
      }

      emitter.emit('frame', {
        phase: next,
        positionMs: position,
        bpm: segment.bpm
      });
    }

    var clock = {
      /* --- what the pulse currently is ----------------------------- */

      /** The 0-1 ramp. 0 whenever there is nothing to pulse to. */
      phase: function () {
        return phase;
      },

      positionMs: function () {
        return positionNow();
      },

      bpm: function () {
        var segment = segmentAt(planned, positionNow());
        return segment ? segment.bpm : 0;
      },

      /** Milliseconds per beat at the current position, 0 when not pulsing. */
      beatIntervalMs: function () {
        var segment = segmentAt(planned, positionNow());
        return segment ? segment.beatMs : 0;
      },

      /** Milliseconds per EMITTED pulse: the beat, doubled above 150 BPM. */
      pulseIntervalMs: function () {
        var segment = segmentAt(planned, positionNow());
        return segment ? segment.pulseMs : 0;
      },

      subdivision: function () {
        var segment = segmentAt(planned, positionNow());
        return segment ? segment.subdivision : 0;
      },

      /** False for a mix with no usable beat grid: it plays, it does not pulse. */
      pulses: function () {
        return planned.length > 0;
      },

      segments: function () {
        return planned.slice();
      },

      frameSource: function () {
        return frames.name;
      },

      /* --- what the page tells it ---------------------------------- */

      setMix: function (mix, startMs) {
        planned = plan(mix);
        positionMs = isNumber(startMs) ? startMs : 0;
        anchorWall = now();
        phase = 0;
        hasPhase = false;
        currentSegment = null;
        lastBeatWall = -Infinity;
        refresh();
        return clock;
      },

      setGrid: function (grid, startMs) {
        return clock.setMix({ beatGrid: grid }, startMs);
      },

      setPlaying: function (next) {
        var value = !!next;
        if (value === playing) {
          return clock;
        }
        holdPosition();
        playing = value;
        anchorWall = now();
        hasPhase = false;
        refresh();
        return clock;
      },

      setReducedMotion: function (next) {
        var value = !!next;
        if (value === reduced) {
          return clock;
        }
        reduced = value;
        if (reduced) {
          phase = 0;
        }
        hasPhase = false;
        refresh();
        return clock;
      },

      /**
       * A position the provider reported, in milliseconds. Returns true when it
       * was believed and the clock resynced, false when it was inside the drift
       * tolerance and therefore ignored. This is the ONLY thing polling does.
       */
      sync: function (nextMs, options) {
        if (!isNumber(nextMs) || nextMs < 0) {
          return false;
        }
        var forced = !!(options && options.force);
        if (!forced && Math.abs(nextMs - positionNow()) <= driftToleranceMs) {
          return false;
        }
        positionMs = nextMs;
        anchorWall = now();
        hasPhase = false;
        return true;
      },

      /** The adapter reports progress in SECONDS, so this is the usual entry. */
      syncSeconds: function (seconds) {
        if (!isNumber(seconds) || seconds < 0) {
          return false;
        }
        return clock.sync(seconds * 1000);
      },

      /** A seek is authoritative: it is believed however small the change. */
      seekTo: function (nextMs) {
        return clock.sync(nextMs, { force: true });
      },

      seekToSeconds: function (seconds) {
        return isNumber(seconds) && seconds >= 0 ? clock.seekTo(seconds * 1000) : false;
      },

      /* --- lifecycle ------------------------------------------------ */

      start: function () {
        if (!started) {
          started = true;
          anchorWall = now();
          refresh();
        }
        return clock;
      },

      stop: function () {
        started = false;
        refresh();
        return clock;
      },

      /** One frame. The frame source calls this; tests call it by hand. */
      tick: tick,

      on: function (event, cb) {
        return emitter.on(event, cb);
      },

      off: function (event, cb) {
        emitter.off(event, cb);
      },

      destroy: function () {
        clock.stop();
        emitter.clear();
        return clock;
      },

      /**
       * Wires the clock to a player instance from js/players/adapter.js.
       *
       * `progress` is the drift correction and nothing else (rule 1). YouTube
       * emits no progress event at all, so a caller that wants drift correction
       * there has to poll getPosition() itself and hand the answer to
       * syncSeconds() - the clock stays correct meanwhile because it runs on
       * its own tempo map, which is the whole point of KTD3.
       */
      attach: function (player) {
        if (!player || typeof player.on !== 'function') {
          return function detach() {};
        }
        var offs = [];

        offs.push(player.on('play', function () {
          clock.setPlaying(true);
        }));
        offs.push(player.on('pause', function () {
          clock.setPlaying(false);
        }));
        offs.push(player.on('finish', function () {
          clock.setPlaying(false);
        }));
        offs.push(player.on('progress', function (payload) {
          if (payload && isNumber(payload.position)) {
            clock.syncSeconds(payload.position);
          }
        }));
        offs.push(player.on('seek', function (payload) {
          if (payload && isNumber(payload.position)) {
            clock.seekToSeconds(payload.position);
            return;
          }
          if (typeof player.getPosition === 'function') {
            Promise.resolve(player.getPosition()).then(function (seconds) {
              clock.seekToSeconds(seconds);
            }, function () {
              /* The adapter never rejects; this is belt and braces. */
            });
          }
        }));

        return function detach() {
          for (var i = 0; i < offs.length; i++) {
            if (typeof offs[i] === 'function') {
              offs[i]();
            }
          }
          offs = [];
        };
      }
    };

    return clock;
  }

  /* ------------------------------------------------------------------ */

  LUVIZ.beatClock = {
    EVENTS: EVENTS,
    MAX_EVENTS_PER_SECOND: MAX_EVENTS_PER_SECOND,
    MIN_PULSE_MS: MIN_PULSE_MS,
    FAST_BPM: FAST_BPM,
    DRIFT_TOLERANCE_MS: DRIFT_TOLERANCE_MS,

    intervalFor: intervalFor,
    subdivisionFor: subdivisionFor,
    plan: plan,
    segmentAt: segmentAt,
    phaseAt: phaseAt,
    pulses: pulses,
    create: create
  };
})(typeof window !== 'undefined' ? window : globalThis);
