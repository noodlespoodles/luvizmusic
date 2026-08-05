/* ==========================================================================
   LUVIZMUSIC - app.js
   --------------------------------------------------------------------------
   THE BOOT HUB. Always the last script on the page, and the only file that
   knows the order things happen in:

     1. take manual control of scroll restoration
     2. measure the fixed chrome and publish its height
     3. read window.LUVIZ
     4. render each section INSIDE ITS OWN try/catch  (R9a)
     5. show one plain-English notice naming anything that failed
     6. wire the player bar, if a later unit has shipped one
     7. start the intensity signal, if a later unit has shipped one
     8. build the scroll scenes, if a later unit has shipped them
     9. once the fonts are in: refresh ScrollTrigger, then re-resolve the
        address bar's #hash against the page as it now measures

   TWO RULES THIS FILE OBEYS

   A. EVERY LATER UNIT IS OPTIONAL. U6 to U9 do not exist yet. Every hook
      into them is guarded with typeof and wrapped in a try/catch, so the
      page works today and keeps working if one of them is ever removed.

   B. NOTHING HIDES CONTENT UNTIL IT CAN BE UNHIDDEN. Reveal targets ship
      visible; the hiding class is added only after the observer is wired,
      and never to something already on screen. A script error can therefore
      leave the page unanimated, but never leave it blank.
   ========================================================================== */

