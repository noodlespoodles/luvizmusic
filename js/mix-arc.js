/* ==========================================================================
   LUVIZMUSIC - mix-arc.js
   --------------------------------------------------------------------------
   THE BROWSER HALF OF THE MIXES ARC. js/mix-arc-model.js does the maths;
   this file owns the elements, the drag and the frame loop.

   WHAT IT BUILDS. The mixes list becomes a ring: every card hangs off a
   circle a couple of thousand pixels across, so only a shallow crown of it
   is ever on screen. You shove it sideways, it coasts, and it settles on a
   card. Cards lean as they travel and fade out as they turn away.

   HOW THE TURNING IS SPLIT, AND WHY. Each slot is given a FIXED angle once,
   at build time, as a custom property. GSAP then rotates the ring, and the
   browser composes the two. So a slot's angle on screen is its own angle
   plus the ring's, and NOTHING has to write a rotation per slot per frame.
   The frame loop only writes what genuinely depends on where a card has got
   to: how solid it is, how big, how high in the stack, and whether it can
   be clicked.

   WHEN IT DOES NOTHING AT ALL. Under reduced motion, on a narrow screen,
   with GSAP blocked, or with no mixes to show, this file returns before
   touching anything and the list stays the plain grid it shipped as. That
   is why every arc rule in css/sections.css is scoped under
   [data-arc-state], which only ever gets set from here.

   IT IS STARTED FROM js/app.js, NOT BY BEING LOADED. The player bar claims
   its cards inside boot(), long after every script has parsed, and the
   clones here have to be taken AFTER that or they come out without a play
   button on them. Script order cannot express that; the boot order can.
   ========================================================================== */

