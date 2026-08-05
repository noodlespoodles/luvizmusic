/* ==========================================================================
   LUVIZMUSIC - scenes.js
   --------------------------------------------------------------------------
   THE BROWSER HALF OF THE CHOREOGRAPHY. js/scene-plan.js decides what is
   allowed to move and how far; this file wires those descriptors to real
   elements and nothing else. No scene rule is decided here, so a scene that
   behaves wrongly on a phone is a bug in a file that Node can test.

   SIX RULES THIS FILE OBEYS

   1. A BLOCKED CDN DEGRADES TO A STATIC READABLE PAGE. If the library is
      not there, this file adds one class, restores the native cursor and
      returns. It does not half-initialise, and it never leaves content in
      an animation's start state, because nothing is ever put into a start
      state until the thing that will animate it exists.

   2. UNDER REDUCE NOTHING SCROLL-DRIVEN IS CREATED (R19). The plan hands
      back an empty list and this file sets the final states in one pass.
      There is no disabled scene sitting there waiting for a refresh to
      wake it up.

   3. ONLY TRANSFORM AND OPACITY, ONLY NUMERIC SCRUBS. Where the vehicle is
      a custom property it is one that CSS resolves to a transform or an
      opacity: --grain-swell feeds an opacity, --misreg-x and --misreg-y
      feed a translate, --rule-draw feeds a scaleX.

   4. NO EFFECT READS AN INPUT DEVICE. Everything that responds to the
      visitor reads js/intensity.js and only that, because the moment one
      effect asks the device a question directly, touch parity breaks
      silently on a device nobody here owns (R17).

   5. THE ADDRESS BAR IS ABSORBED, NOT FOUGHT. ignoreMobileResize stops the
      iOS address bar showing and hiding from triggering a full refresh
      mid-scroll. normalizeScroll is deliberately not used: its own docs
      call it experimental and say it does not prevent that behaviour
      anyway, while it does take over the visitor's scrolling.

   6. NOTHING WAITS ON A SCROLL POSITION TO BECOME READABLE (R15). Batched
      reveals prime ONLY what is below the fold, exactly as js/app.js does,
      and a sweep on every refresh finishes anything the visitor jumped
      past with a deep link. Text that is on screen is readable, always.
   ========================================================================== */

