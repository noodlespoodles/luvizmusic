/* ==========================================================================
   LUVIZMUSIC - the influences wall
   U11. R26, R27, R28, R29.
   --------------------------------------------------------------------------
   THE GOVERNING IDEA IS CRATE-DIGGING. Movement smears, stillness resolves.
   A visitor flicking down the page sees a wall of red and bone plates too far
   out of register to read; when they stop, the plates converge and the names
   snap into focus. You flick through the rack, then you stop on one.

   This is the site's core device - one fixed, never-degraded mark held over a
   field that decays (R4) - applied to a whole section. It is why this is not
   a word cloud, not a marquee, and not a ticker.

   THE FILE IS IN TWO HALVES, the same split U8 uses:

     1. A pure half. layout(), legibility(), parallax() and flash() are
        arithmetic. They never touch the page, never read a clock, and draw
        no randomness from anywhere, so tests/influences.test.js can prove
        the whole contract under Node where there is no document (KTD15).

     2. A browser half. mount() turns those decisions into elements and wires
        them to the one input signal. It declines politely rather than
        throwing when anything it needs is absent.

   WHAT IT READS, AND WHAT IT MUST NOT (R17):

     window.LUVIZ.intensity  { amount, x, y }. amount is 0-1 energy; x and y
                             are -1..1 direction. On touch x is ALWAYS 0.
                             This is the ONLY input. Reading an input device
                             here would break touch parity silently.
     the beat clock          discrete boundary events, already subdivided so
                             they can never exceed 2.5 a second (R20). The
                             shipped mixes carry NO tempo maps, so nothing
                             fires today: the flash code has to be correct
                             when one arrives and completely inert until then.
                             It never invents a beat of its own.

   OWNERS: the names live in content/influences.js. Nothing here needs editing
   to add, remove or correct one.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* ------------------------------------------------------------------
     1. The constants the contract is stated in
     ------------------------------------------------------------------ */

  /*
    The depth layers, far to near. Each sits in its OWN band of the
    css/type.css scale, from caption-scale up to names that run off the trim
    edge, and each parallaxes at its own rate so the field has real depth.

    ink is the pairing, not a colour: css/influences.css resolves it to a
    token. A layer that prints in red is never eligible for the beat flash,
    because red on red is the one pairing WCAG treats more strictly than any
    other and red is this site's whole palette.
  */
  var LAYERS = [
    { id: 'ghost', step: '--step-n1', depth: 0.14, ink: 'red',  weight: 'hairline', bleed: false, flash: false },
    { id: 'field', step: '--step-0',  depth: 0.32, ink: 'bone', weight: 'regular',  bleed: false, flash: true },
    { id: 'near',  step: '--step-2',  depth: 0.62, ink: 'bone', weight: 'bold',     bleed: false, flash: true },
    { id: 'bleed', step: '--step-5',  depth: 1.00, ink: 'red',  weight: 'heavy',    bleed: true,  flash: false }
  ];

  /* The single band the wall collapses to under prefers-reduced-motion. */
  var STATIC_LAYER = 'static';

  /*
    THE ART DIRECTION, WRITTEN DOWN. Which layer each name lands on is this
    fixed rhythm, walked in source order - not a shuffle. A stable layout is
    art-directed; one that reshuffles on every load is noise. Nineteen is
    prime, so the pattern never falls into step with a column count.
  */
  var LAYER_PATTERN = [0, 1, 0, 2, 0, 0, 1, 3, 0, 1, 0, 2, 1, 0, 0, 2, 0, 1, 3];

  /* Everything below is a hard cap, so no input can make the wall meaningless. */
  var MAX_ROTATION_DEG = 4;
  var MAX_SEPARATION_PX = 26;   /* the plates never drift further apart than this */
  var SEPARATION_X_PX = 22;
  var SEPARATION_Y_PX = 18;
  var MAX_PARALLAX_PX = 24;

  /*
    THE TOUCH FLOOR, AND WHY IT EXISTS. intensity.x is 0 on touch by
    contract. If horizontal separation were the only legibility cue the whole
    effect would flatten to nothing on a phone, so half the vertical
    separation is present whatever the direction, and opacity carries the
    rest. Both cues are axis-free.
  */
  var VERTICAL_FLOOR = 0.5;
  var GHOST_MAX = 0.55;   /* matches --misreg-ghost in css/tokens.css */
  var INK_FADE = 0.55;    /* how far the true impression fades at full tilt */

  /* R28 and R20. A handful of names, each a small area, never the viewport. */
  var FLASH_MAX = 4;
  var FLASH_INK = 'bone';
  var MAX_FLASH_AREA = 0.08;

  /* ------------------------------------------------------------------
     2. Small arithmetic
     ------------------------------------------------------------------ */

  function num(value, fallback) {
    return typeof value === 'number' && !isNaN(value) ? value : fallback;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function clamp01(value) {
    return clamp(num(value, 0), 0, 1);
  }

  function unit(value) {
    return clamp(num(value, 0), -1, 1);
  }

  /* Smoothstep. Monotonic on [0,1], which is what keeps legibility honest. */
  function ease(t) {
    return t * t * (3 - 2 * t);
  }

  /*
    FNV-1a over the name itself. Every per-name variation is seeded from this
    and from nothing else, so the same name always draws the same way - on
    every load, in every browser, in the tests.
  */
  function seed(text) {
    var hash = 2166136261;
    var value = String(text);
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
    }
    return hash >>> 0;
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function layerById(id) {
    for (var i = 0; i < LAYERS.length; i++) {
      if (LAYERS[i].id === id) {
        return LAYERS[i];
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------
     3. layout() - the field, decided once
     ------------------------------------------------------------------ */

  /**
   * layout(names, { reducedMotion }) -> { reducedMotion, count, layers, items }
   *
   * Every name appears exactly once, in source order (R29). The depth layers
   * are a paint concern; they never reorder the content, so a screen reader
   * reads the owner's list exactly as it is written.
   */
  function layout(names, options) {
    var opts = options || {};
    var reduced = opts.reducedMotion === true;
    var list = Array.isArray(names) ? names : [];
    var items = [];

    for (var i = 0; i < list.length; i++) {
      var name = String(list[i]);
      var key = seed(name);
      var id = 'influence-' + i + (slug(name) ? '-' + slug(name) : '');

      if (reduced) {
        /*
          The names are the content; the smearing is the decoration. Under
          reduce the decoration goes and the content stays: one plain band,
          no tilt, no depth, nothing that flashes (R29, R19).
        */
        items.push({
          name: name,
          index: i,
          id: id,
          layer: STATIC_LAYER,
          step: '--step-1',
          depth: 0,
          parallax: 0,
          rotate: 0,
          lane: 0,
          row: 0,
          ink: 'bone',
          weight: 'regular',
          bleed: false,
          flashable: false
        });
        continue;
      }

      var layer = LAYERS[LAYER_PATTERN[i % LAYER_PATTERN.length]];

      items.push({
        name: name,
        index: i,
        id: id,
        layer: layer.id,
        step: layer.step,
        depth: layer.depth,
        parallax: layer.depth,
        /* -4deg to +4deg in half steps, from the name and nothing else. */
        rotate: ((key % 17) - 8) / 2,
        /* Where it sits in the field. The lane is the name's own; the row
           walks the list down the wall so the reading order and the visual
           order agree even though the plates overlap. */
        lane: Math.round((key >>> 5) % 84),
        row: list.length > 1 ? Math.round((i / (list.length - 1)) * 94) + ((key >>> 11) % 5) : 0,
        ink: layer.ink,
        weight: layer.weight,
        bleed: layer.bleed,
        /* Small area AND bone ink: the two conditions R28 puts on a flash. */
        flashable: layer.flash === true && layer.ink === 'bone'
      });
    }

    return {
      reducedMotion: reduced,
      count: items.length,
      layers: reduced ? [STATIC_LAYER] : LAYERS.map(function (layer) { return layer.id; }),
      items: items
    };
  }

  /* ------------------------------------------------------------------
     4. legibility() - intensity, inverted (R27)
     ------------------------------------------------------------------ */

  /**
   * legibility(amount, x, y, { reducedMotion })
   *   -> { amount, legibility, dx, dy, separation, ghost, inkOpacity }
   *
   * At amount 0 the plates sit in register, the ghosts are invisible and the
   * name is at full strength: fully legible. As amount rises the plates
   * separate along the signal's own direction and the true impression fades,
   * toward illegibility - but never past the stated cap, or the wall stops
   * being a wall of names and becomes a smear that says nothing.
   */
  function legibility(amount, x, y, options) {
    var opts = options || {};

    if (opts.reducedMotion === true) {
      return {
        amount: 0,
        legibility: 1,
        dx: 0,
        dy: 0,
        separation: 0,
        ghost: 0,
        inkOpacity: 1
      };
    }

    var energy = clamp01(amount);
    var eased = ease(energy);
    var xn = unit(x);
    var yn = unit(y);

    var dx = SEPARATION_X_PX * energy * xn;

    /* The vertical axis always carries some of it, whatever the direction,
       because on touch there is no horizontal direction to carry it. */
    var direction = yn < 0 ? -1 : 1;
    var dy = SEPARATION_Y_PX * energy * (VERTICAL_FLOOR + (1 - VERTICAL_FLOOR) * Math.abs(yn)) * direction;

    var separation = Math.sqrt(dx * dx + dy * dy);
    if (separation > MAX_SEPARATION_PX) {
      var scale = MAX_SEPARATION_PX / separation;
      dx *= scale;
      dy *= scale;
      separation = MAX_SEPARATION_PX;
    }

    return {
      amount: energy,
      legibility: 1 - eased,
      /* `|| 0` is not decoration: it collapses negative zero, which reads as
         a real offset to a strict equality check and to nobody else. */
      dx: dx || 0,
      dy: dy || 0,
      separation: separation || 0,
      ghost: GHOST_MAX * eased,
      inkOpacity: 1 - INK_FADE * eased
    };
  }

  /**
   * parallax(layer, x, y, { reducedMotion }) -> { x, y } in pixels.
   * Depth comes off the same signal as everything else, so the field has
   * real depth on a phone as well as under a pointer.
   */
  function parallax(layer, x, y, options) {
    var opts = options || {};
    if (opts.reducedMotion === true || !layer) {
      return { x: 0, y: 0 };
    }
    var depth = clamp(num(layer.depth, 0), 0, 1);
    return {
      x: (MAX_PARALLAX_PX * depth * unit(x)) || 0,
      y: (MAX_PARALLAX_PX * depth * unit(y)) || 0
    };
  }

  /* ------------------------------------------------------------------
     5. flash() - the beat rotation (R28)
     ------------------------------------------------------------------ */

  /**
   * flash(plan, boundary, previous) -> { boundary, ink, names, items }
   *
   * On each beat boundary a small, deterministic rotation of names snaps to
   * full contrast for one beat. The constraints are not negotiable:
   *
   *   - at most FLASH_MAX names at once;
   *   - each one a small area, so the bleeding layer is never eligible;
   *   - bone ink on the near-black ground, never red on red;
   *   - never the same name on two consecutive boundaries, which is what
   *     stops one name strobing at the beat rate.
   *
   * The field is cut into FLASH_MAX disjoint slots and one name is taken
   * from each, so the lit names are spread across the wall rather than
   * clustered, and two picks can never collide.
   */
  function flash(plan, boundary, previous) {
    var empty = { boundary: 0, ink: FLASH_INK, names: [], items: [] };
    if (!plan || !Array.isArray(plan.items) || plan.reducedMotion === true) {
      return empty;
    }

    var eligible = [];
    for (var i = 0; i < plan.items.length; i++) {
      if (plan.items[i].flashable) {
        eligible.push(plan.items[i]);
      }
    }
    if (eligible.length === 0) {
      return empty;
    }

    var index = Math.abs(Math.floor(num(boundary, 0)));
    var seen = Array.isArray(previous) ? previous : [];
    var total = eligible.length;
    var names = [];
    var items = [];

    for (var slot = 0; slot < FLASH_MAX; slot++) {
      var from = Math.floor((total * slot) / FLASH_MAX);
      var to = Math.floor((total * (slot + 1)) / FLASH_MAX);
      var width = to - from;
      if (width <= 0) {
        continue;
      }
      /* Walk forward inside this slot until a name that was not lit on the
         previous boundary turns up. Deterministic in the boundary number. */
      var start = (index * (slot + 3) * 7) % width;
      for (var step = 0; step < width; step++) {
        var pick = eligible[from + ((start + step) % width)];
        if (seen.indexOf(pick.name) === -1 && names.indexOf(pick.name) === -1) {
          names.push(pick.name);
          items.push(pick);
          break;
        }
      }
    }

    return { boundary: index, ink: FLASH_INK, names: names, items: items };
  }

  /* ==================================================================
     THE BROWSER HALF
     Everything below needs a document. It declines rather than throws.
     ================================================================== */

  function warn(message, err) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('LUVIZMUSIC: ' + message, err || '');
    }
  }

  function readReducedMotion(options) {
    var opts = options || {};
    if (typeof opts.reducedMotion === 'boolean') {
      return opts.reducedMotion;
    }
    if (typeof global.matchMedia !== 'function') {
      return false;
    }
    try {
      return global.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    } catch (err) {
      return false;
    }
  }

  /** The one shared signal. Never a second input path (R17). */
  function signal() {
    if (LUVIZ.scenes && typeof LUVIZ.scenes.signal === 'function') {
      try {
        var shared = LUVIZ.scenes.signal();
        if (shared && typeof shared.on === 'function') {
          return shared;
        }
      } catch (err) {
        warn('the shared intensity signal could not be read.', err);
      }
    }
    if (LUVIZ.signal && typeof LUVIZ.signal.on === 'function') {
      return LUVIZ.signal;
    }
    if (!LUVIZ.intensity || typeof LUVIZ.intensity.create !== 'function') {
      return null;
    }
    try {
      var made = LUVIZ.intensity.create({});
      made.attach({});
      made.start();
      LUVIZ.signal = made;
      return made;
    } catch (err) {
      warn('the intensity signal could not be started.', err);
      return null;
    }
  }

  /** The beat clock, if some other unit has published one. */
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

  /* ------------------------------------------------------------------
     6. Drawing the field
     ------------------------------------------------------------------ */

  function plateFor(doc, item, which) {
    var plate = doc.createElement('span');
    plate.className = 'influences__plate influences__plate--' + which;
    /* A duplicate of text that is already on the page. Decoration only, so
       it is hidden from assistive technology (R29). */
    plate.setAttribute('aria-hidden', 'true');
    plate.textContent = item.name;
    return plate;
  }

  function draw(doc, list, plan) {
    var fragment = doc.createDocumentFragment();
    var drawn = {};

    for (var i = 0; i < plan.items.length; i++) {
      var item = plan.items[i];

      var entry = doc.createElement('li');
      entry.className =
        'influences__name influences__name--' + item.layer + ' influences__name--' + item.ink;
      entry.id = item.id;
      entry.setAttribute('data-layer', item.layer);
      entry.style.setProperty('--rot', item.rotate + 'deg');
      entry.style.setProperty('--depth', String(item.depth));
      entry.style.setProperty('--lane', String(item.lane));
      entry.style.setProperty('--row', String(item.row));

      if (!plan.reducedMotion) {
        entry.appendChild(plateFor(doc, item, 'a'));
        entry.appendChild(plateFor(doc, item, 'b'));
      }

      /* The true impression. Real text, in source order, never a duplicate. */
      var real = doc.createElement('span');
      real.className = 'influences__true';
      real.textContent = item.name;
      entry.appendChild(real);

      fragment.appendChild(entry);
      drawn[item.id] = entry;
    }

    list.textContent = '';
    list.appendChild(fragment);
    return drawn;
  }

  /* ------------------------------------------------------------------
     7. Wiring the field to the signal
     ------------------------------------------------------------------ */

  function watch(root, plan) {
    var source = signal();
    if (!source) {
      return null;
    }

    var pending = null;
    var frame = null;
    var request = typeof global.requestAnimationFrame === 'function'
      ? function (fn) { return global.requestAnimationFrame(fn); }
      : function (fn) { return global.setTimeout(fn, 16); };

    function paint() {
      frame = null;
      if (!pending) {
        return;
      }
      var value = pending;
      pending = null;

      var read = legibility(value.amount, value.x, value.y);
      var drift = parallax({ depth: 1 }, value.x, value.y);

      /* Only custom properties that feed transform and opacity. Nothing here
         asks the browser for a layout or a paint it did not already owe. */
      root.style.setProperty('--wall-dx', read.dx.toFixed(2) + 'px');
      root.style.setProperty('--wall-dy', read.dy.toFixed(2) + 'px');
      root.style.setProperty('--wall-ghost', read.ghost.toFixed(3));
      root.style.setProperty('--wall-ink', read.inkOpacity.toFixed(3));
      root.style.setProperty('--wall-px', drift.x.toFixed(2) + 'px');
      root.style.setProperty('--wall-py', drift.y.toFixed(2) + 'px');
      root.setAttribute('data-resolved', read.legibility > 0.85 ? 'true' : 'false');
    }

    function handle(value) {
      pending = value || { amount: 0, x: 0, y: 0 };
      if (frame === null) {
        frame = request(paint);
      }
    }

    try {
      return source.on('change', handle);
    } catch (err) {
      warn('the influences wall could not read the intensity signal.', err);
      return null;
    }
  }

  /*
    SplitText, which KTD2 pinned for exactly this: the per-line treatment on
    the names that have resolved. Only the bleeding layer is split - a dozen
    elements, not ninety - because splitting the whole wall would buy nothing
    and cost a great deal. Feature-detected, so a blocked CDN loses the
    treatment and keeps the names.
  */
  function splitResolved(root) {
    var g = global.gsap;
    if (typeof g === 'undefined' || typeof global.SplitText === 'undefined') {
      return;
    }
    var targets = root.querySelectorAll('.influences__name--bleed .influences__true');
    if (!targets || targets.length === 0) {
      return;
    }
    try {
      var split = new global.SplitText(targets, { type: 'lines', linesClass: 'influences__line' });
      g.from(split.lines, {
        yPercent: 108,
        opacity: 0,
        duration: 0.5,
        ease: 'power2.out',
        stagger: 0.03,
        scrollTrigger: { trigger: root, start: 'top 85%', once: true }
      });
    } catch (err) {
      warn('the influences wall could not split its lines.', err);
    }
  }

  /* ------------------------------------------------------------------
     8. The beat flash
     ------------------------------------------------------------------ */

  function flasher(drawn, plan) {
    var previous = [];
    var lit = [];
    var boundary = 0;

    function clear() {
      for (var i = 0; i < lit.length; i++) {
        lit[i].classList.remove('is-flash');
      }
      lit = [];
    }

    /**
     * One beat boundary. Safe to call by hand; the clock owner may drive it.
     * With no tempo map in content/mixes.js nothing ever calls this, and the
     * wall is inert by construction rather than by accident.
     */
    return function pulse(payload) {
      var beat = payload || {};
      boundary += 1;
      var picked = flash(plan, boundary, previous);
      clear();
      for (var i = 0; i < picked.items.length; i++) {
        var element = drawn[picked.items[i].id];
        if (element) {
          element.classList.add('is-flash');
          lit.push(element);
        }
      }
      previous = picked.names;
      /* One beat, then out. Never a standing change and never a full-viewport
         one: at most four small names, in bone, on the near-black ground. */
      global.setTimeout(clear, Math.max(120, Math.min(600, num(beat.beatIntervalMs, 480) * 0.9)));
    };
  }

  /* ------------------------------------------------------------------
     9. mount()
     ------------------------------------------------------------------ */

  var pulseHandler = null;

  /**
   * Draw the wall and wire it up. Returns true if it drew, false if anything
   * it needed was missing. It never throws: a failure here loses the wall,
   * not the page.
   */
  function mount(options) {
    var opts = options || {};
    var doc = opts.document || (typeof global.document !== 'undefined' ? global.document : null);
    if (!doc || typeof doc.getElementById !== 'function') {
      return false;
    }

    var root = opts.root || doc.getElementById('influences-wall');
    if (!root) {
      return false;
    }
    var list = root.querySelector('.influences__list');
    if (!list) {
      return false;
    }

    var names = opts.names || LUVIZ.influences;
    if (!Array.isArray(names) || names.length === 0) {
      root.setAttribute('data-state', 'empty');
      return false;
    }

    var reduced = readReducedMotion(opts);
    var plan = layout(names, { reducedMotion: reduced });

    var drawn = draw(doc, list, plan);
    root.setAttribute('data-state', reduced ? 'static' : 'live');
    root.setAttribute('data-count', String(plan.count));

    if (reduced) {
      /* The full list, plainly readable, and nothing else. */
      return true;
    }

    watch(root, plan);
    splitResolved(root);

    pulseHandler = flasher(drawn, plan);
    var clock = findClock();
    if (clock) {
      try {
        clock.on('beat', pulseHandler);
      } catch (err) {
        warn('the influences wall could not follow the beat.', err);
      }
    }

    return true;
  }

  /* ------------------------------------------------------------------ */

  LUVIZ.influencesWall = {
    LAYERS: LAYERS,
    STATIC_LAYER: STATIC_LAYER,
    LAYER_PATTERN: LAYER_PATTERN,
    MAX_ROTATION_DEG: MAX_ROTATION_DEG,
    MAX_SEPARATION_PX: MAX_SEPARATION_PX,
    MAX_PARALLAX_PX: MAX_PARALLAX_PX,
    FLASH_MAX: FLASH_MAX,
    FLASH_INK: FLASH_INK,
    MAX_FLASH_AREA: MAX_FLASH_AREA,

    seed: seed,
    layerById: layerById,
    layout: layout,
    legibility: legibility,
    parallax: parallax,
    flash: flash,

    mount: mount,

    /** Fire one beat boundary by hand. The clock owner may call this. */
    pulse: function (payload) {
      if (typeof pulseHandler === 'function') {
        pulseHandler(payload);
      }
    }
  };

  /*
    Self-booting, and guarded, because js/app.js is U4's file and this unit
    does not edit it. A throw in here must never stop the rest of the page.
  */
  function bootSafely() {
    try {
      mount();
    } catch (err) {
      warn('the influences wall could not be drawn.', err);
    }
  }

  if (typeof global.document !== 'undefined' && global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', bootSafely);
    } else {
      bootSafely();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
