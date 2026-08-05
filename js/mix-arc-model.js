/* ==========================================================================
   LUVIZMUSIC - mix-arc-model.js
   --------------------------------------------------------------------------
   THE MATHS OF THE MIXES ARC, AND NOTHING ELSE. This file builds no element
   and reads no page. It answers three questions and hands the answers to
   js/mix-arc.js, which does the wiring.

     1. geometry(width)  - how big is a card, how big is the circle it hangs
                           off, how far apart are the cards, and how many
                           slots does it take to close that circle?
     2. place(i, step, spin) - for one slot at one rotation: how far is it
                           turned, how big, how solid, how high in the stack,
                           and may it be clicked?
     3. wrap(i, count)   - the arrow keys walk the owner's real mixes, not
                           the clones that pad the ring out.

   It is deliberately DOM-free, for the same reason js/scene-plan.js is: Node
   has no `document`, the no-install rule forbids a fake browser, and this is
   the half of the carousel that can be PROVED rather than eyeballed. See
   tests/mixarc.test.js. The browser half is verified by dragging it.

   THE SHAPE THIS ENCODES

   The display mode is a very large circle seen edge-on, so only a shallow
   crown of it is ever on screen. The cards hang off that circle like records
   leaning in a rack. Measured off the reference on 2026-08-05: a radius of
   about 2800px and a step of about 8 degrees between neighbours.

   The step is NOT a constant typed in here. It is SOLVED, so that one card
   width plus a little air always sits between neighbours whatever the
   viewport does, and then rounded so that a whole number of slots closes the
   circle EXACTLY. That rounding is what lets the ring wrap seamlessly: if
   slotCount * step were 359.6 degrees, the wheel would jump every full turn.

   A CARD TURNS WITH THE RING (KTD2). Its rotation is its own angle, so the
   third card out is leaning by three steps. That lean is the signature of
   the display mode, and it is why this file returns `rotate` at all rather
   than just an x offset.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* ------------------------------------------------------------------
     The calibration.
     ------------------------------------------------------------------
     Starting values, read off the reference and converted to a rule that
     survives a resize. They are tuned against a browser, not asserted by
     the tests: the tests fix the RELATIONSHIPS these numbers have to keep,
     so any of them can be nudged without turning the suite red.
     ------------------------------------------------------------------ */

  /* Card width: the reference's clamp(180px, 31.5vw, 270px). */
  var CARD_MIN = 180;
  var CARD_MAX = 270;
  var CARD_VW = 0.315;

  /* Circle radius. The reference is a flat 2800px; scaling it with the
     viewport keeps the arc's curvature reading the same on a laptop as on
     a large display, and the ceiling stops it going effectively straight. */
  var RADIUS_MIN = 1600;
  var RADIUS_MAX = 3200;
  var RADIUS_VW = 1.9;

  /* Centre-to-centre spacing as a multiple of the card width. The reference
     works out at 391px of arc for a 270px card, which is 1.448. */
  var GAP = 1.448;

  /* The step is held inside this band whatever the arithmetic says. Below
     the floor the cards overlap into a smear; above the ceiling they fling
     apart and the wheel reads as a fan of playing cards. */
  var STEP_MIN_DEG = 6;
  var STEP_MAX_DEG = 14;

  /* Depth ramps. A card face-on is depth 1; one a quarter turn away is 0. */
  var SCALE_MIN = 0.80;
  var SCALE_MAX = 1.00;
  var OPACITY_MIN = 0.20;

  /* Past this depth a card is too far turned to be a fair click target. */
  var CLICK_THRESHOLD = 0.35;

  var DEG = Math.PI / 180;

  function clamp(value, low, high) {
    if (!isFinite(value)) {
      return low;
    }
    return Math.min(high, Math.max(low, value));
  }

  /**
   * cardWidthFor(viewportWidth) -> px
   * The reference's clamp, expressed as arithmetic so Node can check it.
   */
  function cardWidthFor(viewportWidth) {
    return clamp(viewportWidth * CARD_VW, CARD_MIN, CARD_MAX);
  }

  /**
   * radiusFor(viewportWidth) -> px
   */
  function radiusFor(viewportWidth) {
    return clamp(viewportWidth * RADIUS_VW, RADIUS_MIN, RADIUS_MAX);
  }

  /**
   * stepFor(cardWidth, radius) -> degrees, before the circle is closed.
   *
   * The angle whose arc length is one card width plus air. Arc length is
   * radius * angle, so the angle is (cardWidth * GAP) / radius. A wider
   * card wants a bigger step; a bigger circle wants a smaller one, which
   * is exactly why a large radius reads as a shallow shelf rather than a
   * wheel.
   */
  function stepFor(cardWidth, radius) {
    if (!isFinite(cardWidth) || !isFinite(radius) || radius <= 0) {
      return STEP_MAX_DEG;
    }
    var raw = (Math.abs(cardWidth) * GAP) / radius / DEG;
    return clamp(raw, STEP_MIN_DEG, STEP_MAX_DEG);
  }

  /**
   * geometry(viewportWidth) -> { cardWidth, radius, step, slotCount }
   *
   * `step` is the CLOSED step: slotCount * step is exactly 360, so the ring
   * wraps without a seam. `slotCount` is how many slots it takes to fill the
   * circle - normally many more than there are mixes, which is what the
   * clones are for.
   */
  function geometry(viewportWidth) {
    var width = isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
    var cardWidth = cardWidthFor(width);
    var radius = radiusFor(width);

    /* Round to a whole number of slots FIRST, then take the step back out
       of that count. Doing it the other way round leaves a fractional
       remainder in the circle and the wheel jumps once per turn. */
    var slotCount = Math.round(360 / stepFor(cardWidth, radius));
    if (!isFinite(slotCount) || slotCount < 3) {
      slotCount = 3;
    }

    return {
      cardWidth: cardWidth,
      radius: radius,
      step: 360 / slotCount,
      slotCount: slotCount
    };
  }

  /**
   * place(index, step, spin) -> { depth, rotate, scale, opacity, zIndex, clickable }
   *
   * ONE COSINE, FIVE DECISIONS. `depth` is how face-on the slot is: 1 dead
   * ahead, 0 at a quarter turn, negative round the back. Everything else is
   * a function of it, which is why the whole placement loop is cheap enough
   * to run on every frame of a drag.
   *
   * `rotate` and `scale` are deliberately returned separately. `rotate`
   * belongs on the slot, whose transform origin sits at the centre of the
   * circle; `scale` belongs on the card inside it, whose origin is its own
   * middle. Putting both on the slot would scale the card about a point
   * thousands of pixels away and send it sliding off the arc.
   */
  function place(index, step, spin) {
    var angle = (index || 0) * (step || 0) + (spin || 0);
    var depth = Math.cos(angle * DEG);
    var lit = depth > 0;

    return {
      depth: depth,
      rotate: angle,
      scale: SCALE_MIN + (SCALE_MAX - SCALE_MIN) * ((depth + 1) / 2),
      opacity: lit ? OPACITY_MIN + (1 - OPACITY_MIN) * depth : 0,
      zIndex: Math.round((depth + 1) * 100),
      clickable: depth >= CLICK_THRESHOLD
    };
  }

  /**
   * wrap(index, realCount) -> index inside [0, realCount)
   *
   * Arrow keys walk the owner's list. The ring holds many more slots than
   * there are mixes, and walking THOSE would march the visitor through the
   * same eight mixes four times over before wrapping.
   */
  function wrap(index, realCount) {
    var count = Math.floor(realCount);
    if (!isFinite(count) || count <= 0) {
      return 0;
    }
    var i = Math.round(index);
    if (!isFinite(i)) {
      return 0;
    }
    return ((i % count) + count) % count;
  }

  LUVIZ.mixArcModel = {
    CARD_MIN: CARD_MIN,
    CARD_MAX: CARD_MAX,
    RADIUS_MIN: RADIUS_MIN,
    RADIUS_MAX: RADIUS_MAX,
    STEP_MIN_DEG: STEP_MIN_DEG,
    STEP_MAX_DEG: STEP_MAX_DEG,
    SCALE_MIN: SCALE_MIN,
    SCALE_MAX: SCALE_MAX,
    OPACITY_MIN: OPACITY_MIN,
    CLICK_THRESHOLD: CLICK_THRESHOLD,

    cardWidthFor: cardWidthFor,
    radiusFor: radiusFor,
    stepFor: stepFor,
    geometry: geometry,
    place: place,
    wrap: wrap
  };
})(typeof window !== 'undefined' ? window : globalThis);