(function (global) {
  'use strict';

  var document = global.document;
  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* The clearance a focused element keeps from the fixed chrome, in px. */
  var CHROME_GAP = 12;

  /*
    Manual scroll restoration (R21). The browser restores the old scroll
    position asynchronously, after our content has rendered but before the
    fonts have settled - which lands the visitor in the wrong place and then
    fights the re-resolve at the end of boot. We own it instead.
  */
  if (global.history && 'scrollRestoration' in global.history) {
    try {
      global.history.scrollRestoration = 'manual';
    } catch (err) {
      /* Some privacy modes make this read-only. Nothing else depends on it. */
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function warn(message, err) {
    if (global.console && global.console.warn) {
      global.console.warn('[LUVIZMUSIC] ' + message, err || '');
    }
  }

  /** Call a later unit's entry point if, and only if, it really exists. */
  function optional(label, owner, method, args) {
    if (typeof owner === 'undefined' || owner === null) {
      return false;
    }
    var fn = typeof owner[method] === 'function' ? owner[method]
      : (typeof owner === 'function' ? owner : null);
    if (!fn) {
      return false;
    }
    try {
      fn.apply(owner, args || []);
      return true;
    } catch (err) {
      /* A later unit failing is never allowed to take the page down. */
      warn(label + ' did not start.', err);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     1. The fixed chrome, measured and published (R21)
     ------------------------------------------------------------------
     css/base.css ships a sensible height per breakpoint so the page is
     right with JavaScript off. These measurements make it exact, and keep
     it exact when the nav wraps, when the text size changes, and when U6
     finally mounts a player bar.
     ------------------------------------------------------------------ */

  var chrome = { nav: 0, player: 0 };

  function publishChromeHeights() {
    var root = document.documentElement;
    var masthead = byId('masthead');
    var playerBar = byId('player-bar');

    var nav = masthead ? Math.round(masthead.getBoundingClientRect().height) : 0;
    var player = playerBar ? Math.round(playerBar.getBoundingClientRect().height) : 0;

    if (nav !== chrome.nav) {
      chrome.nav = nav;
      root.style.setProperty('--nav-h', nav + 'px');
    }
    if (player !== chrome.player) {
      chrome.player = player;
      root.style.setProperty('--player-h', player + 'px');
    }
  }

  function watchChrome() {
    var scheduled = false;
    function schedule() {
      if (scheduled) {
        return;
      }
      scheduled = true;
      global.requestAnimationFrame(function () {
        scheduled = false;
        publishChromeHeights();
      });
    }

    global.addEventListener('resize', schedule, { passive: true });
    global.addEventListener('orientationchange', schedule, { passive: true });

    if (typeof global.ResizeObserver !== 'undefined') {
      var observer = new global.ResizeObserver(schedule);
      var masthead = byId('masthead');
      if (masthead) {
        observer.observe(masthead);
      }
    }
  }

  /* ------------------------------------------------------------------
     2. Rendering, one section at a time (R9a)
     ------------------------------------------------------------------ */

  function renderEverything() {
    var report = { missing: [], errors: [], broken: [] };

    /* Which content files never reported in, and which entries are wrong. */
    if (LUVIZ.validate && typeof LUVIZ.validate.all === 'function') {
      var verdict = LUVIZ.validate.all(LUVIZ);
      report.missing = verdict.missing || [];
      report.errors = verdict.errors || [];
    } else if (typeof LUVIZ._missing === 'function') {
      report.missing = LUVIZ._missing();
    }

    var sections = LUVIZ.sections;
    if (!sections) {
      report.broken.push(
        'js/sections.js did not load, so the crew, mixes, dates and contact ' +
        'links cannot be drawn. The words already on the page are unaffected.'
      );
      return report;
    }

    /*
      Each render is walled off from the next. A content file that loaded but
      holds something the renderer chokes on takes out ONE section, is named
      in the notice, and leaves the other four standing.
    */
    function attempt(file, fn) {
      try {
        fn();
      } catch (err) {
        warn(file + ' could not be rendered.', err);
        report.broken.push(
          typeof LUVIZ.explain === 'function'
            ? LUVIZ.explain(file, err)
            : file + ' could not be shown. The rest of the site is still shown.'
        );
      }
    }

    var now = Date.now();

    attempt('content/site.js', function () { sections.hero(LUVIZ.site); });
    attempt('content/crew.js', function () { sections.crew(LUVIZ.crew); });
    attempt('content/mixes.js', function () { sections.mixes(LUVIZ.mixes); });
    attempt('content/events.js', function () { sections.events(LUVIZ.events, now); });
    attempt('content/site.js', function () { sections.contact(LUVIZ.site); });

    return report;
  }

  /* ------------------------------------------------------------------
     3. Reveal targets
     ------------------------------------------------------------------
     Ship visible, hide only once the observer exists, and never hide
     something the visitor can already see.
     ------------------------------------------------------------------ */

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isOnScreen(node) {
    var rect = node.getBoundingClientRect();
    var height = global.innerHeight || document.documentElement.clientHeight;
    return rect.top < height && rect.bottom > 0;
  }

  function wireReveals() {
    var targets = document.querySelectorAll('.reveal');
    var i;

    if (targets.length === 0) {
      return;
    }

    /* No observer, or no appetite for motion: everything is simply shown. */
    if (typeof global.IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      for (i = 0; i < targets.length; i++) {
        targets[i].classList.add('is-revealed');
      }
      return;
    }

    var observer = new global.IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) {
          entries[j].target.classList.add('is-revealed');
          observer.unobserve(entries[j].target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.02 });

    for (i = 0; i < targets.length; i++) {
      if (isOnScreen(targets[i])) {
        /* Already in view at wiring time: revealed on the spot, never hidden. */
        targets[i].classList.add('is-revealed');
      } else {
        targets[i].classList.add('reveal--pending');
        observer.observe(targets[i]);
      }
    }
  }

  /* ------------------------------------------------------------------
     4. Which section the visitor is in
     ------------------------------------------------------------------ */

  function wireActiveSection() {
    var links = document.querySelectorAll('.masthead__link');
    if (links.length === 0) {
      return;
    }

    var targets = [];
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var section = href.charAt(0) === '#' ? byId(href.slice(1)) : null;
      if (section) {
        targets.push({ link: links[i], section: section });
      }
    }

    var scheduled = false;

    function update() {
      scheduled = false;
      var edge = chrome.nav + CHROME_GAP;
      var current = null;
      for (var j = 0; j < targets.length; j++) {
        var rect = targets[j].section.getBoundingClientRect();
        if (rect.top <= edge && rect.bottom > edge) {
          current = targets[j];
        }
      }
      for (var k = 0; k < targets.length; k++) {
        if (targets[k] === current) {
          targets[k].link.setAttribute('aria-current', 'true');
        } else {
          targets[k].link.removeAttribute('aria-current');
        }
      }
    }

    function schedule() {
      if (!scheduled) {
        scheduled = true;
        global.requestAnimationFrame(update);
      }
    }

    global.addEventListener('scroll', schedule, { passive: true });
    global.addEventListener('resize', schedule, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------
     5. Focus never hides behind the fixed chrome (R21)
     ------------------------------------------------------------------
     scroll-margin handles anchors and scrollIntoView. It does NOT help an
     element that receives focus while it is already sitting under the mark
     or under the player bar, which is what happens tabbing backwards. This
     does.
     ------------------------------------------------------------------ */

  function scrollByInstantly(delta) {
    if (delta === 0) {
      return;
    }
    try {
      global.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    } catch (err) {
      global.scrollBy(0, delta);
    }
  }

  function wireFocusRescue() {
    document.addEventListener('focusin', function (event) {
      var node = event.target;
      if (!node || typeof node.getBoundingClientRect !== 'function') {
        return;
      }
      /* The chrome itself is fixed: scrolling the page cannot help it. */
      if (node.closest && node.closest('.masthead, .skip-link, #player-bar')) {
        return;
      }

      var rect = node.getBoundingClientRect();
      var viewport = global.innerHeight || document.documentElement.clientHeight;
      var top = chrome.nav + CHROME_GAP;
      var bottom = viewport - chrome.player - CHROME_GAP;

      if (rect.top < top) {
        scrollByInstantly(Math.round(rect.top - top));
      } else if (rect.bottom > bottom && rect.height < bottom - top) {
        scrollByInstantly(Math.round(rect.bottom - bottom));
      }
    });
  }

  /* ------------------------------------------------------------------
     6. The address bar's #hash, resolved against the settled page
     ------------------------------------------------------------------ */

  function resolveHash() {
    var hash = global.location.hash;
    if (!hash || hash.length < 2) {
      return;
    }
    var id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch (err) {
      id = hash.slice(1);
    }
    var target = byId(id);
    if (!target) {
      return;
    }

    /* Anything inside the target that is still waiting to be revealed is
       shown now: a deep link must never land on a section that is hidden. */
    var pending = target.querySelectorAll('.reveal--pending');
    for (var i = 0; i < pending.length; i++) {
      pending[i].classList.add('is-revealed');
    }

    var offset = target.getBoundingClientRect().top + (global.pageYOffset || 0);
    var top = Math.max(0, Math.round(offset - chrome.nav - CHROME_GAP));
    try {
      global.scrollTo({ top: top, left: 0, behavior: 'instant' });
    } catch (err) {
      global.scrollTo(0, top);
    }
  }

  /* ------------------------------------------------------------------
     7. Boot
     ------------------------------------------------------------------ */

  function boot() {
    publishChromeHeights();
    watchChrome();

    var report = renderEverything();

    if (LUVIZ.sections && typeof LUVIZ.sections.alert === 'function') {
      try {
        LUVIZ.sections.alert(report);
      } catch (err) {
        warn('the content notice could not be drawn.', err);
      }
    }

    /* U6 and U7. The skip link only becomes real once a player bar does. */
    var playerBar = byId('player-bar');
    var skipToPlayer = byId('skip-to-player');
    if (playerBar && skipToPlayer) {
      skipToPlayer.hidden = false;
    }
    optional('the player bar', LUVIZ.playerBar, 'init', [LUVIZ.mixes]);

    /*
      THE MIXES ARC, AND IT MUST BE THIS LINE, NOT A SCRIPT TAG. The arc
      clones cards to fill its ring, and a clone is taken as the card
      stands. The player bar claims its cards on the line above - at boot,
      not when its file parses - so an arc started any earlier would clone
      cards that had no play button on them yet, and the missing buttons
      would only show as the wheel turned.
    */
    optional('the mixes arc', LUVIZ.mixArc, 'init', []);

    /* U7's beat clock and intensity signal. */
    optional('the intensity signal', LUVIZ.intensity, 'start', []);

    /* U8's scroll scenes. */
    optional('the scroll scenes', LUVIZ.scenes, 'build', []);

    /* U9's cursor, marquee and per-section effects. */
    optional('the cursor', LUVIZ.cursor, 'start', []);
    optional('the marquee', LUVIZ.marquee, 'start', []);
    optional('the section effects', LUVIZ.sectionFx, 'start', []);

    wireReveals();
    wireActiveSection();
    wireFocusRescue();

    /*
      THE LAST STEP, AND THE ONE MOST EASILY GOT WRONG.

      Everything above measured the page in the fallback face. When Mark Pro
      arrives every line re-flows and every measurement taken so far is
      stale, so ScrollTrigger is told to re-measure and the #hash is resolved
      again against the page as it finally is. Without this, opening
      /#events lands somewhere near the dates and then drifts.
    */
    function afterFonts() {
      publishChromeHeights();
      if (typeof global.ScrollTrigger !== 'undefined' &&
          typeof global.ScrollTrigger.refresh === 'function') {
        try {
          global.ScrollTrigger.refresh();
        } catch (err) {
          warn('ScrollTrigger could not refresh.', err);
        }
      }
      resolveHash();
    }

    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(afterFonts, afterFonts);
    } else {
      global.addEventListener('load', afterFonts);
    }

    /* A hash typed into the address bar later still lands correctly. */
    global.addEventListener('hashchange', resolveHash);

    /* Nav clicks travel rather than jump (js/nav-transition.js). Guarded like
       every other later-unit global, so a missing file cannot stop the boot. */
    if (LUVIZ.navTransition && typeof LUVIZ.navTransition.attach === 'function') {
      LUVIZ.navTransition.attach(document);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  LUVIZ.app = {
    boot: boot,
    resolveHash: resolveHash,
    chromeHeights: function () {
      return { nav: chrome.nav, player: chrome.player };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
