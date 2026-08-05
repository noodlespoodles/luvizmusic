/* =========================================================================
   LUVIZMUSIC - navigation transitions

   A nav click should feel like the page moves you, not like it teleports.
   Two things happen:

     1. The travel. A timed scroll rather than an instant jump, easing out so
        it decelerates into the section instead of slamming.
     2. The arrival. The target's heading takes a quick plate separation and
        snaps back into register - the same misregistration device the crew
        cards use, fired once as punctuation.

   What it will not do:
     - It never scroll-jacks. The visitor can interrupt at any point by
       touching the wheel, a key, or the screen, and the tween gets out of
       the way immediately. A transition you cannot escape is the thing
       everyone hates about sites like this.
     - Under prefers-reduced-motion it jumps straight there with no effect.
     - It never traps focus or breaks the back button: the hash is written
       after arrival, so history still works.
   ========================================================================= */

window.LUVIZ = window.LUVIZ || {};

(function (LUVIZ) {
  'use strict';

  var TRAVEL_MS = 620;
  var reduced = false;

  function prefersReduced() {
    return typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Distance from the top of the viewport that a section should land at,
     clear of the fixed mark and nav. U4 publishes the height. */
  function chromeOffset() {
    var root = document.documentElement;
    var nav = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h'));
    return (isFinite(nav) ? nav : 0) + 12;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Scroll to `top` over TRAVEL_MS, abandoning the tween the moment the
   * visitor scrolls, taps, or presses a key. Calls done() either way.
   */
  function travelTo(top, done) {
    var start = window.scrollY || window.pageYOffset;
    var delta = top - start;
    if (Math.abs(delta) < 2) { done(); return; }

    var began = null;
    var cancelled = false;

    function cancel() { cancelled = true; }
    var events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach(function (name) {
      window.addEventListener(name, cancel, { passive: true, once: true });
    });

    function release() {
      events.forEach(function (name) { window.removeEventListener(name, cancel); });
    }

    function step(now) {
      if (began === null) began = now;
      if (cancelled) { release(); done(); return; }
      var t = Math.min(1, (now - began) / TRAVEL_MS);
      window.scrollTo(0, start + delta * easeOutCubic(t));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        release();
        done();
      }
    }
    requestAnimationFrame(step);
  }

  /**
   * The arrival punctuation. Adds a class the CSS animates, then takes it
   * off again so a second visit to the same section fires it afresh.
   */
  function punctuate(section) {
    if (reduced || !section) return;
    var mark = section.querySelector('h2, h1') || section;
    mark.classList.remove('is-arriving');
    /* Force a reflow so removing and re-adding restarts the animation. */
    void mark.offsetWidth;
    mark.classList.add('is-arriving');
    window.setTimeout(function () {
      mark.classList.remove('is-arriving');
    }, 700);
  }

  function targetOf(anchor) {
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) !== '#' || href.length < 2) return null;
    try {
      return document.getElementById(decodeURIComponent(href.slice(1)));
    } catch (err) {
      return null;
    }
  }

  function go(section, hash) {
    var top = section.getBoundingClientRect().top +
      (window.scrollY || window.pageYOffset) - chromeOffset();

    function land() {
      /* Written after arrival so the browser does not also jump, and so the
         back button still returns the visitor where they came from. */
      if (hash && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', hash);
      }
      /* Keyboard users must end up IN the section, not back at the nav. */
      if (!section.hasAttribute('tabindex')) {
        section.setAttribute('tabindex', '-1');
      }
      section.focus({ preventScroll: true });
      punctuate(section);
    }

    if (reduced) {
      window.scrollTo(0, top);
      land();
      return;
    }
    travelTo(top, land);
  }

  function onClick(event) {
    if (event.defaultPrevented) return;
    /* Let the browser handle anything that is not a plain left click, so
       open-in-new-tab and friends keep working. */
    if (event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;

    var anchor = event.target.closest && event.target.closest('a[href^="#"]');
    if (!anchor) return;
    var section = targetOf(anchor);
    if (!section) return;

    event.preventDefault();
    go(section, anchor.getAttribute('href'));
  }

  function attach(root) {
    var scope = root || document;
    reduced = prefersReduced();
    if (typeof matchMedia === 'function') {
      var mq = matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function () { reduced = mq.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    scope.addEventListener('click', onClick);
    return function detach() { scope.removeEventListener('click', onClick); };
  }

  LUVIZ.navTransition = {
    attach: attach,
    travelMs: TRAVEL_MS,
    easeOutCubic: easeOutCubic
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LUVIZ.navTransition;
  }
}(window.LUVIZ));
