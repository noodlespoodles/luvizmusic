/* ==========================================================================
   LUVIZMUSIC - player-bar.js
   --------------------------------------------------------------------------
   THE PERSISTENT TRANSPORT (R10, R11, R12, R12a, R13, R15a, R5a, R21).

   This is the browser half of the player. The RULES live next door in
   js/player-state.js, which is a pure transition table with no DOM in it at
   all (KTD15); this file only draws what that table says and forwards taps
   back into it. Nothing here decides what a block means or when to escalate.

   HOW IT IS PUT TOGETHER

     #player-bar          position: fixed, a DIRECT CHILD OF BODY, built here
                          rather than in index.html so no markup change is
                          needed. Being a direct child of body is not a
                          stylistic choice: inside a transformed ancestor,
                          `fixed` silently becomes `absolute` and the bar
                          scrolls away halfway down the page.
       .player__stage     the designed housing for foreign chrome (R5a) -
                          a ruled, labelled panel in U3's retail grammar. It
                          is ABSOLUTELY POSITIONED against the bar, so it
                          overlays the page rather than pushing it. See the
                          long note in css/player.css for why.
       .player__strip     the transport itself. Its height, and only its
                          height, is published as --player-h.

   SIX THINGS THAT ARE EASY TO GET WRONG, AND ARE NOT WRONG HERE

   1. THE FIRST play() IS CALLED SYNCHRONOUSLY INSIDE THE TAP HANDLER.
      No await, no setTimeout, no promise chain in front of it. The provider
      frame is created and its widget is cued at boot precisely so that the
      tap handler has nothing to wait for. This is the hardest constraint in
      the whole site: iOS hands out the visitor's gesture for the length of
      one task, and anything that defers loses it.

   2. THE TRANSPORT IS DISABLED UNTIL THE WIDGET SAYS IT IS READY. That is
      the other half of rule 1 - a button that is enabled before the widget
      exists is a button whose handler HAS to wait.

   3. PLAYBACK IS NEVER STARTED FROM A SCROLL CALLBACK. Scrolling is
      explicitly excluded from user activation, so a ScrollTrigger that
      called play() would be refused, and would burn one of the two chances
      the visitor gets before the native fallback appears.

   4. NO backdrop-filter (KTD12). On a fixed element it repaints the blurred
      region every scroll frame, and is a known severe jank source on iOS
      Safari. The ground is opaque instead.

   5. NO PROVIDER IFRAME IS EVER display: none (KTD5). Browsers deprioritise
      unrendered iframes. A frame that is not the current one is stacked
      behind the current one at zero opacity, still laid out, still rendered.

   6. THE SEEK BAR AND THE VOLUME BAR HAVE THE SAME GEOMETRY WHETHER OR NOT
      THE PROVIDER SUPPORTS THEM (R15a). Mixcloud can refuse to scrub and may
      expose no volume setter; if the controls collapsed when that happened,
      the bar would reflow the moment the visitor changed mix.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var document = global.document;

  /* How often the position is re-read while playing. YouTube emits no
     progress event at all, so polling is the only common denominator.
     250ms is four frames of the readout a second: smooth enough to read,
     far too slow to matter for battery. */
  var POLL_MS = 250;

  /* Arrow-key and drag steps, in seconds. */
  var STEP_SMALL = 5;
  var STEP_LARGE = 30;

  var machine = null;
  var context = null;

  var el = {};          /* every node this file owns, by name */
  var current = null;   /* the live adapter instance, or null */
  var offs = [];        /* unsubscribe functions for the live instance */
  var mixes = [];
  var index = 0;
  var duration = 0;
  var position = 0;
  var volume = 1;
  var pollTimer = null;
  var stageShown = false;
  var lastAnnounced = '';
  var seeking = false;

  /* ------------------------------------------------------------------
     Small DOM helpers
     ------------------------------------------------------------------ */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function attrs(node, map) {
    for (var name in map) {
      if (Object.prototype.hasOwnProperty.call(map, name)) {
        if (map[name] === null) {
          node.removeAttribute(name);
        } else {
          node.setAttribute(name, String(map[name]));
        }
      }
    }
    return node;
  }

  function warn(message, err) {
    if (global.console && global.console.warn) {
      global.console.warn('[LUVIZMUSIC player] ' + message, err || '');
    }
  }

  /** mm:ss, or h:mm:ss once a mix runs past the hour, which most of them do. */
  function formatTime(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    function pad(value) {
      return value < 10 ? '0' + value : String(value);
    }
    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(secs);
    }
    return minutes + ':' + pad(secs);
  }

  /** The same time, said out loud rather than punched into a display. */
  function spokenTime(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(total / 60);
    var secs = total % 60;
    var parts = [];
    if (minutes > 0) {
      parts.push(minutes + (minutes === 1 ? ' minute' : ' minutes'));
    }
    parts.push(secs + (secs === 1 ? ' second' : ' seconds'));
    return parts.join(' ');
  }

  function titleOf(mix) {
    return mix && typeof mix.title === 'string' && mix.title.trim().length > 0
      ? mix.title.trim()
      : 'Untitled mix';
  }

  function providerLabel(mix) {
    var provider = mix && typeof mix.provider === 'string' ? mix.provider : '';
    switch (provider) {
      case 'soundcloud': return 'SoundCloud';
      case 'youtube': return 'YouTube';
      case 'mixcloud': return 'Mixcloud';
      case 'file': return 'This site';
      default: return 'Player';
    }
  }

  /* ------------------------------------------------------------------
     1. Building the bar
     ------------------------------------------------------------------ */

  function buildStage() {
    var stage = make('section', 'player__stage panel');
    attrs(stage, { id: 'player-stage', 'aria-label': 'Provider player', hidden: 'hidden' });

    el.stageLabel = make('span', 'player__stage-label panel__label t-label', 'Player');
    stage.appendChild(el.stageLabel);

    /*
      The adapter appends provider iframes here and MOVES them between mounts
      rather than rebuilding them. Every frame that has ever been built stays
      in this box; css/player.css stacks them and fades the ones that are not
      current. Nothing is ever display: none (KTD5).
    */
    el.mount = make('div', 'player__mount');
    el.mount.id = 'player-mount';
    stage.appendChild(el.mount);

    /* R12a. The short instruction that appears when the browser has refused
       twice and the visitor has to use the provider's own play control. */
    el.native = make('p', 'player__native t-caption');
    attrs(el.native, { id: 'player-native', hidden: 'hidden' });
    stage.appendChild(el.native);

    /* R14/R5a. SoundCloud's credit, its mark and the link back, composed
       into the panel rather than left hanging off the embed. */
    el.attribution = make('p', 'player__attribution t-caption');
    attrs(el.attribution, { id: 'player-attribution', hidden: 'hidden' });
    stage.appendChild(el.attribution);

    el.stage = stage;
    return stage;
  }

  /**
   * A track: elapsed / bar / total. ONE set of nodes serves both the
   * drag-to-seek case and the read-only case (R15a); only the role, the tab
   * stop and the cursor change between them. Nothing that affects layout
   * does, so the bar cannot reflow when the provider changes.
   */
  function buildTrack(name, leadText, trailText, leadClass) {
    var wrap = make('div', 'player__meter player__meter--' + name);

    var lead = make('span', leadClass || 'player__time t-caption t-numeric', leadText);
    var rail = make('div', 'player__rail');
    var fill = make('div', 'player__fill');
    var thumb = make('div', 'player__thumb');
    rail.appendChild(fill);
    rail.appendChild(thumb);
    var trail = make('span', 'player__time t-caption t-numeric', trailText);

    wrap.appendChild(lead);
    wrap.appendChild(rail);
    wrap.appendChild(trail);

    return { wrap: wrap, lead: lead, rail: rail, fill: fill, trail: trail };
  }

  function buildBar() {
    var bar = make('div', 'player above-grain');
    attrs(bar, { id: 'player-bar', role: 'region', 'aria-label': 'Mix player' });

    bar.appendChild(buildStage());

    var strip = make('div', 'player__strip');

    /* --- transport ------------------------------------------------- */
    var transport = make('div', 'player__transport');

    el.toggle = make('button', 'player__button player__button--primary');
    attrs(el.toggle, {
      id: 'player-toggle',
      type: 'button',
      'aria-pressed': 'false',
      disabled: 'disabled'
    });
    el.toggleGlyph = make('span', 'player__glyph');
    attrs(el.toggleGlyph, { 'aria-hidden': 'true' });
    el.toggleText = make('span', 'player__button-text t-label', 'Play');
    el.toggle.appendChild(el.toggleGlyph);
    el.toggle.appendChild(el.toggleText);
    transport.appendChild(el.toggle);

    el.next = make('button', 'player__button player__button--next');
    attrs(el.next, { id: 'player-next', type: 'button', hidden: 'hidden' });
    el.next.appendChild(make('span', 'player__button-text t-label', 'Next'));
    transport.appendChild(el.next);

    strip.appendChild(transport);

    /* --- what is on, and what state it is in ----------------------- */
    var now = make('div', 'player__now');
    var line = make('p', 'player__line');
    el.stateChip = make('span', 'player__chip chip chip--bright t-label', 'Cueing');
    el.stateChip.id = 'player-state';
    el.title = make('span', 'player__title', 'Nothing cued');
    el.title.id = 'player-title';
    line.appendChild(el.stateChip);
    line.appendChild(document.createTextNode(' '));
    line.appendChild(el.title);
    now.appendChild(line);

    el.note = make('p', 'player__note t-caption');
    el.note.id = 'player-note';
    now.appendChild(el.note);
    strip.appendChild(now);

    /* --- position (R15a) ------------------------------------------- */
    el.seek = buildTrack('seek', '0:00', '0:00');
    strip.appendChild(el.seek.wrap);

    /* --- volume (R15a, same treatment) -----------------------------
       Same boxes, same rail, same rules. Only the lead is a word rather
       than a running time, so it is not set in tabular numerals. */
    el.volume = buildTrack('volume', 'Vol', '100%', 'player__meter-label t-label');
    strip.appendChild(el.volume.wrap);

    bar.appendChild(strip);
    el.strip = strip;

    /* R21. Polite, so it never interrupts; atomic, so partial strings are
       never read. Every state entry the player makes lands here. */
    el.live = make('p', 'sr-only');
    attrs(el.live, {
      id: 'player-live',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });
    bar.appendChild(el.live);

    el.bar = bar;
    return bar;
  }

  /* ------------------------------------------------------------------
     2. Publishing the bar's height (R21)
     ------------------------------------------------------------------
     css/base.css turns --player-h into body padding, scroll-padding and
     scroll-margin, and js/app.js's focusin rescue reads it too. Without a
     real number, a focused control at the bottom of the page parks itself
     behind the bar.

     ONLY THE STRIP COUNTS. The provider panel is absolutely positioned and
     overlays the page, so it must not be added here - if it were, opening a
     YouTube drawer would reflow the whole document mid-scroll.
     ------------------------------------------------------------------ */

  function publishHeight() {
    if (!el.bar) {
      return;
    }
    var height = Math.round(el.bar.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--player-h', height + 'px');
  }

  function watchHeight() {
    var scheduled = false;
    function schedule() {
      if (scheduled) {
        return;
      }
      scheduled = true;
      global.requestAnimationFrame(function () {
        scheduled = false;
        publishHeight();
      });
    }
    global.addEventListener('resize', schedule, { passive: true });
    global.addEventListener('orientationchange', schedule, { passive: true });
    if (typeof global.ResizeObserver !== 'undefined') {
      new global.ResizeObserver(schedule).observe(el.bar);
    }
    schedule();
  }

  /* ------------------------------------------------------------------
     3. Drawing a state
     ------------------------------------------------------------------ */

  var GLYPH = {
    Loading: '◌',   /* dotted circle: cueing */
    Ready: '▶',
    Playing: '▮▮',
    Paused: '▶',
    Blocked: '↻',
    NativeFallback: '↓',
    Ended: '▶▶',
    Unavailable: '↻'
  };

  /**
   * The event a press on the main transport button means, or null when
   * there is nothing legal to press - which is what disables it.
   *
   * NEXT is deliberately excluded: it has its own button, because it needs
   * to know WHICH mix comes next, and because the end of a mix must not
   * quietly turn the play button into something else under the visitor's
   * finger.
   */
  function primaryAction() {
    var list = machine.actions(context);
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== machine.EVENTS.NEXT) {
        return list[i];
      }
    }
    return null;
  }

  var BUTTON_TEXT = {
    PLAY: 'Play',
    PAUSE: 'Pause',
    RETRY: 'Retry'
  };

  function renderTransport() {
    var state = context.state;
    var action = primaryAction();
    var mix = context.mix;
    var name = titleOf(mix);

    el.bar.setAttribute('data-state', state);

    el.toggleGlyph.textContent = GLYPH[state] || GLYPH.Ready;
    el.toggleText.textContent = BUTTON_TEXT[action] || 'Play';

    /*
      Rule 2 at the top of this file. Disabled in Loading and in
      NativeFallback: in the first there is no widget to talk to, in the
      second our button is precisely the thing that does not work (R12a).
    */
    el.toggle.disabled = !action;
    el.toggle.setAttribute('aria-pressed', state === machine.STATES.PLAYING ? 'true' : 'false');
    el.toggle.setAttribute('data-action', action || '');
    el.toggle.setAttribute(
      'aria-label',
      action === machine.EVENTS.PAUSE ? 'Pause ' + name
        : action === machine.EVENTS.RETRY ? 'Try playing ' + name + ' again'
        : 'Play ' + name
    );

    /* R12a and the end of a mix are the only two places NEXT appears. */
    var wantsNext = machine.actions(context).indexOf(machine.EVENTS.NEXT) >= 0;
    el.next.hidden = !wantsNext;
    el.next.setAttribute('aria-label', 'Play the next mix');

    var copy = machine.copy(context);
    el.stateChip.textContent = copy.label;
    el.title.textContent = name;
    el.note.textContent = copy.note;

    /* R12a. The instruction sits in the provider's own panel, next to the
       button it is talking about, not down here on the strip. */
    var fallback = state === machine.STATES.NATIVE_FALLBACK;
    el.native.hidden = !fallback;
    if (fallback) {
      el.native.textContent = copy.note;
    }
    el.stage.setAttribute('data-fallback', fallback ? 'true' : 'false');
  }

  function renderSeek() {
    var seekable = !!(current && current.capabilities && current.capabilities.seek);
    var rail = el.seek.rail;
    var total = duration > 0 ? duration : 0;
    var ratio = total > 0 ? Math.min(1, Math.max(0, position / total)) : 0;

    el.seek.lead.textContent = formatTime(position);
    el.seek.trail.textContent = total > 0 ? formatTime(total) : '--:--';
    rail.style.setProperty('--fill', String(ratio));

    /*
      R15a. The nodes, the box and the fill are identical either way. Only
      the ARIA contract and the tab stop change, so the strip cannot reflow
      when a provider refuses to scrub mid-session.
    */
    rail.setAttribute('data-interactive', seekable ? 'true' : 'false');
    if (seekable && total > 0) {
      attrs(rail, {
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Seek within ' + titleOf(context.mix),
        'aria-valuemin': '0',
        'aria-valuemax': String(Math.round(total)),
        'aria-valuenow': String(Math.round(position)),
        'aria-valuetext': spokenTime(position) + ' of ' + spokenTime(total),
        'aria-hidden': null
      });
    } else {
      /* A read-out, not a control. The times either side of it carry the
         same information in text, so the bar itself is decorative here. */
      attrs(rail, {
        role: null,
        tabindex: null,
        'aria-label': null,
        'aria-valuemin': null,
        'aria-valuemax': null,
        'aria-valuenow': null,
        'aria-valuetext': null,
        'aria-hidden': 'true'
      });
    }
  }

  function renderVolume() {
    var adjustable = !!(current && current.capabilities && current.capabilities.volume);
    var rail = el.volume.rail;
    rail.style.setProperty('--fill', String(volume));
    el.volume.trail.textContent = adjustable ? Math.round(volume * 100) + '%' : 'n/a';
    rail.setAttribute('data-interactive', adjustable ? 'true' : 'false');

    if (adjustable) {
      attrs(rail, {
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Volume',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(volume * 100)),
        'aria-valuetext': Math.round(volume * 100) + ' percent',
        'aria-hidden': null
      });
      el.volume.wrap.removeAttribute('title');
    } else {
      attrs(rail, {
        role: null,
        tabindex: null,
        'aria-label': null,
        'aria-valuemin': null,
        'aria-valuemax': null,
        'aria-valuenow': null,
        'aria-valuetext': null,
        'aria-hidden': 'true'
      });
      el.volume.wrap.setAttribute('title', 'This provider sets its own volume.');
    }
  }

  function renderStage() {
    var mix = context.mix;
    el.stageLabel.textContent = providerLabel(mix);
    el.stage.setAttribute('data-provider', (mix && mix.provider) || '');

    /*
      KTD5, R13. YouTube gets a drawer showing a player of at least 200x200
      because YouTube's Developer Policies forbid, verbatim, playing from
      "a player that is not displayed in the page, tab, or screen that the
      user is viewing". SoundCloud and Mixcloud clip to a compact strip. The
      actual sizes are in css/player.css; this only names the shape.
    */
    el.stage.setAttribute('data-shape', mix && mix.provider === 'youtube' ? 'drawer' : 'strip');

    renderSource(current && current.attribution, mix);
  }

  /**
   * The credit line inside the panel (R5a, R14).
   *
   * SHOWN ONLY WHERE IT IS REQUIRED, which today means SoundCloud alone.
   * SoundCloud's API terms oblige us to credit the uploader, show its mark
   * and link back to the track, and that obligation arrives as data on the
   * adapter instance (`instance.attribution`, null for everyone else).
   *
   * Mixcloud, YouTube and self-hosted files carry no such requirement, and
   * the owner asked for the line gone: on a site that streams the crew's own
   * music in place, a credit reading "raboobi on Mixcloud" plus a link out is
   * pointing visitors away from the thing they are already listening to.
   *
   * So this is deliberately keyed on the obligation, not on the provider
   * name. Add a SoundCloud mix and the credit comes back by itself.
   */
  function renderSource(attribution, mix) {
    var node = el.attribution;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }

    if (!attribution) {
      node.hidden = true;
      return;
    }

    var url = attribution.sourceUrl ||
      (mix && typeof mix.url === 'string' ? mix.url : '');
    var credit = attribution.credit ||
      (mix && typeof mix.credit === 'string' ? mix.credit : '');

    if (!url && !credit) {
      node.hidden = true;
      return;
    }
    node.hidden = false;

    if (attribution && attribution.logo && attribution.logo.svg) {
      var mark = make('span', 'player__mark');
      attrs(mark, { 'aria-hidden': 'true' });
      /* The mark travels as inline SVG from js/provider-url.js, so
         attribution never depends on a file being present. */
      mark.innerHTML = attribution.logo.svg;
      node.appendChild(mark);
    }

    if (credit) {
      node.appendChild(make('span', 'player__credit', credit));
    }

    if (url) {
      var label = attribution && attribution.sourceLabel
        ? attribution.sourceLabel
        : 'Source on ' + providerLabel(mix);
      var link = make('a', 'player__source', label);
      attrs(link, {
        href: url,
        rel: 'noopener noreferrer',
        target: '_blank',
        'aria-label': label + ': ' + titleOf(mix)
      });
      node.appendChild(link);
    }
  }

  /**
   * The mix cards are the player's other transport. A card is not a link
   * out any more; it selects and plays in place, and only the mix the bar
   * is pointed at can be in the pressed state.
   */
  function renderCards() {
    if (!el.cards) {
      return;
    }
    var state = context.state;
    for (var i = 0; i < el.cards.length; i++) {
      var entry = el.cards[i];
      var active = entry.index === index;
      var playing = active && state === machine.STATES.PLAYING;
      var name = titleOf(mixes[entry.index]);

      entry.card.setAttribute('data-active', active ? 'true' : 'false');
      entry.button.setAttribute('aria-pressed', playing ? 'true' : 'false');
      entry.text.textContent = playing ? 'Pause' : 'Play';
      entry.glyph.textContent = playing ? '▮▮' : '▶';
      entry.button.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + name);

      /*
        Only the CUED card can be dead, and only while there is genuinely
        nothing to press: the widget has not answered yet, or the browser
        has refused twice and the visitor is being sent to the provider's
        own control. Every other card stays live, because selecting a
        different mix is always a legal move.
      */
      entry.button.disabled = active &&
        (state === machine.STATES.LOADING || state === machine.STATES.NATIVE_FALLBACK);
    }
  }

  function render() {
    renderTransport();
    renderSeek();
    renderVolume();
    renderStage();
    renderCards();
    updateMediaSession();
    publishHeight();

    /* The poller follows the state and nothing else, so there is exactly
       one place that can leave a timer running over a stopped mix. */
    if (context.state === machine.STATES.PLAYING) {
      startPolling();
    } else {
      stopPolling();
    }
  }

  function say(message) {
    if (!message || message === lastAnnounced) {
      return;
    }
    lastAnnounced = message;
    el.live.textContent = message;
  }

  /* ------------------------------------------------------------------
     4. The one way state changes
     ------------------------------------------------------------------ */

  /**
   * dispatch(event, payload)
   *
   * EFFECTS RUN BEFORE THE REDRAW, ON PURPOSE. A tap that means "play" has
   * to reach the provider inside the same task as the gesture; putting a
   * DOM pass in front of it would still be synchronous, but it is a habit
   * one refactor away from becoming an await. Effects first, paint after.
   */
  function dispatch(event, payload) {
    var outcome = machine.reduce(context, event, payload);
    if (outcome.rejected) {
      return outcome;
    }
    context = outcome.context;
    applyEffects(outcome.effects);
    render();
    say(outcome.announce);
    return outcome;
  }

  function applyEffects(effects) {
    for (var i = 0; i < effects.length; i++) {
      switch (effects[i]) {
        case 'play':
          /* THE SYNCHRONOUS CALL. Everything above this line in the tap
             handler is plain function calls; nothing has awaited. */
          if (current) {
            current.play();
          }
          break;
        case 'pause':
          if (current) {
            current.pause();
          }
          break;
        case 'stop':
          stopCurrent();
          break;
        case 'select':
          selectCurrentMix();
          break;
        case 'reload':
          reload();
          break;
        case 'revealNative':
          revealNative();
          break;
        default:
          break;
      }
    }
  }

  /* ------------------------------------------------------------------
     5. Talking to the adapter
     ------------------------------------------------------------------ */

  function detach() {
    for (var i = 0; i < offs.length; i++) {
      try {
        offs[i]();
      } catch (err) {
        /* already gone */
      }
    }
    offs = [];
  }

  function stopCurrent() {
    stopPolling();
    detach();
    if (current) {
      var going = current;
      current = null;
      try {
        /* Fire and forget: the machine has already moved on, and waiting
           here would put a promise in front of the next play(). */
        going.destroy();
      } catch (err) {
        warn('the previous mix could not be released.', err);
      }
    }
    position = 0;
    duration = 0;
  }

  function wire(instance) {
    offs.push(instance.on('ready', function () {
      dispatch(machine.EVENTS.READY);
    }));
    offs.push(instance.on('play', function () {
      dispatch(machine.EVENTS.PLAYING);
    }));
    offs.push(instance.on('pause', function () {
      dispatch(machine.EVENTS.PAUSED);
    }));
    offs.push(instance.on('finish', function () {
      dispatch(machine.EVENTS.FINISH);
    }));
    /* ONE event for every kind of failure (R12). Where it lands - Blocked,
       NativeFallback or Unavailable - is the state machine's decision. */
    offs.push(instance.on('blocked', function (detail) {
      dispatch(machine.EVENTS.BLOCKED, detail);
    }));
    offs.push(instance.on('progress', function (detail) {
      if (!seeking && detail && typeof detail.position === 'number') {
        position = detail.position;
        renderSeek();
      }
    }));
    offs.push(instance.on('capabilities', function () {
      renderSeek();
      renderVolume();
    }));
  }

  /** Builds the player for whatever mix the machine currently points at. */
  function selectCurrentMix() {
    var mix = context.mix;
    if (!mix) {
      return;
    }
    stopCurrent();
    try {
      current = LUVIZ.players.create(mix, el.mount);
    } catch (err) {
      /* An unsupported provider is a content mistake, not a runtime one.
         It is named on screen rather than swallowed. */
      current = null;
      warn('that mix could not be built.', err);
      context = machine.reduce(context, machine.EVENTS.FAILED, {
        providerLabel: providerLabel(mix),
        message: err && err.message
      }).context;
      return;
    }

    markCurrentFrame();
    wire(current);

    current.getDuration().then(function (value) {
      duration = value;
      renderSeek();
    });
  }

  /**
   * KTD5: every frame ever built stays in the render tree. The current one
   * is brought to the front; the others stay laid out behind it at zero
   * opacity. None of them is ever display: none.
   */
  function markCurrentFrame() {
    var frames = el.mount.children;
    for (var i = 0; i < frames.length; i++) {
      var isCurrent = current && frames[i] === current.element;
      frames[i].setAttribute('data-current', isCurrent ? 'true' : 'false');
    }
    if (!stageShown) {
      /* The panel is only hidden while it is genuinely empty. Once a
         provider frame lives in it, it is never hidden again (KTD5). */
      el.stage.hidden = false;
      stageShown = true;
    }
  }

  function reload() {
    /* A dead script load is cached inside the adapter, so a genuine retry
       has to drop the built players before asking again. */
    stopCurrent();
    if (LUVIZ.players && typeof LUVIZ.players.reset === 'function') {
      try {
        LUVIZ.players.reset();
      } catch (err) {
        warn('the players could not be reset.', err);
      }
    }
    stageShown = false;
    selectCurrentMix();
  }

  function revealNative() {
    /* The frame is already in the page and already visible; all that is
       needed is to point at it. css/player.css marks the panel. */
    el.stage.hidden = false;
    stageShown = true;
    el.native.hidden = false;
  }

  /* ------------------------------------------------------------------
     6. Position polling
     ------------------------------------------------------------------
     SoundCloud, Mixcloud and a local file emit progress; YouTube does not.
     A slow poll covers all four without any provider-specific branching in
     the view layer.
     ------------------------------------------------------------------ */

  function startPolling() {
    if (pollTimer !== null) {
      return;
    }
    pollTimer = global.setInterval(function () {
      if (!current || seeking) {
        return;
      }
      current.getPosition().then(function (value) {
        if (value > 0 || position === 0) {
          position = value;
        }
        if (duration <= 0) {
          current.getDuration().then(function (total) {
            duration = total;
            renderSeek();
          });
        } else {
          renderSeek();
        }
      });
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      global.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ------------------------------------------------------------------
     7. The controls
     ------------------------------------------------------------------ */

  function wireTransport() {
    /*
      R11. This handler contains no await, no setTimeout and no promise
      chain before the play() inside dispatch(). The widget was cued at
      boot and the button was disabled until it answered, so there is
      nothing left to wait for.
    */
    el.toggle.addEventListener('click', function () {
      var action = el.toggle.getAttribute('data-action');
      if (!action) {
        return;
      }
      dispatch(action);
    });

    el.next.addEventListener('click', function () {
      var nextIndex = mixes.length > 0 ? (index + 1) % mixes.length : 0;
      cue(nextIndex, machine.EVENTS.NEXT);
    });
  }

  /**
   * cue(i, event) - point the player at mix i.
   *
   * SELECT stops whatever is sounding before loading the next one; the
   * order is the state machine's, not this file's.
   */
  function cue(i, event) {
    if (!mixes[i]) {
      return null;
    }
    index = i;
    return dispatch(event || machine.EVENTS.SELECT, { mix: mixes[i] });
  }

  /* --- the mix cards become the second transport ------------------- */

  /**
   * A MIX CARD IS A PLAY TRIGGER, NOT A LINK OUT.
   *
   * js/sections.js ships each card with an anchor to the provider's own
   * page, because that is the honest thing to ship while no player exists.
   * Once this file has mounted, it is not: Mixcloud, SoundCloud and YouTube
   * all stream in place, so sending a visitor to another site to hear this
   * site's own music is a defect, not a feature. The link is not thrown
   * away - it moves into the provider panel as a discreet source credit,
   * which is also where SoundCloud's terms want it.
   *
   * sections.js belongs to another unit, so none of this is done by editing
   * it. The cards are claimed here, at run time, and the claim is marked
   * with data-cue="true" - which is what every rule in css/player.css hangs
   * off. WITH JAVASCRIPT OFF, OR OVER file://, THIS FUNCTION NEVER RUNS,
   * the anchor is never removed and the card degrades to the plain link it
   * shipped with. That fallback is the no-JS path, not the normal one.
   */
  function wireCards() {
    var cards = document.querySelectorAll('.mix-card[data-mix-index]');
    el.cards = [];
    for (var i = 0; i < cards.length; i++) {
      claimCard(cards[i]);
    }
  }

  function claimCard(card) {
    var cardIndex = Number(card.getAttribute('data-mix-index'));
    if (!isFinite(cardIndex) || !mixes[cardIndex] || card.getAttribute('data-cue') === 'true') {
      return;
    }
    var mix = mixes[cardIndex];

    var holder = make('p', 'mix-card__transport');
    var button = make('button', 'mix-card__cue');
    attrs(button, {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': 'Play ' + titleOf(mix)
    });
    var glyph = make('span', 'mix-card__cue-glyph', '▶');
    attrs(glyph, { 'aria-hidden': 'true' });
    var text = make('span', 'mix-card__cue-text t-label', 'Play');
    button.appendChild(glyph);
    button.appendChild(text);
    holder.appendChild(button);

    /*
      A REAL BUTTON, STRETCHED OVER THE CARD BY CSS. One tab stop, one
      accessible name, Enter and Space handled by the browser, and a focus
      ring drawn on the card. A <li> wearing role="button" and a hand-rolled
      key handler would get all four of those subtly wrong.
    */
    button.addEventListener('click', function () {
      /*
        R11, and on iOS this IS the first play. Everything from here to
        current.play() is plain synchronous function calls: the machine
        stops whatever was sounding, builds the next player, and plays -
        all inside this one task, with nothing awaited. If a browser
        refuses to carry the gesture across a freshly built frame, that
        refusal lands on R12's retry and then on R12a's native fallback,
        which is exactly what those two are for.
      */
      if (cardIndex === index && context.state === machine.STATES.PLAYING) {
        dispatch(machine.EVENTS.PAUSE);
        return;
      }
      if (cardIndex !== index) {
        cue(cardIndex);
      }
      dispatch(machine.EVENTS.PLAY);
    });

    card.appendChild(holder);

    /* Only now that the card really is a play trigger does the link out
       come off it. If anything above had thrown, the card would still have
       its working link. */
    var link = card.querySelector('.link-row');
    if (link && link.parentNode === card) {
      card.removeChild(link);
    }
    card.setAttribute('data-cue', 'true');

    el.cards.push({
      card: card,
      button: button,
      glyph: glyph,
      text: text,
      index: cardIndex
    });
  }

  /* --- dragging and arrowing the two rails ------------------------ */

  function ratioFromPointer(rail, clientX) {
    var box = rail.getBoundingClientRect();
    if (box.width <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  }

  function wireRail(rail, read) {
    function interactive() {
      return rail.getAttribute('data-interactive') === 'true';
    }

    rail.addEventListener('pointerdown', function (event) {
      if (!interactive()) {
        return;
      }
      seeking = true;
      rail.setPointerCapture(event.pointerId);
      read.commit(ratioFromPointer(rail, event.clientX), false);
      event.preventDefault();
    });

    rail.addEventListener('pointermove', function (event) {
      if (!seeking || !interactive()) {
        return;
      }
      read.commit(ratioFromPointer(rail, event.clientX), false);
    });

    function release(event) {
      if (!seeking) {
        return;
      }
      seeking = false;
      read.commit(ratioFromPointer(rail, event.clientX), true);
    }
    rail.addEventListener('pointerup', release);
    rail.addEventListener('pointercancel', function () {
      seeking = false;
    });

    rail.addEventListener('keydown', function (event) {
      if (!interactive()) {
        return;
      }
      var delta = 0;
      switch (event.key) {
        case 'ArrowRight': case 'ArrowUp': delta = 1; break;
        case 'ArrowLeft': case 'ArrowDown': delta = -1; break;
        case 'PageUp': delta = 6; break;
        case 'PageDown': delta = -6; break;
        case 'Home': read.commit(0, true); event.preventDefault(); return;
        case 'End': read.commit(1, true); event.preventDefault(); return;
        default: return;
      }
      read.nudge(delta);
      event.preventDefault();
    });
  }

  function wireMeters() {
    wireRail(el.seek.rail, {
      commit: function (ratio, final) {
        if (duration <= 0) {
          return;
        }
        position = ratio * duration;
        renderSeek();
        if (final && current) {
          current.seek(position);
        }
      },
      nudge: function (steps) {
        if (duration <= 0 || !current) {
          return;
        }
        var step = Math.abs(steps) > 1 ? STEP_LARGE : STEP_SMALL;
        position = Math.min(duration, Math.max(0, position + (steps > 0 ? step : -step)));
        renderSeek();
        current.seek(position);
      }
    });

    wireRail(el.volume.rail, {
      commit: function (ratio) {
        volume = ratio;
        renderVolume();
        if (current) {
          current.setVolume(volume);
        }
      },
      nudge: function (steps) {
        volume = Math.min(1, Math.max(0, volume + (steps > 0 ? 0.05 : -0.05) * Math.abs(steps)));
        renderVolume();
        if (current) {
          current.setVolume(volume);
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     8. Media Session
     ------------------------------------------------------------------
     What the phone's lock screen shows, and what its buttons do. The OS
     controls count as a user gesture, so play() from here is legitimate.
     ------------------------------------------------------------------ */

  function updateMediaSession() {
    var session = global.navigator && global.navigator.mediaSession;
    if (!session || typeof global.MediaMetadata !== 'function') {
      return;
    }
    var mix = context.mix;
    if (!mix) {
      return;
    }
    try {
      var artwork = [];
      if (typeof mix.artwork === 'string' && mix.artwork.length > 0) {
        artwork.push({ src: new global.URL(mix.artwork, global.location.href).href });
      }
      session.metadata = new global.MediaMetadata({
        title: titleOf(mix),
        artist: (typeof mix.credit === 'string' && mix.credit) || 'LUVIZMUSIC',
        album: 'LUVIZMUSIC',
        artwork: artwork
      });
      session.playbackState = context.state === machine.STATES.PLAYING ? 'playing'
        : context.state === machine.STATES.PAUSED ? 'paused' : 'none';
    } catch (err) {
      /* An older Media Session build. The site is unaffected. */
    }
  }

  function wireMediaSession() {
    var session = global.navigator && global.navigator.mediaSession;
    if (!session || typeof session.setActionHandler !== 'function') {
      return;
    }
    function handler(name, fn) {
      try {
        session.setActionHandler(name, fn);
      } catch (err) {
        /* This browser does not offer that button. */
      }
    }
    handler('play', function () { dispatch(machine.EVENTS.PLAY); });
    handler('pause', function () { dispatch(machine.EVENTS.PAUSE); });
    handler('nexttrack', function () {
      cue(mixes.length > 0 ? (index + 1) % mixes.length : 0);
    });
    handler('previoustrack', function () {
      cue(mixes.length > 0 ? (index - 1 + mixes.length) % mixes.length : 0);
    });
  }

  /* ------------------------------------------------------------------
     9. The file:// guard (R24)
     ------------------------------------------------------------------
     A double-clicked page has no real origin, so every provider handshake
     fails. A disabled button would read as a broken site; this says what
     to do instead.
     ------------------------------------------------------------------ */

  function renderFileNotice() {
    el.toggle.disabled = true;
    el.toggle.hidden = true;
    el.next.hidden = true;
    el.seek.wrap.hidden = true;
    el.volume.wrap.hidden = true;
    el.stage.hidden = true;

    el.bar.setAttribute('data-state', 'FileProtocol');
    el.stateChip.textContent = 'No playback';
    el.title.textContent = 'Opened straight off the disk';
    el.note.textContent =
      'Playback needs the local preview. Double-click PREVIEW-SITE.bat. ' +
      'Everything else on the page works exactly as it will online.';
    say('Playback needs the local preview. Double-click PREVIEW-SITE dot bat.');
  }

  /* ------------------------------------------------------------------
     10. Boot
     ------------------------------------------------------------------ */

  function init(list) {
    if (el.bar) {
      return;
    }
    machine = LUVIZ.playerState;
    if (!machine) {
      warn('js/player-state.js did not load, so the player cannot be drawn.');
      return;
    }

    mixes = Array.isArray(list) ? list.filter(function (mix) {
      return mix && typeof mix === 'object';
    }) : [];

    /* A DIRECT CHILD OF BODY. Anywhere else and a transformed ancestor
       turns position: fixed into position: absolute. */
    document.body.appendChild(buildBar());
    watchHeight();
    wireTransport();
    wireMeters();

    /* js/app.js only unhides the skip link when the bar is already in the
       markup, and this one is built here, so it is unhidden here. */
    var skip = document.getElementById('skip-to-player');
    if (skip) {
      skip.hidden = false;
    }

    context = machine.initial(mixes[0] || null);

    if (global.location && global.location.protocol === 'file:') {
      renderFileNotice();
      publishHeight();
      return;
    }

    if (mixes.length === 0) {
      context = machine.reduce(context, machine.EVENTS.FAILED, {
        providerLabel: 'mix'
      }).context;
      render();
      return;
    }

    wireCards();
    wireMediaSession();

    /*
      THE FRAME IS BUILT NOW, NOT ON THE FIRST TAP. This is the whole reason
      the first tap can be synchronous: by the time anybody presses play,
      the iframe exists, the script has loaded and the widget has said
      READY. Nothing is played here.
    */
    selectCurrentMix();
    render();
  }

  LUVIZ.playerBar = {
    init: init,

    /* A verification seam. Drives the bar through the state machine so the
       appearance of every state can be checked in a browser WITHOUT loading
       a provider or playing a note. Real playback is owner-verified. */
    _debug: {
      dispatch: function (event, payload) {
        return dispatch(event, payload);
      },
      state: function () {
        return context;
      },
      setTimes: function (pos, total) {
        position = pos;
        duration = total;
        renderSeek();
      },
      setCapabilities: function (caps) {
        if (current) {
          current.capabilities.seek = !!caps.seek;
          current.capabilities.volume = !!caps.volume;
        }
        renderSeek();
        renderVolume();
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