(function (global) {
  'use strict';

  var document = global.document;
  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* How far below the fold something has to be before it is safe to hide. */
  var FOLD_MARGIN = 0.92;

  /* Plate drift may not leave the 1-3px band that still reads as a press
     fault rather than as a drop shadow. */
  var MAX_PLATE_PX = 3;

  var built = false;
  var media = null;
  var teardown = [];

  function warn(message, err) {
    if (global.console && global.console.warn) {
      global.console.warn('[LUVIZMUSIC] ' + message, err || '');
    }
  }

  function all(selector) {
    if (!selector || !document) {
      return [];
    }
    var found;
    try {
      found = document.querySelectorAll(selector);
    } catch (err) {
      return [];
    }
    var list = [];
    for (var i = 0; i < found.length; i++) {
      list.push(found[i]);
    }
    return list;
  }

  function one(selector) {
    var list = all(selector);
    return list.length ? list[0] : null;
  }

  function rootClass(name, on) {
    if (!document || !document.documentElement) {
      return;
    }
    document.documentElement.classList[on ? 'add' : 'remove'](name);
  }

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  /** Below the fold by the same margin js/app.js uses for its reveals. */
  function belowFold(node) {
    var height = global.innerHeight || (document.documentElement || {}).clientHeight || 0;
    return node.getBoundingClientRect().top > height * FOLD_MARGIN;
  }

  /** Scrolled off the top: the visitor will never see it enter. */
  function abovePage(node) {
    return node.getBoundingClientRect().bottom < 0;
  }

  /* ------------------------------------------------------------------
     The will-change budget
     ------------------------------------------------------------------
     will-change hands an element its own compositor layer, which is
     exactly what a scrubbed transform wants and exactly what fifty cards
     at once do not. Only the long-lived scrubbed elements claim it, and
     never more than the plan's budget at a time.
     ------------------------------------------------------------------ */

  var moving = [];

  function claimLayer(nodes) {
    var budget = (LUVIZ.scenePlan && LUVIZ.scenePlan.WILL_CHANGE_BUDGET) || 3;
    for (var i = 0; i < nodes.length; i++) {
      if (moving.length >= budget || moving.indexOf(nodes[i]) !== -1) {
        continue;
      }
      moving.push(nodes[i]);
      nodes[i].classList.add('is-moving');
    }
  }

  function releaseLayer(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var at = moving.indexOf(nodes[i]);
      if (at !== -1) {
        moving.splice(at, 1);
      }
      nodes[i].classList.remove('is-moving');
    }
  }

  /* ------------------------------------------------------------------
     The one input signal (R17)
     ------------------------------------------------------------------
     Created here if nobody has created it yet, and published so the later
     units share this instance rather than opening a second input path.
     ------------------------------------------------------------------ */

  function intensitySignal() {
    if (LUVIZ.signal && typeof LUVIZ.signal.on === 'function') {
      return LUVIZ.signal;
    }
    if (!LUVIZ.intensity || typeof LUVIZ.intensity.create !== 'function') {
      return null;
    }
    try {
      var signal = LUVIZ.intensity.create({});
      signal.attach({});
      signal.start();
      LUVIZ.signal = signal;
      return signal;
    } catch (err) {
      warn('the intensity signal could not be started.', err);
      return null;
    }
  }

  /* ------------------------------------------------------------------
     The beat, if there is one
     ------------------------------------------------------------------
     The shipped content carries no tempo maps, so no boundary ever fires
     today and the beat scene is inert by construction. When a mix does
     carry one, whichever unit owns the clock hands it over through
     attachClock, or simply calls pulse() itself.
     ------------------------------------------------------------------ */

  var beatHandlers = [];
  var clockDetach = null;

  function findClock() {
    var candidates = [
      LUVIZ.clock,
      LUVIZ.beat,
      LUVIZ.playerBar && typeof LUVIZ.playerBar.clock === 'function' ? LUVIZ.playerBar.clock() : null
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && typeof candidates[i].on === 'function') {
        return candidates[i];
      }
    }
    return null;
  }

  function pulse(payload) {
    for (var i = 0; i < beatHandlers.length; i++) {
      try {
        beatHandlers[i](payload || {});
      } catch (err) {
        warn('a beat handler failed.', err);
      }
    }
  }

  function attachClock(clock) {
    if (clockDetach) {
      clockDetach();
      clockDetach = null;
    }
    if (!clock || typeof clock.on !== 'function') {
      return false;
    }
    var off = clock.on('beat', pulse);
    clockDetach = typeof off === 'function' ? off : function () {
      if (typeof clock.off === 'function') {
        clock.off('beat', pulse);
      }
    };
    return true;
  }

  /* ------------------------------------------------------------------
     SplitText, used for the per-line display reveals it was pinned for
     ------------------------------------------------------------------
     The split is reverted the moment the reveal finishes, so the page
     spends a few hundred milliseconds with wrapper elements in it and the
     rest of its life with the owner's own markup. That keeps the reading
     order clean and means a font swap re-flowing the lines afterwards
     cannot leave a wrapper holding the wrong words.
     ------------------------------------------------------------------ */

  function splitLines(nodes) {
    if (!nodes.length || typeof SplitText === 'undefined') {
      return { lines: nodes, revert: function () {} };
    }
    try {
      var config = { type: 'lines', linesClass: 'scene-line', aria: 'auto' };
      var split = typeof SplitText.create === 'function'
        ? SplitText.create(nodes, config)
        : new SplitText(nodes, config);
      var lines = split.lines && split.lines.length ? split.lines : nodes;
      return {
        lines: lines,
        revert: function () {
          try {
            split.revert();
          } catch (err) {
            /* Already reverted, or the nodes were replaced underneath us. */
          }
        }
      };
    } catch (err) {
      return { lines: nodes, revert: function () {} };
    }
  }

  /* ------------------------------------------------------------------
     The four drivers
     ------------------------------------------------------------------ */

  /** A scrubbed timeline hung off one trigger. Numeric scrub, always. */
  function scrubbed(scene, targets) {
    var trigger = one(scene.trigger);
    if (!trigger) {
      return null;
    }
    return gsap.timeline({
      scrollTrigger: {
        trigger: trigger,
        start: scene.start,
        end: scene.end,
        scrub: scene.scrub,
        invalidateOnRefresh: true,
        refreshPriority: scene.refreshPriority,
        onToggle: function (self) {
          if (self.isActive) {
            claimLayer(targets);
          } else {
            releaseLayer(targets);
          }
        }
      }
    });
  }

  /**
   * One batch for a repeated reveal, never one trigger per card.
   *
   * `prime` puts a node into its start state and is called ONLY on nodes
   * below the fold. `play` animates a group of them. `settle` finishes a
   * node the visitor jumped past, so a deep link can never land on hidden
   * text.
   */
  function batched(scene, prime, play, settle) {
    var nodes = all(scene.trigger);
    if (!nodes.length) {
      return;
    }

    var pending = [];
    for (var i = 0; i < nodes.length; i++) {
      if (belowFold(nodes[i])) {
        prime(nodes[i]);
        pending.push(nodes[i]);
      }
    }
    if (!pending.length) {
      return;
    }

    ScrollTrigger.batch(pending, {
      start: scene.start,
      once: scene.once,
      refreshPriority: scene.refreshPriority,
      onEnter: function (group) {
        play(group);
      }
    });

    function sweep() {
      for (var j = 0; j < pending.length; j++) {
        if (abovePage(pending[j])) {
          settle(pending[j]);
        }
      }
    }

    ScrollTrigger.addEventListener('refresh', sweep);
    teardown.push(function () {
      ScrollTrigger.removeEventListener('refresh', sweep);
    });
  }

  /**
   * A continuously driven effect, throttled to a stated interval.
   *
   * The throttle is what makes the flash bound real (R20): the plan states
   * a ramp, and this refuses to retarget the tween more often than a
   * quarter of it, so the fastest full up-and-down the visitor can provoke
   * is the rate the descriptor declares.
   */
  function driven(scene, apply) {
    var signal = intensitySignal();
    if (!signal) {
      return;
    }
    var interval = Math.max(60, (scene.timing.rampMs || 250) / 4);
    var last = 0;
    var queued = null;
    var frame = null;

    function flush() {
      frame = null;
      if (!queued) {
        return;
      }
      last = Date.now();
      var value = queued;
      queued = null;
      apply(value);
    }

    function handle(value) {
      queued = value;
      var wait = interval - (Date.now() - last);
      if (wait <= 0) {
        flush();
        return;
      }
      if (frame === null) {
        frame = global.setTimeout(flush, wait);
      }
    }

    var off = signal.on('change', handle);
    apply(signal.value());

    teardown.push(function () {
      if (frame !== null) {
        global.clearTimeout(frame);
      }
      if (typeof off === 'function') {
        off();
      } else if (typeof signal.off === 'function') {
        signal.off('change', handle);
      }
    });
  }

  /**
   * A beat-driven effect with its own floor between pulses.
   *
   * U7 already subdivides a fast tempo so no consumer sees more than 2.5
   * boundaries a second, but a scene that is only safe when its source
   * behaves is not safe, so the floor is restated here (R20).
   */
  function onBeat(scene, kick) {
    var last = 0;
    function handler() {
      var now = Date.now();
      if (now - last < scene.minIntervalMs) {
        return;
      }
      last = now;
      kick();
    }
    beatHandlers.push(handler);
    teardown.push(function () {
      var at = beatHandlers.indexOf(handler);
      if (at !== -1) {
        beatHandlers.splice(at, 1);
      }
    });
  }

  /* ==================================================================
     THE EIGHT SCENES
     ================================================================== */

  var SCENES = {

    /* 1. The wordmark grows and runs off the trim edges as the hero
          leaves. .section--hero clips, so it bleeds without ever widening
          the document (R18). */
    'hero-wordmark-bleed': function (scene) {
      var mark = one('.hero__wordmark');
      if (mark) {
        var timeline = scrubbed(scene, [mark]);
        if (timeline) {
          timeline.fromTo(
            mark,
            { yPercent: 0, scale: 1 },
            {
              yPercent: -scene.amounts.bleedPercent,
              scale: 1 + scene.amounts.scaleGain,
              ease: 'none',
              transformOrigin: '50% 50%'
            },
            0
          );
        }
      }

      /* The one-shot part. The hero is the first thing on screen, so this
         plays on arrival rather than waiting for a scroll position that a
         visitor who has not scrolled will never reach (R15). */
      var lines = all('.hero__tagline, .hero__blurb');
      if (!lines.length) {
        return;
      }
      var split = splitLines(lines);
      gsap.from(split.lines, {
        y: scene.amounts.riseRem + 'rem',
        opacity: 0,
        duration: scene.timing.durationMs / 1000,
        stagger: scene.timing.staggerMs / 1000,
        ease: 'power2.out',
        onComplete: split.revert,
        onInterrupt: split.revert
      });
      teardown.push(split.revert);
    },

    /* 2. The grain swells with the visitor's energy. The amplitude is
          clamped in css/texture.css, so this can only ever move the field
          between "quiet" and the token's own maximum (R20). */
    'hero-grain-swell': function (scene) {
      var root = document.documentElement;
      var range = scene.amounts.swellRange;
      var rest = 1 - range;
      driven(scene, function (value) {
        gsap.to(root, {
          '--grain-swell': clamp(rest + range * value.amount, 0, 1),
          duration: scene.timing.rampMs / 1000,
          ease: 'power2.out',
          overwrite: 'auto'
        });
      });
    },

    /* 3. The resident names cascade in, line by line, on one batch. */
    'crew-name-cascade': function (scene) {
      batched(
        scene,
        function prime(node) {
          gsap.set(node, { opacity: 0 });
        },
        function play(group) {
          for (var i = 0; i < group.length; i++) {
            (function (node, index) {
              var split = splitLines([node]);
              var timeline = gsap.timeline({
                delay: (index * scene.timing.staggerMs) / 1000,
                onComplete: split.revert
              });
              timeline.set(node, { clearProps: 'opacity' });
              timeline.from(split.lines, {
                y: scene.amounts.riseRem + 'rem',
                opacity: 0,
                duration: scene.timing.durationMs / 1000,
                stagger: scene.timing.staggerMs / 1000,
                ease: 'power3.out'
              }, 0);
              teardown.push(split.revert);
            })(group[i], i);
          }
        },
        function settle(node) {
          /* Clear rather than assert: the stylesheet owns the resting ink
             coverage, and a deep link must not print a name heavier than
             the rest of the page prints it. */
          gsap.set(node, { clearProps: 'opacity,transform' });
        }
      );
    },

    /* 4. The crew section's tinted plates pull off register in the
          direction of travel. On touch x is 0 by contract, so the vertical
          axis carries the effect there rather than flattening it (R17). */
    'crew-misregistration-drift': function (scene) {
      var section = one('#crew');
      if (!section) {
        return;
      }
      driven(scene, function (value) {
        gsap.to(section, {
          '--misreg-x': clamp(2 + scene.amounts.driftXPx * value.x, -MAX_PLATE_PX, MAX_PLATE_PX) + 'px',
          '--misreg-y': clamp(1 + scene.amounts.driftYPx * value.y, -MAX_PLATE_PX, MAX_PLATE_PX) + 'px',
          duration: scene.timing.rampMs / 1000,
          ease: 'power2.out',
          overwrite: 'auto'
        });
      });
    },

    /* 5. The rail slides in FROM THE LEFT and the leading card settles out
          of an overshoot. Nothing travels right of where it belongs: that
          would widen the document and put a horizontal scrollbar on the
          page (R18). */
    'mix-rail-entry': function (scene) {
      var rail = one('.mix-list');
      if (!rail) {
        return;
      }
      var lead = one('.mix-list > .mix-card:first-child');
      var targets = lead ? [rail, lead] : [rail];
      var timeline = scrubbed(scene, targets);
      if (!timeline) {
        return;
      }
      timeline.fromTo(
        rail,
        { x: -scene.amounts.slideRem + 'rem' },
        { x: 0, ease: 'none' },
        0
      );
      if (lead) {
        timeline.fromTo(
          lead,
          { scale: 1 + scene.amounts.overshootGain },
          { scale: 1, ease: 'power2.out', transformOrigin: '50% 50%' },
          0
        );
      }
    },

    /* 6. The playing card pulses on the beat. Small area, transform only,
          no colour, and its own floor between pulses (R20). */
    'mix-beat-kick': function (scene) {
      var selector = scene.writes[0].selector;
      onBeat(scene, function () {
        var nodes = all(selector);
        if (!nodes.length) {
          return;
        }
        gsap.timeline()
          .to(nodes, {
            scale: 1 + scene.amounts.kickGain,
            duration: scene.timing.attackMs / 1000,
            ease: 'power2.out',
            transformOrigin: '50% 50%',
            overwrite: 'auto'
          })
          .to(nodes, {
            scale: 1,
            duration: scene.timing.releaseMs / 1000,
            ease: 'power2.inOut'
          });
      });
    },

    /* 7. Each ruled box draws its rule from the left as the date enters. */
    'events-rule-draw': function (scene) {
      var drawFrom = 1 - scene.amounts.drawGain;
      batched(
        scene,
        function prime(node) {
          gsap.set(node, {
            opacity: 0,
            y: scene.amounts.riseRem + 'rem',
            '--rule-draw': drawFrom
          });
        },
        function play(group) {
          gsap.to(group, {
            opacity: 1,
            y: 0,
            '--rule-draw': 1,
            duration: scene.timing.durationMs / 1000,
            stagger: scene.timing.staggerMs / 1000,
            ease: 'power3.out'
          });
        },
        function settle(node) {
          gsap.set(node, { '--rule-draw': 1, clearProps: 'opacity,transform' });
        }
      );
    },

    /* 8. The contact title compresses toward its own baseline. Display
          type only: the email address and the links are never touched, so
          nothing anyone needs to read depends on the scroll position. */
    'contact-collapse': function (scene) {
      var title = one('#contact .section-head__title');
      if (!title) {
        return;
      }
      var timeline = scrubbed(scene, [title]);
      if (!timeline) {
        return;
      }
      timeline.fromTo(
        title,
        { scaleY: 1 },
        {
          scaleY: 1 - scene.amounts.collapseGain,
          ease: 'none',
          transformOrigin: '0% 100%'
        },
        0
      );
    }
  };

  /* ------------------------------------------------------------------
     Final states, set in one pass (R19)
     ------------------------------------------------------------------ */

  function applyFinalStates() {
    if (!LUVIZ.scenePlan || typeof LUVIZ.scenePlan.finalStates !== 'function') {
      return;
    }
    var states = LUVIZ.scenePlan.finalStates();
    for (var i = 0; i < states.length; i++) {
      var nodes = all(states[i].selector);
      if (nodes.length) {
        try {
          gsap.set(nodes, states[i].set);
        } catch (err) {
          warn('a final state could not be set for ' + states[i].element + '.', err);
        }
      }
    }
  }

  /* ------------------------------------------------------------------
     Build
     ------------------------------------------------------------------ */

  function runTeardown() {
    for (var i = 0; i < teardown.length; i++) {
      try {
        teardown[i]();
      } catch (err) {
        /* A teardown that fails must not block the rest of them. */
      }
    }
    teardown = [];
    releaseLayer(moving.slice());
  }

  /**
   * The whole unit, in one call. js/app.js calls this once; every later
   * breakpoint or preference change is handled by matchMedia.
   *
   * Returns true when scenes were built, false when the page was left
   * static on purpose.
   */
  function build() {
    if (built) {
      return false;
    }

    /*
      THE GUARD. A blocked CDN, a corporate proxy, an offline visitor: the
      page has to be readable, so this branch does the least possible. No
      element is put into a start state, because nothing has been animated
      yet, and the cursor is handed back to the browser in case a later
      unit has taken it.
    */
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      rootClass('no-gsap', true);
      rootClass('motion-on', false);
      if (document && document.documentElement) {
        document.documentElement.style.cursor = 'auto';
      }
      return false;
    }

    built = true;
    rootClass('no-gsap', false);

    /* Core first, then the plugins, exactly as index.html loaded them. */
    var plugins = [ScrollTrigger];
    if (typeof SplitText !== 'undefined') {
      plugins.push(SplitText);
    }
    if (typeof Observer !== 'undefined') {
      plugins.push(Observer);
    }
    gsap.registerPlugin.apply(gsap, plugins);

    /*
      The mobile address bar shows and hides as the visitor scrolls, which
      resizes the viewport and would otherwise refresh every trigger
      mid-gesture. This absorbs it. normalizeScroll is NOT used: it is
      experimental by its own documentation, it does not prevent the
      address bar behaviour anyway, and it takes over scrolling.
    */
    ScrollTrigger.config({ ignoreMobileResize: true });

    var plan = LUVIZ.scenePlan;
    if (!plan || typeof plan.scenes !== 'function') {
      warn('js/scene-plan.js did not load, so no scenes were built.');
      return false;
    }

    media = gsap.matchMedia();

    media.add(plan.MEDIA, function (context) {
      var conditions = context.conditions;

      /* R19. Nothing scroll-driven is CREATED under reduce - not created
         and disabled, not created and paused. Created never. */
      if (conditions.reduce) {
        rootClass('motion-on', false);
        applyFinalStates();
        return function () {};
      }

      rootClass('motion-on', true);

      var environment = {
        isDesktop: !!(conditions.desktop || conditions.ultrawide),
        isMobile: !!(conditions.base || conditions.mid),
        reduceMotion: false
      };

      /* In page order, which is also the order the descriptors arrive in,
         so an earlier trigger measures itself against a page that later
         triggers have not moved yet. */
      var scenes = plan.scenes(environment);
      for (var i = 0; i < scenes.length; i++) {
        var scene = scenes[i];
        var make = SCENES[scene.id];
        if (typeof make !== 'function') {
          warn('no builder for scene ' + scene.id + '.');
          continue;
        }
        try {
          make(scene);
        } catch (err) {
          /* One scene failing leaves the other seven standing. */
          warn('scene ' + scene.id + ' could not be built.', err);
        }
      }

      if (!attachClock(findClock())) {
        /* The player may not have published its clock yet. One retry, at
           the point everything else on the page has certainly run. */
        var retry = function () {
          attachClock(findClock());
        };
        global.addEventListener('load', retry);
        teardown.push(function () {
          global.removeEventListener('load', retry);
        });
      }

      return function cleanup() {
        runTeardown();
        if (clockDetach) {
          clockDetach();
          clockDetach = null;
        }
      };
    });

    return true;
  }

  LUVIZ.scenes = {
    build: build,

    /** The shared intensity signal, created on first use. */
    signal: intensitySignal,

    /** Hand the beat clock over once one exists. */
    attachClock: attachClock,

    /** Fire one beat boundary by hand. The clock owner may call this. */
    pulse: pulse,

    /** Everything this unit created, undone. Used by tests and by hand. */
    revert: function () {
      runTeardown();
      if (media && typeof media.revert === 'function') {
        media.revert();
      }
      media = null;
      built = false;
      rootClass('motion-on', false);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
