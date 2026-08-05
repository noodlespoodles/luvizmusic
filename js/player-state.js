/* ==========================================================================
   LUVIZMUSIC - player-state.js
   --------------------------------------------------------------------------
   WHAT THE PLAYER IS DOING, AND WHAT THE VISITOR IS ALLOWED TO PRESS.

   That is the whole job of this file. It is a transition table and nothing
   else: data in, data out. It never touches the page, never sets a timer,
   never calls a provider (KTD15). Node has no `document` and the no-install
   rule bars jsdom, so this is the only half of the player that can be tested
   automatically - and it is deliberately the half that carries the rules
   that actually matter. See tests/playerstate.test.js.

   The DOM half lives in js/player-bar.js and is verified in a browser.

   THE EIGHT STATES, AND WHY EACH ONE EXISTS

     Loading         The provider's script and widget are on their way. The
                     transport is DISABLED here, on purpose (R11): the first
                     play() has to be callable synchronously inside the tap
                     handler, and a handler that has to wait for a widget is
                     a handler that has already lost the gesture on iOS.
     Ready           The widget answered. The transport is live.
     Playing         Sound is coming out, or has just been asked for.
     Paused          Stopped, position kept.
     Blocked         The browser refused (R12). ONE retry is offered.
     NativeFallback  The browser refused TWICE (R12a). The retry button is
                     withdrawn and the provider's own play control is shown
                     instead. This is not decoration: if a browser refuses to
                     carry the visitor's tap across the iframe boundary, then
                     retrying runs the identical code path and fails
                     identically forever. The way out is architectural.
     Ended           The mix finished. NEXT is offered and NOTHING starts on
                     its own - iOS wants a fresh gesture for the next one.
     Unavailable     The provider never loaded at all: blocked script, dead
                     CDN, timed-out handshake. A first-class state, so a
                     failed CDN never reads as a dead button.

   TWO RULES THAT ARE EASY TO GET WRONG

   1. A TAP IS A REQUEST; A PROVIDER EVENT IS A RESULT. PLAY is the visitor
      pressing the button. PLAYING is the widget confirming that sound is
      actually coming out. Only the second one clears the run of refusals,
      and only the second one announces "now playing". Clear the count on the
      request and the escalation in rule 2 can never be reached.

   2. A BLOCK MEANS DIFFERENT THINGS IN DIFFERENT PLACES. The adapter
      normalises every failure into one `blocked` event, so a dead CDN and a
      refused gesture arrive through the same door. A block while Loading is
      a provider that never came up: it goes to Unavailable and does NOT
      count toward the escalation. A block anywhere else is a refused
      gesture, and those are counted.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  var STATES = {
    LOADING: 'Loading',
    READY: 'Ready',
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    BLOCKED: 'Blocked',
    NATIVE_FALLBACK: 'NativeFallback',
    ENDED: 'Ended',
    UNAVAILABLE: 'Unavailable'
  };

  var EVENTS = {
    /* Things the visitor does. */
    PLAY: 'PLAY',
    PAUSE: 'PAUSE',
    RETRY: 'RETRY',
    SELECT: 'SELECT',
    NEXT: 'NEXT',
    /* Things the provider tells us. */
    READY: 'READY',
    FAILED: 'FAILED',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    BLOCKED: 'BLOCKED',
    FINISH: 'FINISH'
  };

  /** How many refusals in a row before the provider's own control is shown. */
  var ESCALATE_AFTER = 2;

  /** The states in which something could still be coming out of the speakers. */
  var SOUNDING = {};
  SOUNDING[STATES.PLAYING] = true;
  SOUNDING[STATES.PAUSED] = true;

  /*
    A marker rather than a state name. Where a BLOCKED event lands depends on
    how many have already happened, which a flat table cannot express, so the
    escalation rule below resolves it.
  */
  var ESCALATE = '@escalate';

  /* ------------------------------------------------------------------
     THE TABLE
     ------------------------------------------------------------------
     Read it as: from this state, this event goes there. An event that is
     not listed for a state is REJECTED - the state does not change, no
     effect is produced, and the result says why in plain English.
     ------------------------------------------------------------------ */

  var TABLE = {};

  TABLE[STATES.LOADING] = {
    READY: { to: STATES.READY },
    /* Rule 2 at the top of this file: a block here is a dead provider. */
    FAILED: { to: STATES.UNAVAILABLE },
    BLOCKED: { to: STATES.UNAVAILABLE },
    /* The provider's own control can be pressed before we are ready. */
    PLAYING: { to: STATES.PLAYING },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.UNAVAILABLE] = {
    RETRY: { to: STATES.LOADING, effects: ['reload'] },
    READY: { to: STATES.READY },
    PLAYING: { to: STATES.PLAYING },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.READY] = {
    PLAY: { to: STATES.PLAYING, effects: ['play'] },
    PLAYING: { to: STATES.PLAYING },
    PAUSED: { to: STATES.PAUSED },
    BLOCKED: { to: ESCALATE },
    FAILED: { to: STATES.UNAVAILABLE },
    FINISH: { to: STATES.ENDED },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.PLAYING] = {
    PAUSE: { to: STATES.PAUSED, effects: ['pause'] },
    PAUSED: { to: STATES.PAUSED },
    PLAYING: { to: STATES.PLAYING },
    BLOCKED: { to: ESCALATE },
    FINISH: { to: STATES.ENDED },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.PAUSED] = {
    PLAY: { to: STATES.PLAYING, effects: ['play'] },
    PLAYING: { to: STATES.PLAYING },
    BLOCKED: { to: ESCALATE },
    FINISH: { to: STATES.ENDED },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.BLOCKED] = {
    /* R12: one retry, and it runs exactly what the button ran. */
    RETRY: { to: STATES.PLAYING, effects: ['play'] },
    PLAY: { to: STATES.PLAYING, effects: ['play'] },
    PLAYING: { to: STATES.PLAYING },
    BLOCKED: { to: ESCALATE },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.NATIVE_FALLBACK] = {
    /* No RETRY here, by design (R12a). The visitor is pointed at the
       provider's own button instead; ours would fail the same way. */
    PLAYING: { to: STATES.PLAYING },
    PAUSED: { to: STATES.PAUSED },
    BLOCKED: { to: ESCALATE },
    FINISH: { to: STATES.ENDED },
    SELECT: { to: STATES.READY },
    NEXT: { to: STATES.READY }
  };

  TABLE[STATES.ENDED] = {
    NEXT: { to: STATES.READY, effects: ['select'] },
    SELECT: { to: STATES.READY },
    PLAYING: { to: STATES.PLAYING }
  };

  /* ------------------------------------------------------------------
     What the visitor may press, per state
     ------------------------------------------------------------------ */

  var ACTIONS = {};
  ACTIONS[STATES.LOADING] = [];
  ACTIONS[STATES.UNAVAILABLE] = [EVENTS.RETRY];
  ACTIONS[STATES.READY] = [EVENTS.PLAY];
  ACTIONS[STATES.PLAYING] = [EVENTS.PAUSE];
  ACTIONS[STATES.PAUSED] = [EVENTS.PLAY];
  ACTIONS[STATES.BLOCKED] = [EVENTS.RETRY];
  ACTIONS[STATES.NATIVE_FALLBACK] = [];
  ACTIONS[STATES.ENDED] = [EVENTS.NEXT];

  /* ------------------------------------------------------------------
     Small helpers. No DOM, no clock.
     ------------------------------------------------------------------ */

  function titleOf(context) {
    var mix = context && context.mix;
    var title = mix && typeof mix.title === 'string' ? mix.title.trim() : '';
    return title.length > 0 ? title : 'this mix';
  }

  function providerLabelOf(context) {
    var block = context && context.block;
    if (block && typeof block.providerLabel === 'string' && block.providerLabel.length > 0) {
      return block.providerLabel;
    }
    var mix = context && context.mix;
    var provider = mix && typeof mix.provider === 'string' ? mix.provider : '';
    if (provider.length === 0) {
      return 'the provider';
    }
    /* Capitalised rather than looked up in a table: this module must not
       carry a second copy of the provider names js/sections.js already owns. */
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  function copyOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push(list[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     The on-screen copy (R12, R21)
     ------------------------------------------------------------------
     Every state says something. A state with nothing to say is a state that
     looks, to the visitor, exactly like a broken button.
     ------------------------------------------------------------------ */

  function copy(context) {
    var state = context && context.state;
    var title = titleOf(context);
    var provider = providerLabelOf(context);

    switch (state) {
      case STATES.LOADING:
        return {
          label: 'Cueing',
          note: 'Loading the player. On a slow line this takes a moment; the ' +
            'controls come on by themselves.'
        };
      case STATES.UNAVAILABLE:
        return {
          label: 'No signal',
          note: 'The ' + provider + ' player never loaded. An ad blocker or a ' +
            'dropped connection will do this. Press retry.'
        };
      case STATES.READY:
        return { label: 'Cued', note: title + '. Press play.' };
      case STATES.PLAYING:
        return { label: 'Playing', note: title + '.' };
      case STATES.PAUSED:
        return { label: 'Paused', note: title + '. Press play to carry on.' };
      case STATES.BLOCKED:
        return {
          label: 'Refused',
          note: 'This browser would not start the mix. Press retry.'
        };
      case STATES.NATIVE_FALLBACK:
        return {
          label: 'Use their button',
          note: 'This browser will not let us start it for you. Press play ' +
            'once inside the ' + provider + ' panel above. After that these ' +
            'controls take over again.'
        };
      case STATES.ENDED:
        return {
          label: 'Finished',
          note: 'That is the end of ' + title + '. Press next for the one after it.'
        };
      default:
        return { label: 'Idle', note: 'Pick a mix.' };
    }
  }

  /* ------------------------------------------------------------------
     What gets said out loud (R21)
     ------------------------------------------------------------------
     A screen-reader user must never be left with silence and a button that
     did nothing. Note that the OPTIMISTIC tap says nothing: announcing "now
     playing" when the visitor pressed the button would be a lie for the
     whole time the provider takes to refuse.
     ------------------------------------------------------------------ */

  function announcementFor(from, to, event, context) {
    var title = titleOf(context);

    if (to === STATES.PLAYING) {
      return event === EVENTS.PLAYING ? 'Now playing: ' + title + '.' : '';
    }
    if (to === STATES.PAUSED) {
      return 'Paused.';
    }
    if (to === STATES.BLOCKED) {
      return 'Playback blocked. Retry is available.';
    }
    if (to === STATES.NATIVE_FALLBACK) {
      return 'Playback blocked twice. Press play inside the ' +
        providerLabelOf(context) + ' panel to start it.';
    }
    if (to === STATES.ENDED) {
      return 'Mix ended. Press next for the next mix.';
    }
    if (to === STATES.UNAVAILABLE) {
      return 'The player could not be loaded. Retry is available.';
    }
    if (to === STATES.LOADING) {
      return 'Loading the player again.';
    }
    if (to === STATES.READY && (event === EVENTS.SELECT || event === EVENTS.NEXT)) {
      return 'Cued: ' + title + '. Press play.';
    }
    return '';
  }

  /* ------------------------------------------------------------------
     Why an event was refused
     ------------------------------------------------------------------ */

  function rejectionReason(state, event) {
    if (event === EVENTS.PLAY || event === EVENTS.RETRY) {
      if (state === STATES.LOADING) {
        return 'The player is still loading, so there is nothing to play yet.';
      }
      if (state === STATES.PLAYING) {
        return 'That mix is already playing.';
      }
      if (state === STATES.NATIVE_FALLBACK) {
        return 'This browser refused twice. Press play inside the provider panel instead.';
      }
      if (state === STATES.ENDED) {
        return 'The mix has finished. Press next.';
      }
    }
    if (event === EVENTS.PAUSE) {
      return 'Nothing is playing, so there is nothing to pause.';
    }
    if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) {
      return 'The player does not know what "' + String(event) + '" means.';
    }
    return 'The player cannot do that while it is ' + String(state) + '.';
  }

  /* ------------------------------------------------------------------
     initial()
     ------------------------------------------------------------------ */

  /**
   * initial(mix) -> the context a freshly cued player starts in.
   *
   * Loading, not Ready: the widget has not answered yet and the transport
   * must stay disabled until it has.
   */
  function initial(mix) {
    return {
      state: STATES.LOADING,
      mix: mix || null,
      /* Refusals in a row. Cleared only by CONFIRMED playback. */
      blocks: 0,
      /* The last normalised blocked descriptor from js/players/adapter.js. */
      block: null
    };
  }

  /* ------------------------------------------------------------------
     reduce()
     ------------------------------------------------------------------ */

  function result(context, from, to, event, effects, announce) {
    return {
      state: to,
      previous: from,
      context: context,
      changed: true,
      rejected: false,
      reason: '',
      effects: effects,
      actions: copyOf(ACTIONS[to] || []),
      announce: announce
    };
  }

  function refusal(context, event) {
    return {
      state: context.state,
      previous: context.state,
      context: context,
      changed: false,
      rejected: true,
      reason: rejectionReason(context.state, event),
      effects: [],
      actions: copyOf(ACTIONS[context.state] || []),
      announce: ''
    };
  }

  /**
   * reduce(context, event, payload) -> result
   *
   *   result.state     where the player is now
   *   result.context   the NEW context; the one passed in is never touched
   *   result.changed   false when the event was refused
   *   result.rejected  true when the event was refused, with .reason set
   *   result.effects   what js/player-bar.js should now ask the adapter to
   *                    do, IN ORDER: 'play', 'pause', 'stop', 'select',
   *                    'reload', 'revealNative'
   *   result.actions   what the visitor may press from here
   *   result.announce  what the polite live region should say, or ''
   *
   * Never throws. An event the machine does not recognise is refused with a
   * reason, because a player that throws is a player that stops responding.
   */
  function reduce(context, event, payload) {
    var current = context || initial(null);
    var from = current.state;
    var row = TABLE[from];
    var rule = row && Object.prototype.hasOwnProperty.call(row, event) ? row[event] : null;

    if (!rule) {
      return refusal(current, event);
    }

    var info = payload || null;
    var next = {
      state: from,
      mix: current.mix,
      blocks: current.blocks,
      block: current.block
    };
    var effects = rule.effects ? copyOf(rule.effects) : [];
    var to = rule.to;

    /* --- the escalation rule (R12, R12a) --------------------------- */
    if (to === ESCALATE) {
      next.block = info;
      next.blocks = current.blocks + 1;
      if (next.blocks >= ESCALATE_AFTER) {
        to = STATES.NATIVE_FALLBACK;
        effects = ['revealNative'];
      } else {
        to = STATES.BLOCKED;
      }
    }

    /* --- a block that arrived while still loading ------------------- */
    if (to === STATES.UNAVAILABLE) {
      /*
        A provider that never came up has not refused anybody's gesture, so
        it must not push the visitor one step closer to the native fallback.
      */
      next.block = info;
    }

    /* --- picking a mix --------------------------------------------- */
    if (event === EVENTS.SELECT || event === EVENTS.NEXT) {
      if (info && info.mix) {
        next.mix = info.mix;
      }
      if (SOUNDING[from]) {
        /* Stop what is sounding BEFORE loading the next one, or two
           providers end up playing over each other. */
        effects = ['stop'].concat(effects.indexOf('select') >= 0 ? effects : ['select']);
      } else if (effects.indexOf('select') < 0) {
        effects = effects.concat(['select']);
      }
      /* A new mix is a new run of refusals only once it actually plays. */
      next.block = null;
    }

    /* --- confirmed playback clears the run of refusals -------------- */
    if (event === EVENTS.PLAYING) {
      next.blocks = 0;
      next.block = null;
    }

    /* --- a retry that put us back into Loading ---------------------- */
    if (to === STATES.LOADING) {
      next.block = null;
    }

    next.state = to;

    return result(next, from, to, event, effects, announcementFor(from, to, event, next));
  }

  /* ------------------------------------------------------------------ */

  function actions(context) {
    return copyOf(ACTIONS[(context && context.state)] || []);
  }

  function announce(res) {
    return res && typeof res.announce === 'string' ? res.announce : '';
  }

  LUVIZ.playerState = {
    STATES: STATES,
    EVENTS: EVENTS,
    ESCALATE_AFTER: ESCALATE_AFTER,
    /* Exported so a reader - or a test - can see the whole rule at once. */
    TABLE: TABLE,
    ACTIONS: ACTIONS,
    initial: initial,
    reduce: reduce,
    actions: actions,
    copy: copy,
    announce: announce
  };
})(typeof window !== 'undefined' ? window : globalThis);
