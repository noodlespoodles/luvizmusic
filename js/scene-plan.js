/* ==========================================================================
   LUVIZMUSIC - scene-plan.js
   --------------------------------------------------------------------------
   WHAT IS ALLOWED TO MOVE, HOW FAR, AND WHAT DRIVES IT. That is the whole
   job of this file. It builds no animation and touches no element: it hands
   back a list of descriptors and lets js/scenes.js do the wiring.

   It is deliberately DOM-free (KTD15). Node has no `document` and no
   `matchMedia`, and the no-install rule rules out a fake browser, so the two
   rules that must never quietly rot - the breakpoint rule and the
   reduced-motion promise - live here where they can be proved by a test
   (see tests/sceneplan.test.js). The browser half is verified by scrolling
   the page.

   FIVE RULES THIS FILE ENCODES

   1. UNDER REDUCE THE LIST IS EMPTY (R19). Not "empty of the loud ones",
      not "created and then disabled": empty. A scene that is never built
      cannot be re-enabled by a stray refresh, a resize, or a later unit.
      The final states are still reported, so the page can be nailed to its
      finished appearance in one pass.

   2. A PHONE GETS EVERY SCENE THE DESKTOP GETS. Same ids, smaller
      magnitudes, never fewer scenes. The magnitudes are floored at 0.4x so
      that "it has the scene" cannot quietly mean "it has the scene scaled
      to nothing".

   3. ONE DRIVER AND ONE LOUD EVENT PER SCENE. Every descriptor names
      exactly one thing that advances it - the scroll position, a batched
      entry, the intensity signal, or a beat boundary - so the beat and the
      intensity signal can never write the same property on the same
      element and fight each other frame by frame.

   4. ONLY TRANSFORM AND OPACITY. Both are compositor properties. Anything
      else is a layout or paint per frame, which is where scroll jank comes
      from. Where the effect is really a custom property, the property named
      here is the one that CSS finally computes - `--grain-swell` feeds an
      opacity, `--misreg-x` feeds a translate - and the vehicle is named
      alongside it in `cssVars`.

   5. EVERY AMOUNT IS A DELTA FROM REST, never an absolute end value. That
      is what makes "0.6x on a phone" mean a smaller movement rather than a
      differently-placed one, and it is what lets the tests check the floor.

   WHAT A DESCRIPTOR LOOKS LIKE

     id                 the scene id from the plan's inventory
     order              its position in page order, 0 first
     section            which section of the page it belongs to
     trigger            the selector that starts it
     start / end        where in the scroll it runs, when it is scroll-driven
     driver             'scroll' | 'batch' | 'intensity' | 'beat'
     loudEvent          the one loud motion event, in words
     scrub              a NUMBER of seconds of catch-up, only on 'scroll'
     toggleActions      only on 'batch'; never alongside scrub
     signal             which part of the intensity signal drives it
     minIntervalMs      the floor between beats, only on 'beat'
     magnitude          1 on the wide bands, the inventory's factor on narrow
     amounts            how far it moves, already scaled by the magnitude
     timing             how long it takes; NEVER scaled by the magnitude
     writes             [{ element, selector, properties, ... }]
     area               'element' | 'card' | 'section' | 'viewport'
     maxCyclesPerSecond the flash bound this scene is held to (R20)

   `writes[].element` is a canonical name, not a selector. Two scenes
   spelling the same node two different ways would defeat the check that no
   two drivers write one property on one element, so the name is what the
   test compares and the selector hangs off it.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* ------------------------------------------------------------------
     The four bands, stated once (they belong to css/layout.css)
     ------------------------------------------------------------------
     320 is the narrowest viewport the site supports, not a lower bound on
     the query. layout.css states the same four bands mobile-first, and a
     query floored at 320px would leave a 300px viewport with no scenes at
     all rather than with the small ones.
     ------------------------------------------------------------------ */

  var BREAKPOINTS = { base: 320, mid: 600, desktop: 1024, ultrawide: 1800 };

  var MEDIA = {
    base: '(max-width: 599px)',
    mid: '(min-width: 600px) and (max-width: 1023px)',
    desktop: '(min-width: 1024px) and (max-width: 1799px)',
    ultrawide: '(min-width: 1800px)',
    reduce: '(prefers-reduced-motion: reduce)'
  };

  /* The two magnitude regimes. base and mid are narrow; desktop and
     ultrawide are wide. Ultrawide caps the composition at 96rem and lets
     the decorative field keep running, which changes the layout and not
     the choreography, so it shares the desktop magnitudes. */
  var NARROW_BANDS = ['base', 'mid'];
  var WIDE_BANDS = ['desktop', 'ultrawide'];

  /* ------------------------------------------------------------------
     The flash bounds (R20)
     ------------------------------------------------------------------ */

  /* WCAG 2.3.1. Nothing here may cross it, whatever the tempo. */
  var MAX_CYCLES_PER_SECOND = 3;

  /* U7 subdivides a fast tempo so no consumer sees more than this. The
     beat scene restates it as its own floor rather than trusting the
     producer, because a scene that is only safe when its source behaves
     is not safe. */
  var MIN_BEAT_INTERVAL_MS = 400;

  /* R19's floor on scene-id parity. */
  var MIN_MOBILE_MAGNITUDE = 0.4;

  /* How many elements may carry a will-change promise at one time. */
  var WILL_CHANGE_BUDGET = 3;

  /* The inventory's mobile magnitudes, by scene id. */
  var MOBILE_MAGNITUDE = {
    'hero-wordmark-bleed': 0.6,
    'hero-grain-swell': 0.8,
    'crew-name-cascade': 0.7,
    'crew-misregistration-drift': 0.5,
    'mix-rail-entry': 0.7,
    'mix-beat-kick': 0.8,
    'events-rule-draw': 0.8,
    'contact-collapse': 0.6
  };

  /* ------------------------------------------------------------------
     Elements, named once
     ------------------------------------------------------------------
     One canonical name per node the choreography touches, so a collision
     between two scenes cannot hide behind two spellings of one selector.
     ------------------------------------------------------------------ */

  var ELEMENTS = {
    'hero-wordmark': '.hero__wordmark',
    'hero-lines': '.hero__tagline, .hero__blurb',
    'grain-layer': ':root',
    'crew-name': '.crew-card__name',
    'crew-plates': '#crew',
    'mix-rail': '.mix-list',
    'mix-rail-lead': '.mix-list > .mix-card:first-child',
    'mix-active-art': '.mix-card.is-active .mix-card__figure, .mix-card[aria-current="true"] .mix-card__figure',
    'event-row': '.event',
    'contact-type': '#contact .section-head__title'
  };

  function write(element, properties, extra) {
    var out = {
      element: element,
      selector: ELEMENTS[element],
      properties: properties.slice()
    };
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          out[key] = extra[key];
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function scaleAmounts(amounts, magnitude) {
    var out = {};
    for (var key in amounts) {
      if (Object.prototype.hasOwnProperty.call(amounts, key)) {
        out[key] = round4(amounts[key] * magnitude);
      }
    }
    return out;
  }

  function copy(value) {
    if (Array.isArray(value)) {
      var list = [];
      for (var i = 0; i < value.length; i++) {
        list.push(copy(value[i]));
      }
      return list;
    }
    if (value && typeof value === 'object') {
      var out = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          out[key] = copy(value[key]);
        }
      }
      return out;
    }
    return value;
  }

  /* ------------------------------------------------------------------
     THE INVENTORY, in page order
     ------------------------------------------------------------------
     Amounts are stated at the wide-band magnitude and scaled on the way
     out. Timing is never scaled: a smaller movement that also ran faster
     would read as a different scene, not as the same one on a phone.
     ------------------------------------------------------------------ */

  var BLUEPRINT = [

    /* ---------------------------------------------------------------
       1. The wordmark runs off the trim edges as the hero leaves.

       The per-line rise on the tagline and the blurb is a ONE-SHOT
       reveal, not part of the scrub. The hero is by definition the first
       thing on screen, so there is no scroll position to wait for, and
       type whose opacity depended on one would be unreadable to a
       visitor who has not scrolled yet (R15).
       --------------------------------------------------------------- */
    {
      id: 'hero-wordmark-bleed',
      section: 'hero',
      trigger: '#hero',
      start: 'top top',
      end: 'bottom top',
      driver: 'scroll',
      scrub: 1,
      splitText: true,
      splitTarget: 'hero-lines',
      loudEvent: 'the wordmark grows and bleeds past both trim edges as the hero leaves',
      area: 'section',
      amounts: {
        /* how far past the trim edge the mark travels, as a percentage of
           its own width, and how much it grows on the way out */
        bleedPercent: 26,
        scaleGain: 0.14,
        /* the distance each hero line rises through on arrival */
        riseRem: 1.5
      },
      timing: { durationMs: 520, staggerMs: 70, staggerCount: 4 },
      writes: [
        write('hero-wordmark', ['transform']),
        write('hero-lines', ['transform', 'opacity'], {
          driver: 'reveal',
          text: true,
          splitText: true
        })
      ]
    },

    /* ---------------------------------------------------------------
       2. The grain breathes with the visitor's energy.

       This is the one full-viewport scene, so it is the one that R20
       actually bites on. Two things keep it lawful: the amplitude is
       clamped in css/texture.css to --grain-amplitude whatever this
       scene asks for, and the ramp is a half-second tween rather than a
       per-frame write, which bounds a full up-and-down at one cycle a
       second against a limit of three.
       --------------------------------------------------------------- */
    {
      id: 'hero-grain-swell',
      section: 'hero',
      trigger: '#hero',
      driver: 'intensity',
      signal: 'amount',
      loudEvent: 'the grain swells toward full amplitude as the visitor moves',
      area: 'viewport',
      amplitudeToken: '--grain-amplitude',
      amounts: {
        /* how far below full amplitude the field sits at rest */
        swellRange: 0.30
      },
      timing: { rampMs: 500 },
      writes: [
        write('grain-layer', ['opacity'], { cssVars: ['--grain-swell'] })
      ]
    },

    /* ---------------------------------------------------------------
       3. The resident names cascade in, one line at a time.
       One batch for every name, never one trigger each.
       --------------------------------------------------------------- */
    {
      id: 'crew-name-cascade',
      section: 'crew',
      trigger: '.crew-card__name',
      start: 'top 88%',
      driver: 'batch',
      toggleActions: 'play none none none',
      splitText: true,
      splitTarget: 'crew-name',
      loudEvent: 'each name rises line by line as its card enters',
      area: 'element',
      amounts: { riseRem: 1.4 },
      timing: { durationMs: 560, staggerMs: 80, staggerCount: 4 },
      writes: [
        write('crew-name', ['transform', 'opacity'], { text: true, splitText: true })
      ]
    },

    /* ---------------------------------------------------------------
       4. The crew section's duplicated tinted copies drift off register.

       Driven by intensity x and y, which is the ONE signal (R17): on
       touch x is 0 by contract, so the vertical axis has to carry the
       effect or it flattens to nothing on a phone. Both axes therefore
       get a real amount.
       --------------------------------------------------------------- */
    {
      id: 'crew-misregistration-drift',
      section: 'crew',
      trigger: '#crew',
      driver: 'intensity',
      signal: 'xy',
      loudEvent: 'the tinted plates pull off register in the direction of travel',
      area: 'section',
      amounts: {
        /* added to the resting 2px / 1px plate offsets, in px, and capped
           in js/scenes.js so the total stays inside the 1-3px band that
           still reads as a press fault rather than as a drop shadow */
        driftXPx: 1.0,
        driftYPx: 0.8
      },
      timing: { rampMs: 250 },
      writes: [
        write('crew-plates', ['transform'], { cssVars: ['--misreg-x', '--misreg-y'] })
      ]
    },

    /* ---------------------------------------------------------------
       5. The mixes rail slides in and the leading card overshoots.

       It slides in from the LEFT and the overshoot is a scale rather
       than a rightward excursion. A card that travelled past its resting
       place to the right would widen the document and put a horizontal
       scrollbar on the page (R18), which is not a trade worth making for
       a flourish.
       --------------------------------------------------------------- */
    {
      id: 'mix-rail-entry',
      section: 'mixes',
      trigger: '#mixes',
      start: 'top 85%',
      end: 'top 35%',
      driver: 'scroll',
      scrub: 1,
      loudEvent: 'the rail slides in from the left and the leading card overshoots',
      area: 'section',
      amounts: { slideRem: 3.5, overshootGain: 0.06 },
      timing: {},
      writes: [
        write('mix-rail', ['transform']),
        write('mix-rail-lead', ['transform'])
      ]
    },

    /* ---------------------------------------------------------------
       6. The playing mix kicks on the beat.

       The live R20 risk in the whole site, and the reasons it is safe
       are all structural rather than tasteful: it is a transform on a
       small element, it drives no colour and no opacity, and it refuses
       any boundary that arrives sooner than 400ms after the last one, so
       2.5 pulses a second is the ceiling even if the producer misbehaves.
       The shipped content carries no tempo maps, so today it never fires
       at all - that is correct, not broken.
       --------------------------------------------------------------- */
    {
      id: 'mix-beat-kick',
      section: 'mixes',
      trigger: '.mix-card',
      driver: 'beat',
      signal: 'beat',
      minIntervalMs: MIN_BEAT_INTERVAL_MS,
      loudEvent: 'the playing card pulses once on each beat boundary',
      area: 'card',
      amounts: { kickGain: 0.05 },
      timing: { attackMs: 90, releaseMs: 260 },
      writes: [
        write('mix-active-art', ['transform'])
      ]
    },

    /* ---------------------------------------------------------------
       7. The ruled boxes draw themselves in, in sequence.
       The rule is drawn by scaling a hairline from its left end, through
       --rule-draw, while the row itself rises and fades up.
       --------------------------------------------------------------- */
    {
      id: 'events-rule-draw',
      section: 'events',
      trigger: '.event',
      start: 'top 88%',
      driver: 'batch',
      toggleActions: 'play none none none',
      loudEvent: 'each ruled box draws its rule from the left as the date enters',
      area: 'element',
      amounts: {
        riseRem: 0.9,
        /* how much of the rule is missing when the draw starts */
        drawGain: 0.8
      },
      timing: { durationMs: 480, staggerMs: 80, staggerCount: 4 },
      writes: [
        write('event-row', ['transform', 'opacity'], {
          text: true,
          cssVars: ['--rule-draw']
        })
      ]
    },

    /* ---------------------------------------------------------------
       8. The contact display type collapses toward its baseline.

       Display type only. The email address and the links underneath are
       never touched, so nothing a visitor needs to read depends on where
       the page is scrolled to (R15).
       --------------------------------------------------------------- */
    {
      id: 'contact-collapse',
      section: 'contact',
      trigger: '#contact',
      start: 'top 75%',
      end: 'bottom bottom',
      driver: 'scroll',
      scrub: 1,
      loudEvent: 'the contact title compresses toward its own baseline',
      area: 'element',
      amounts: { collapseGain: 0.14 },
      timing: {},
      writes: [
        write('contact-type', ['transform'])
      ]
    }
  ];

  /* ------------------------------------------------------------------
     THE FINAL STATES
     ------------------------------------------------------------------
     What every element the choreography touches must look like when
     nothing is animating it. Under reduce these are set in one pass and
     no scene is built at all (R19).

     They are also the answer to "what does this page look like if the
     library never arrives": the values below are the resting CSS, so a
     blocked CDN needs nothing set at all. That is why js/scenes.js can
     take the do-nothing branch and still be correct.

     WHERE THE RESTING VALUE BELONGS TO THE STYLESHEET, IT IS CLEARED
     RATHER THAN ASSERTED. The hero blurb rests at the quiet ink coverage,
     not at full opacity; a final state that wrote `opacity: 1` would print
     it heavier than the design says and would do it only for the visitors
     who asked for less motion. Clearing hands the question back to
     css/sections.css, which is the file that actually knows the answer.
     ------------------------------------------------------------------ */

  var FINAL_STATES = [
    {
      element: 'hero-wordmark',
      set: { x: 0, y: 0, scale: 1 },
      why: 'the mark sits in register, at its drawn size'
    },
    {
      element: 'hero-lines',
      set: { clearProps: 'opacity,transform' },
      why: 'the tagline and the blurb print at the ink coverage the stylesheet gives them'
    },
    {
      element: 'grain-layer',
      set: { '--grain-swell': 1 },
      why: 'the grain holds at full amplitude, which is what the token already says'
    },
    {
      element: 'crew-name',
      set: { clearProps: 'opacity,transform' },
      why: 'every resident name is printed, not waiting on a scroll position'
    },
    {
      element: 'crew-plates',
      set: { '--misreg-x': '2px', '--misreg-y': '1px' },
      why: 'the plates rest at the token offsets, off register but still'
    },
    {
      element: 'mix-rail',
      set: { x: 0 },
      why: 'the rail sits where the layout put it'
    },
    {
      element: 'mix-rail-lead',
      set: { x: 0, scale: 1 },
      why: 'the leading card is the same size as the rest'
    },
    {
      element: 'mix-active-art',
      set: { scale: 1 },
      why: 'the playing card does not pulse'
    },
    {
      element: 'event-row',
      set: { '--rule-draw': 1, clearProps: 'opacity,transform' },
      why: 'every date is printed and every rule is fully drawn'
    },
    {
      element: 'contact-type',
      set: { y: 0, scaleY: 1 },
      why: 'the contact title stands at its full height'
    }
  ];

  /* ------------------------------------------------------------------
     Resolving the environment
     ------------------------------------------------------------------
     Two booleans and a preference in, one band out. An environment that
     says nothing, or that contradicts itself, resolves to the narrow
     band: the smaller magnitudes are the safe answer, and answering
     deterministically matters more than answering cleverly.
     ------------------------------------------------------------------ */

  function resolve(environment) {
    var env = environment || {};
    var reduceMotion = env.reduceMotion === true;
    var wide = env.isDesktop === true && env.isMobile !== true;
    return {
      band: wide ? 'desktop' : 'mobile',
      isDesktop: wide,
      isMobile: !wide,
      reduceMotion: reduceMotion
    };
  }

  /** The factor this band applies to a scene's amounts. */
  function magnitudeFor(id, band) {
    if (band === 'desktop') {
      return 1;
    }
    var factor = MOBILE_MAGNITUDE[id];
    return typeof factor === 'number' ? factor : MIN_MOBILE_MAGNITUDE;
  }

  function describe(blueprint, band) {
    var magnitude = magnitudeFor(blueprint.id, band);

    var scene = {
      id: blueprint.id,
      order: 0, /* filled in below, so page order is never a guess */
      section: blueprint.section,
      trigger: blueprint.trigger,
      driver: blueprint.driver,
      loudEvent: blueprint.loudEvent,
      band: band,
      magnitude: magnitude,
      amounts: scaleAmounts(blueprint.amounts, magnitude),
      timing: copy(blueprint.timing),
      writes: copy(blueprint.writes),
      area: blueprint.area,

      /* R20, restated on every descriptor so a new scene has to answer
         the question rather than inherit an assumption. */
      drivesColour: false,
      fullViewportFill: false,
      maxCyclesPerSecond: null
    };

    if (blueprint.start !== undefined) {
      scene.start = blueprint.start;
    }
    if (blueprint.end !== undefined) {
      scene.end = blueprint.end;
    }
    if (blueprint.signal !== undefined) {
      scene.signal = blueprint.signal;
    }
    if (blueprint.splitText) {
      scene.splitText = true;
      scene.splitTarget = blueprint.splitTarget;
    }
    if (blueprint.amplitudeToken) {
      scene.amplitudeToken = blueprint.amplitudeToken;
    }

    /* A scrub is a number of seconds of catch-up. `true` snaps the
       animation straight to the scroll position, which reads as jitter on
       a trackpad and gives the compositor no room at all. */
    if (blueprint.driver === 'scroll') {
      scene.scrub = blueprint.scrub;
    }

    /* toggleActions and scrub on one trigger is a silent bug: scrub wins
       and the toggleActions are simply ignored. Only the batched entries
       carry toggleActions, and they never carry a scrub. */
    if (blueprint.driver === 'batch') {
      scene.toggleActions = blueprint.toggleActions;
      scene.once = true;
    }

    if (blueprint.driver === 'beat') {
      scene.minIntervalMs = blueprint.minIntervalMs;
      scene.maxCyclesPerSecond = round4(1000 / blueprint.minIntervalMs);
    }

    /* A continuously driven scene is bounded by how long its ramp takes:
       a full up-and-down is two ramps, so that is the fastest cycle the
       visitor could possibly provoke. */
    if (blueprint.driver === 'intensity') {
      scene.maxCyclesPerSecond = round4(1000 / (2 * blueprint.timing.rampMs));
    }

    return scene;
  }

  /**
   * scenes({ isDesktop, isMobile, reduceMotion }) -> descriptor list
   *
   * Empty under reduce (R19). In page order otherwise, with a falling
   * refreshPriority so an earlier trigger measures itself first even if a
   * later unit builds something out of order.
   *
   * Never throws, never reads the page, and hands back a fresh list every
   * time so a caller that edits the result cannot poison the next call.
   */
  function scenes(environment) {
    var resolved = resolve(environment);
    if (resolved.reduceMotion) {
      return [];
    }

    var list = [];
    for (var i = 0; i < BLUEPRINT.length; i++) {
      var scene = describe(BLUEPRINT[i], resolved.band);
      scene.order = i;
      scene.refreshPriority = -i;
      list.push(scene);
    }
    return list;
  }

  /**
   * finalStates(environment) -> [{ element, selector, set, why }]
   *
   * The same list whatever the band and whatever the preference: a final
   * state is what the page looks like when nothing is moving, and that
   * does not depend on the viewport. It is reported under reduce as well,
   * which is the whole point - the scenes are gone, the page still has to
   * render correctly.
   */
  function finalStates() {
    var list = [];
    for (var i = 0; i < FINAL_STATES.length; i++) {
      var state = FINAL_STATES[i];
      list.push({
        element: state.element,
        selector: ELEMENTS[state.element],
        set: copy(state.set),
        why: state.why
      });
    }
    return list;
  }

  /** Everything the browser half needs, in one call. */
  function plan(environment) {
    var resolved = resolve(environment);
    return {
      band: resolved.band,
      isDesktop: resolved.isDesktop,
      isMobile: resolved.isMobile,
      reduceMotion: resolved.reduceMotion,
      scenes: scenes(environment),
      finalStates: finalStates(environment)
    };
  }

  LUVIZ.scenePlan = {
    BREAKPOINTS: BREAKPOINTS,
    MEDIA: MEDIA,
    NARROW_BANDS: NARROW_BANDS,
    WIDE_BANDS: WIDE_BANDS,
    ELEMENTS: ELEMENTS,
    MOBILE_MAGNITUDE: MOBILE_MAGNITUDE,
    MIN_MOBILE_MAGNITUDE: MIN_MOBILE_MAGNITUDE,
    MAX_CYCLES_PER_SECOND: MAX_CYCLES_PER_SECOND,
    MIN_BEAT_INTERVAL_MS: MIN_BEAT_INTERVAL_MS,
    WILL_CHANGE_BUDGET: WILL_CHANGE_BUDGET,

    resolve: resolve,
    magnitudeFor: magnitudeFor,
    scenes: scenes,
    finalStates: finalStates,
    plan: plan
  };
})(typeof window !== 'undefined' ? window : globalThis);