(function (global) {
  'use strict';

  var document = global.document;
  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* Below this the arc is not a layout, it is a nuisance. The grid stands. */
  var MIN_VIEWPORT = 768;

  /* A resize changes the slot COUNT, not just the placement, so it rebuilds
     the ring. Rebuilding on every resize event would thrash. */
  var RESIZE_QUIET_MS = 150;

  /* How long after a throw a stray click stays blocked. Long enough that
     letting go over a link does not open it, short enough to be unnoticed. */
  var CLICK_GUARD_MS = 150;

  /* Air under the lowest visible card. */
  var VIEWPORT_PAD = 24;

  function warn(message, err) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('LUVIZ: ' + message, err || '');
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------
     The one live arc
     ------------------------------------------------------------------ */

  var arc = null;

  function Arc(shell, viewport, ring) {
    this.shell = shell;
    this.viewport = viewport;
    this.ring = ring;

    /* The cards the owner actually posted, in order. Clones are appended
       after these and never enter this list. */
    this.originals = [];
    this.slots = [];
    this.geometry = null;
    this.index = 0;
    this.dragging = false;
    this.blockClicksUntil = 0;
  }

  /**
   * Read the slots the renderer produced. Called once, before any clone
   * exists, so it captures the owner's real mixes and nothing else.
   */
  Arc.prototype.claim = function () {
    this.originals = [];
    for (var i = 0; i < this.ring.children.length; i++) {
      var node = this.ring.children[i];
      if (node.className && String(node.className).indexOf('mix-arc__slot') >= 0) {
        this.originals.push(node);
      }
    }
    return this.originals.length;
  };

  /**
   * Fill the circle. There are always more slots than mixes, so the list is
   * cycled until the ring closes and the wheel never shows a gap where the
   * records ran out.
   *
   * The clones are taken from the cards AS THEY STAND, which is why this
   * runs after the player bar has claimed them: a clone taken any earlier
   * would be missing its play button.
   */
  Arc.prototype.build = function () {
    var model = LUVIZ.mixArcModel;
    var g = this.geometry = model.geometry(global.innerWidth);
    var real = this.originals.length;
    var i;

    /* Drop any clones from a previous build before measuring again. */
    for (i = this.ring.children.length - 1; i >= 0; i--) {
      var existing = this.ring.children[i];
      if (existing.getAttribute && existing.getAttribute('data-arc-clone') === 'true') {
        this.ring.removeChild(existing);
      }
    }

    this.slots = this.originals.slice();
    for (i = real; i < g.slotCount; i++) {
      var clone = makeInert(this.originals[i % real].cloneNode(true));
      this.ring.appendChild(clone);
      this.slots.push(clone);
    }

    /* The fixed half of each slot's angle. The ring supplies the rest. */
    this.ring.style.setProperty('--arc-radius', g.radius + 'px');
    this.ring.style.setProperty('--arc-card-width', g.cardWidth + 'px');
    for (i = 0; i < this.slots.length; i++) {
      this.slots[i].style.setProperty(
        '--slot-angle', model.place(i, g.step, 0).rotate.toFixed(4) + 'deg'
      );
    }

    this.sizeViewport();
  };

  /**
   * makeInert(slot) -> the same slot, now scenery.
   *
   * A CLONE IS SCENERY. It exists so the wheel never shows a gap where the
   * records ran out, and that is its whole job. It is never announced to a
   * screen reader, never reachable by keyboard, never clickable, and above
   * all it NEVER CARRIES A MIX INDEX.
   *
   * That last one is the load-bearing part. js/player-bar.js finds the cards
   * it should claim with `.mix-card[data-mix-index]` and appends a play
   * button to each. A clone that kept its index would be handed a second
   * button - one whose click listener did not survive cloneNode, so it would
   * look identical and do nothing. Stripping the index here means the player
   * bar skips clones for free and needs no edit at all.
   *
   * Exported because it is the contract worth testing: the failure it
   * prevents is silent in every browser.
   */
  function makeInert(slot) {
    slot.setAttribute('data-arc-clone', 'true');
    slot.setAttribute('aria-hidden', 'true');

    var all = [slot];
    var descendants = slot.getElementsByTagName ? slot.getElementsByTagName('*') : [];
    for (var i = 0; i < descendants.length; i++) {
      all.push(descendants[i]);
    }

    for (var j = 0; j < all.length; j++) {
      var node = all[j];
      if (node.removeAttribute) {
        node.removeAttribute('data-mix-index');
        /* A duplicated id is invalid and breaks every label that points at
           the original. */
        node.removeAttribute('id');
      }
      var tag = node.tagName;
      var focusable = tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
        tag === 'SELECT' || tag === 'TEXTAREA' ||
        (node.getAttribute && node.getAttribute('tabindex') !== null);
      if (focusable && node.setAttribute) {
        node.setAttribute('tabindex', '-1');
      }
    }
    return slot;
  }

  function isClone(slot) {
    return !!(slot.getAttribute && slot.getAttribute('data-arc-clone') === 'true');
  }

  /**
   * The box only has to hold the slice of the wheel that is on screen: how
   * far the arc has dropped by the time it leaves the viewport, plus a real
   * card's height. The card is MEASURED rather than guessed - guessing left
   * a dead band under the wheel in the prototype.
   */
  Arc.prototype.sizeViewport = function () {
    var g = this.geometry;
    var halfSpan = global.innerWidth / 2 + g.cardWidth / 2;
    var edge = Math.asin(Math.min(1, halfSpan / g.radius));
    var drop = g.radius * (1 - Math.cos(edge));
    var card = this.slots.length ? this.slots[0].firstChild : null;
    var cardHeight = (card && card.offsetHeight) || 240;
    this.viewport.style.height = Math.round(drop + cardHeight + VIEWPORT_PAD) + 'px';
  };

  /**
   * ONE COSINE PER SLOT PER FRAME. The slot's rotation is already handled by
   * CSS composing its fixed angle with the ring's, so nothing here writes a
   * transform on the slot at all - only the four things that genuinely
   * depend on how far round it has got.
   */
  Arc.prototype.place = function () {
    var model = LUVIZ.mixArcModel;
    var g = this.geometry;
    var spin = (global.gsap && global.gsap.getProperty(this.ring, 'rotation')) || 0;

    for (var i = 0; i < this.slots.length; i++) {
      var slot = this.slots[i];
      var p = model.place(i, g.step, spin);

      slot.style.opacity = p.opacity === 0 ? '0' : p.opacity.toFixed(3);
      slot.style.visibility = p.opacity === 0 ? 'hidden' : 'visible';
      slot.style.zIndex = String(p.zIndex);
      /* A clone is never clickable, however far round it has come. This is
         an inline style, so it has to be decided here rather than left to a
         stylesheet rule the frame loop would overwrite. */
      slot.style.pointerEvents = (p.clickable && !isClone(slot)) ? 'auto' : 'none';

      /* Scale belongs on the CARD, whose origin is its own middle. On the
         slot it would scale about the centre of the circle and send the
         card sliding off the arc. */
      var card = slot.firstChild;
      if (card && card.style) {
        card.style.transform = 'scale(' + p.scale.toFixed(3) + ')';
      }
    }
  };

  /* ------------------------------------------------------------------
     The gesture
     ------------------------------------------------------------------ */

  Arc.prototype.drag = function () {
    var self = this;
    var g = global.gsap;
    var Draggable = global.Draggable;

    try {
      g.registerPlugin(Draggable);
      if (typeof global.InertiaPlugin !== 'undefined') {
        g.registerPlugin(global.InertiaPlugin);
      }
    } catch (err) {
      warn('the mixes arc could not register its drag plugins.', err);
      return false;
    }

    /*
      A CLICK IS NOT A SHORT DRAG. Letting go of a shove while the pointer
      happens to be over a play button must not start the music. Draggable's
      own minimumMovement decides when a press becomes a drag; the capture
      phase blocker below covers the tail, because a throw is still moving
      under the finger after it lifts.
    */
    this.shell.addEventListener('click', function (event) {
      if (self.dragging || Date.now() < self.blockClicksUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    try {
      Draggable.create(this.ring, {
        type: 'rotation',
        inertia: typeof global.InertiaPlugin !== 'undefined',
        /* Vertical page scroll survives a sideways shove. Without these two
           the arc becomes a scroll trap on a phone. */
        allowNativeTouchScrolling: true,
        dragClickables: true,
        minimumMovement: 8,
        snap: function (value) {
          return global.gsap.utils.snap(self.geometry.step)(value);
        },
        onDragStart: function () {
          self.dragging = true;
          self.shell.setAttribute('data-arc-dragging', 'true');
        },
        onDrag: function () { self.place(); },
        onThrowUpdate: function () { self.place(); },
        onThrowComplete: function () {
          self.blockClicksUntil = Date.now() + CLICK_GUARD_MS;
          self.place();
        },
        onDragEnd: function () {
          self.dragging = false;
          self.blockClicksUntil = Date.now() + CLICK_GUARD_MS;
          self.shell.removeAttribute('data-arc-dragging');
          self.place();
        }
      });
    } catch (err) {
      warn('the mixes arc could not be made draggable.', err);
      return false;
    }

    this.ring.style.touchAction = 'pan-y pinch-zoom';
    return true;
  };

  /**
   * Turn the ring so that slot `i` of the OWNER'S list is dead ahead.
   * Wrapped on the real mixes, never on the clone count: the arrow keys
   * walk the mixes, not the padding.
   */
  Arc.prototype.goTo = function (i, animate) {
    var model = LUVIZ.mixArcModel;
    var self = this;
    this.index = model.wrap(i, this.originals.length);
    var to = -this.index * this.geometry.step;

    if (animate && global.gsap && !prefersReducedMotion()) {
      global.gsap.to(this.ring, {
        rotation: to,
        duration: 0.45,
        ease: 'power2.out',
        onUpdate: function () { self.place(); },
        onComplete: function () { self.place(); }
      });
    } else {
      global.gsap.set(this.ring, { rotation: to });
      this.place();
    }
  };

  /**
   * THE ARC IS OPERABLE WITHOUT A POINTER. Arrow keys, Home and End walk the
   * owner's mixes; the ring follows. And because a card can be tabbed to
   * while it is round the back where nobody can see it, anything that takes
   * focus is turned to the front.
   */
  Arc.prototype.keyboard = function () {
    var self = this;

    this.shell.setAttribute('role', 'region');
    this.shell.setAttribute('aria-roledescription', 'carousel');
    this.shell.setAttribute(
      'aria-label',
      'Recorded mixes. Drag, or use the arrow keys, to browse.'
    );
    this.shell.setAttribute('tabindex', '0');

    this.shell.addEventListener('keydown', function (event) {
      var last = self.originals.length - 1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        self.goTo(self.index + 1, true);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        self.goTo(self.index - 1, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        self.goTo(0, true);
      } else if (event.key === 'End') {
        event.preventDefault();
        self.goTo(last, true);
      }
    });

    /*
      Tabbing must never leave focus on a card that is turned away. Only the
      originals can receive focus at all - the clones were given tabindex -1
      - so the index found here is always a real mix.
    */
    this.shell.addEventListener('focusin', function (event) {
      var node = event.target;
      while (node && node !== self.shell) {
        var at = self.originals.indexOf(node);
        if (at >= 0) {
          if (at !== self.index) {
            self.goTo(at, true);
          }
          return;
        }
        node = node.parentNode;
      }
    });
  };

  Arc.prototype.watchResize = function () {
    var self = this;
    var timer = 0;
    global.addEventListener('resize', function () {
      global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        /* Below the breakpoint the arc has no business existing. Rather than
           half-dismantling it, leave it built but let the stylesheet hand the
           grid back: [data-arc-state] is what every arc rule hangs off. */
        if (global.innerWidth < MIN_VIEWPORT) {
          /* Hand the grid back. The stylesheet stops applying arc rules the
             moment the state stops being live, but the measured height is an
             INLINE style and would survive, boxing the grid into the arc's
             dimensions and clipping it. It has to be cleared here. */
          self.shell.setAttribute('data-arc-state', 'idle');
          self.viewport.style.height = '';
          return;
        }
        self.shell.setAttribute('data-arc-state', 'live');
        self.build();
        self.place();
      }, RESIZE_QUIET_MS);
    }, { passive: true });
  };

  /* ------------------------------------------------------------------
     Starting up
     ------------------------------------------------------------------ */

  /**
   * Called from js/app.js boot(), immediately after the player bar has
   * claimed its cards. Every reason not to build is checked here, and every
   * one of them leaves the page exactly as it was.
   */
  function init() {
    if (!document) {
      return false;
    }

    var shell = document.querySelector('[data-mix-arc]');
    var ring = document.getElementById('mix-list');
    var viewport = shell && shell.querySelector('.mix-arc__viewport');
    if (!shell || !ring || !viewport) {
      return false;
    }

    if (prefersReducedMotion()) {
      /* Never constructed, not built and then disabled. The same shape as
         the scroll scenes' promise: a thing that does not exist cannot be
         switched back on by a resize. */
      return false;
    }

    if (global.innerWidth < MIN_VIEWPORT) {
      return false;
    }

    if (!global.gsap || typeof global.Draggable === 'undefined') {
      warn('the mixes arc needs GSAP and Draggable; the grid stands instead.');
      return false;
    }

    if (!LUVIZ.mixArcModel) {
      warn('js/mix-arc-model.js did not load; the mixes grid stands instead.');
      return false;
    }

    arc = new Arc(shell, viewport, ring);

    /* No cards means the renderer failed or the owner has posted nothing.
       Either way there is no ring to build and an empty state to leave be. */
    if (arc.claim() === 0) {
      arc = null;
      return false;
    }

    /* Hidden while it is measured and placed, so the visitor never sees the
       instant where every card is stacked on top of the first. */
    shell.setAttribute('data-arc-state', 'pending');

    try {
      arc.build();
      arc.place();
    } catch (err) {
      warn('the mixes arc could not be built; the grid stands instead.', err);
      shell.removeAttribute('data-arc-state');
      arc = null;
      return false;
    }

    if (!arc.drag()) {
      shell.removeAttribute('data-arc-state');
      arc = null;
      return false;
    }

    arc.keyboard();
    arc.watchResize();
    shell.setAttribute('data-arc-state', 'live');
    return true;
  }

  LUVIZ.mixArc = {
    MIN_VIEWPORT: MIN_VIEWPORT,
    init: init,
    makeInert: makeInert,
    isClone: isClone,
    current: function () { return arc; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
