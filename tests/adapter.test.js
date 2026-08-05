'use strict';

/**
 * U5 player-adapter contract tests.
 *
 * ------------------------------------------------------------------------
 * HONEST LABEL - READ THIS BEFORE TRUSTING A GREEN RUN.
 *
 * These are CONTRACT-SHAPE tests over hand-written stubs of the SoundCloud,
 * YouTube and Mixcloud embed APIs, plus the pure URL module. They prove that
 * our four drivers present ONE interface, that three different calling
 * conventions (SoundCloud callbacks, Mixcloud promises, YouTube synchronous
 * getters) are normalised behind promises, and that every failure path lands
 * on a single `blocked` event.
 *
 * They CANNOT prove the real third-party widgets have the shape the stubs
 * claim. If SoundCloud renames `getPosition`, or Mixcloud drops `seek`, this
 * suite stays green while the player is broken. Closing that gap is the job
 * of the owner's live smoke check over PREVIEW-SITE.bat: load each
 * placeholder mix, press every control, and record the real shape and
 * capabilities per provider into the handover checklist.
 * ------------------------------------------------------------------------
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * No network, no DOM, no jsdom (KTD15). The "DOM" below is a handful of plain
 * objects; the provider globals are plain objects too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * The U5 files, in index.html order. namespace.js is deliberately NOT loaded:
 * each of these files has to stand up its own corner of window.LUVIZ, so a
 * load-order accident cannot silently disable the player.
 */
const SCRIPTS = [
  'js/provider-url.js',
  'js/players/soundcloud.js',
  'js/players/youtube.js',
  'js/players/mixcloud.js',
  'js/players/file.js',
  'js/players/adapter.js',
];

/** The full public interface every provider instance must satisfy. */
const INTERFACE = [
  'play',
  'pause',
  'seek',
  'getPosition',
  'getDuration',
  'setVolume',
  'on',
  'off',
  'destroy',
];

const MIXES = {
  soundcloud: {
    title: 'Night 014 - Ama Dwomoh (Peak)',
    provider: 'soundcloud',
    url: 'https://soundcloud.com/luvizmusic/night-014-ama-dwomoh-peak',
    credit: 'Uploaded by LUVIZMUSIC',
  },
  youtube: {
    title: 'Night 011 - Sister Freq (Closing)',
    provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=LUVIZplaceholder',
    credit: 'Filmed by Teodor Balan',
  },
  mixcloud: {
    title: 'Panorama - System Test, 3am',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/luvizmusic/panorama-system-test-3am/',
    credit: 'Uploaded by LUVIZMUSIC',
  },
  file: {
    title: 'Warm Room - Opening Hour',
    provider: 'file',
    url: 'media/mixes/warm-room-opening-hour.mp3',
    credit: 'Recorded live at The Annexe',
  },
};

const SECOND_SOUNDCLOUD_MIX = {
  title: 'Night 009 - Teo (First Hour)',
  provider: 'soundcloud',
  url: 'https://soundcloud.com/luvizmusic/night-009-teo-first-hour',
};

// ---------------------------------------------------------------------------
// Unhandled-rejection sentinel. A provider failure must surface as a `blocked`
// event, never as a promise nobody caught.
// ---------------------------------------------------------------------------

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason);
});

/** Let the microtask queue drain and two macrotask turns pass. */
function settle() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

async function assertNothingUncaught() {
  await settle();
  assert.deepEqual(
    unhandled.map((e) => (e && e.message) || String(e)),
    [],
    'a provider failure must not leave an uncaught promise rejection'
  );
}

// ---------------------------------------------------------------------------
// Loading the classic browser scripts under Node
// ---------------------------------------------------------------------------

function loadAdapter() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    try {
      delete require.cache[require.resolve(file)];
    } catch (err) {
      /* not previously required, or missing - the require below reports it */
    }
    require(file);
  }
  return globalThis.LUVIZ;
}

// ---------------------------------------------------------------------------
// A DOM made of plain objects
// ---------------------------------------------------------------------------

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    setAttribute(name, value) {
      el.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null;
    },
    removeAttribute(name) {
      delete el.attributes[name];
    },
    appendChild(child) {
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index >= 0) el.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, cb) {
      (el.listeners[type] || (el.listeners[type] = [])).push(cb);
    },
    removeEventListener(type, cb) {
      const list = el.listeners[type] || [];
      const index = list.indexOf(cb);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, payload) {
      (el.listeners[type] || []).slice().forEach((cb) => cb(payload || { type: type }));
    },
  };

  if (el.tagName === 'AUDIO') {
    el.currentTime = 0;
    el.duration = 2700;
    el.volume = 1;
    el.paused = true;
    el.playCalls = 0;
    el.loadCalls = 0;
    el.refusePlay = false;
    el.play = function () {
      el.playCalls += 1;
      if (el.refusePlay) {
        const err = new Error('play() failed because the visitor has not interacted with the page yet.');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      el.paused = false;
      el.dispatch('play');
      return Promise.resolve();
    };
    el.pause = function () {
      el.paused = true;
      el.dispatch('pause');
    };
    el.load = function () {
      el.loadCalls += 1;
    };
  }

  return el;
}

function makeDocument() {
  const doc = {
    created: [],
    createElement(tag) {
      const el = makeElement(tag);
      doc.created.push(el);
      return el;
    },
  };
  doc.head = makeElement('head');
  doc.body = makeElement('body');
  return doc;
}

// ---------------------------------------------------------------------------
// Stubs of the three embed APIs. Each mimics ONLY the documented surface.
// ---------------------------------------------------------------------------

/** SoundCloud: getters take a callback. */
function fakeSoundCloudApi(options) {
  const opts = options || {};
  const Events = {
    READY: 'ready',
    PLAY: 'play',
    PAUSE: 'pause',
    FINISH: 'finish',
    SEEK: 'seek',
    PLAY_PROGRESS: 'playProgress',
    ERROR: 'error',
  };

  function Widget(element) {
    if (Widget.instances.has(element)) return Widget.instances.get(element);
    const handlers = {};
    const widget = {
      element: element,
      calls: [],
      loaded: [],
      positionMs: 61000,
      durationMs: 3600000,
      bind(event, cb) {
        widget.calls.push(['bind', event]);
        (handlers[event] || (handlers[event] = [])).push(cb);
      },
      unbind(event) {
        widget.calls.push(['unbind', event]);
        delete handlers[event];
      },
      fire(event, payload) {
        (handlers[event] || []).slice().forEach((cb) => cb(payload));
      },
      play() {
        widget.calls.push(['play']);
        widget.fire(Events.PLAY);
      },
      pause() {
        widget.calls.push(['pause']);
        widget.fire(Events.PAUSE);
      },
      toggle() {
        widget.calls.push(['toggle']);
      },
      seekTo(ms) {
        widget.calls.push(['seekTo', ms]);
        widget.positionMs = ms;
        widget.fire(Events.SEEK);
      },
      setVolume(value) {
        widget.calls.push(['setVolume', value]);
      },
      getPosition(cb) {
        widget.calls.push(['getPosition']);
        cb(widget.positionMs);
      },
      getDuration(cb) {
        widget.calls.push(['getDuration']);
        cb(widget.durationMs);
      },
      isPaused(cb) {
        cb(true);
      },
      getCurrentSound(cb) {
        cb({ title: 'stub sound', user: { username: 'LUVIZMUSIC' } });
      },
      load(url, loadOptions) {
        widget.calls.push(['load', url]);
        widget.loaded.push(url);
        if (loadOptions && typeof loadOptions.callback === 'function') loadOptions.callback();
      },
    };
    Widget.instances.set(element, widget);
    // READY (or ERROR) arrives a turn later, after the caller has bound to it.
    Promise.resolve().then(() => {
      if (opts.errorBeforeReady) widget.fire(Events.ERROR, { message: 'stub soundcloud failure' });
      else widget.fire(Events.READY);
    });
    return widget;
  }

  Widget.instances = new Map();
  Widget.Events = Events;
  return { Widget: Widget };
}

/** YouTube: getters are synchronous. */
function fakeYouTubeApi(options) {
  const opts = options || {};
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

  function Player(element, config) {
    const events = (config && config.events) || {};
    const player = {
      element: element,
      config: config,
      calls: [],
      cued: [],
      currentTime: 42,
      duration: 3000,
      state: PlayerState.CUED,
      playVideo() {
        player.calls.push(['playVideo']);
        player.state = PlayerState.PLAYING;
        if (events.onStateChange) events.onStateChange({ data: PlayerState.PLAYING, target: player });
      },
      pauseVideo() {
        player.calls.push(['pauseVideo']);
        player.state = PlayerState.PAUSED;
        if (events.onStateChange) events.onStateChange({ data: PlayerState.PAUSED, target: player });
      },
      seekTo(seconds, allowSeekAhead) {
        player.calls.push(['seekTo', seconds, allowSeekAhead]);
        player.currentTime = seconds;
      },
      setVolume(value) {
        player.calls.push(['setVolume', value]);
      },
      getCurrentTime() {
        return player.currentTime;
      },
      getDuration() {
        return player.duration;
      },
      getPlayerState() {
        return player.state;
      },
      cueVideoById(id) {
        player.calls.push(['cueVideoById', id]);
        player.cued.push(id);
      },
      loadVideoById(id) {
        player.calls.push(['loadVideoById', id]);
        player.cued.push(id);
      },
      destroy() {
        player.calls.push(['destroy']);
      },
      finish() {
        player.state = PlayerState.ENDED;
        if (events.onStateChange) events.onStateChange({ data: PlayerState.ENDED, target: player });
      },
    };
    Player.instances.push(player);
    Promise.resolve().then(() => {
      if (opts.errorBeforeReady) {
        if (events.onError) events.onError({ data: 150, target: player });
        return;
      }
      if (events.onReady) events.onReady({ target: player });
      if (opts.blockAutoplay && events.onAutoplayBlocked) events.onAutoplayBlocked({ target: player });
    });
    return player;
  }

  Player.instances = [];
  return { Player: Player, PlayerState: PlayerState };
}

/** Mixcloud: getters return promises, and seek can refuse. */
function fakeMixcloudApi(options) {
  const opts = options || {};

  function makeEvent() {
    const listeners = [];
    return {
      on(cb) {
        listeners.push(cb);
      },
      off(cb) {
        const index = listeners.indexOf(cb);
        if (index >= 0) listeners.splice(index, 1);
      },
      fire(payload) {
        listeners.slice().forEach((cb) => cb(payload));
      },
    };
  }

  function PlayerWidget(element) {
    const widget = {
      element: element,
      calls: [],
      loaded: [],
      position: 12,
      duration: 5400,
      ready: Promise.resolve(),
      play() {
        widget.calls.push(['play']);
        widget.events.play.fire();
        return Promise.resolve();
      },
      pause() {
        widget.calls.push(['pause']);
        widget.events.pause.fire();
        return Promise.resolve();
      },
      togglePlay() {
        widget.calls.push(['togglePlay']);
        return Promise.resolve();
      },
      seek(seconds) {
        widget.calls.push(['seek', seconds]);
        if (opts.refuseSeek) return Promise.resolve(false);
        widget.position = seconds;
        return Promise.resolve(true);
      },
      getPosition() {
        return Promise.resolve(widget.position);
      },
      getDuration() {
        return Promise.resolve(widget.duration);
      },
      getIsPaused() {
        return Promise.resolve(true);
      },
      load(key, startPlaying) {
        widget.calls.push(['load', key, startPlaying]);
        widget.loaded.push(key);
        return Promise.resolve();
      },
      events: {
        play: makeEvent(),
        pause: makeEvent(),
        ended: makeEvent(),
        progress: makeEvent(),
        buffering: makeEvent(),
        error: makeEvent(),
      },
    };
    if (opts.withVolume) {
      widget.setVolume = function (value) {
        widget.calls.push(['setVolume', value]);
        return Promise.resolve(true);
      };
    }
    PlayerWidget.instances.push(widget);
    return widget;
  }

  PlayerWidget.instances = [];
  return { PlayerWidget: PlayerWidget };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

function harness(config) {
  const cfg = config || {};
  const LUVIZ = loadAdapter();
  const apis = {
    SC: fakeSoundCloudApi(cfg.soundcloud),
    YT: fakeYouTubeApi(cfg.youtube),
    Mixcloud: fakeMixcloudApi(cfg.mixcloud),
  };
  const doc = makeDocument();
  const win = {
    document: doc,
    location: Object.assign(
      { protocol: 'https:', origin: 'https://luvizmusic.example', href: 'https://luvizmusic.example/' },
      cfg.location || {}
    ),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  if (!cfg.withoutSoundCloudGlobal) win.SC = apis.SC;
  if (!cfg.withoutMixcloudGlobal) win.Mixcloud = apis.Mixcloud;
  // YT is deliberately NOT pre-installed: the loader path must install it.

  const loadScript = function (src) {
    loadScript.loaded.push(src);
    if (cfg.scriptFails) {
      const err = new Error('The browser refused to load ' + src);
      err.reason = 'script';
      return Promise.reject(err);
    }
    if (/youtube\.com\/iframe_api/.test(src) && !cfg.withoutYouTubeGlobal) {
      win.YT = apis.YT;
      if (typeof win.onYouTubeIframeAPIReady === 'function') win.onYouTubeIframeAPIReady();
    }
    return Promise.resolve();
  };
  loadScript.loaded = [];

  const mount = makeElement('div');

  return {
    LUVIZ: LUVIZ,
    win: win,
    doc: doc,
    apis: apis,
    mount: mount,
    loadScript: loadScript,
    create(mix, extra) {
      return LUVIZ.players.create(
        mix,
        mount,
        Object.assign({ win: win, doc: doc, loadScript: loadScript, readyTimeoutMs: 800 }, extra || {})
      );
    },
  };
}

function collect(instance, event) {
  const seen = [];
  instance.on(event, (payload) => seen.push(payload));
  return seen;
}

// ===========================================================================
// The interface, over all four providers
// ===========================================================================

test('every provider factory returns an object satisfying the full interface', async () => {
  for (const provider of ['soundcloud', 'youtube', 'mixcloud', 'file']) {
    const h = harness();
    const instance = h.create(MIXES[provider]);

    assert.equal(instance.provider, provider, provider + ': instance must name its provider');
    for (const method of INTERFACE) {
      assert.equal(
        typeof instance[method],
        'function',
        provider + ': ' + method + '() is missing from the interface'
      );
    }
    assert.ok(instance.ready && typeof instance.ready.then === 'function', provider + ': ready must be a promise');
    assert.ok(instance.capabilities && typeof instance.capabilities === 'object', provider + ': capabilities missing');
    assert.equal(typeof instance.capabilities.seek, 'boolean', provider + ': capabilities.seek must be a boolean');
    assert.equal(typeof instance.capabilities.volume, 'boolean', provider + ': capabilities.volume must be a boolean');

    const started = await instance.ready;
    assert.equal(started, true, provider + ': ready must resolve true against a healthy stub');

    // Every getter answers with a promise of a number, whatever the underlying
    // calling convention was.
    const position = await instance.getPosition();
    const duration = await instance.getDuration();
    assert.equal(typeof position, 'number', provider + ': getPosition must resolve a number');
    assert.equal(typeof duration, 'number', provider + ': getDuration must resolve a number');
    assert.ok(duration > 0, provider + ': the stub duration should come through');

    assert.equal(await instance.play(), true, provider + ': play() must resolve true when it started');
    assert.equal(await instance.pause(), true, provider + ': pause() must resolve true');
  }
  await assertNothingUncaught();
});

test('on() names the normalised event set when given an unknown event', () => {
  const h = harness();
  const instance = h.create(MIXES.file);
  assert.throws(
    () => instance.on('ended', () => {}),
    (err) => /ended/.test(err.message) && /finish/.test(err.message) && /blocked/.test(err.message),
    'an unknown event name must fail loudly and list the valid names'
  );
  assert.ok(Array.isArray(h.LUVIZ.players.EVENTS));
  for (const name of ['ready', 'play', 'pause', 'finish', 'progress', 'seek', 'capabilities', 'blocked']) {
    assert.ok(h.LUVIZ.players.EVENTS.includes(name), name + ' must be part of the normalised event set');
  }
});

test('normalised play/pause/finish events fire the same way on every provider', async () => {
  // SoundCloud (callback events), YouTube (state codes) and Mixcloud (event
  // objects) all have to reach the same listeners.
  const sc = harness();
  const scInstance = sc.create(MIXES.soundcloud);
  const scPlays = collect(scInstance, 'play');
  await scInstance.ready;
  await scInstance.play();
  assert.equal(scPlays.length, 1, 'SoundCloud PLAY must arrive as a normalised play event');

  const yt = harness();
  const ytInstance = yt.create(MIXES.youtube);
  const ytPlays = collect(ytInstance, 'play');
  const ytFinishes = collect(ytInstance, 'finish');
  await ytInstance.ready;
  await ytInstance.play();
  assert.equal(ytPlays.length, 1, 'YouTube state 1 must arrive as a normalised play event');
  yt.apis.YT.Player.instances[0].finish();
  assert.equal(ytFinishes.length, 1, 'YouTube state 0 must arrive as a normalised finish event');

  const mc = harness();
  const mcInstance = mc.create(MIXES.mixcloud);
  const mcPlays = collect(mcInstance, 'play');
  await mcInstance.ready;
  await mcInstance.play();
  assert.equal(mcPlays.length, 1, 'Mixcloud events.play must arrive as a normalised play event');

  await assertNothingUncaught();
});

// ===========================================================================
// Capabilities (KTD4)
// ===========================================================================

test('the file provider declares both seek and volume true', async () => {
  const h = harness();
  const instance = h.create(MIXES.file);
  await instance.ready;
  assert.equal(instance.capabilities.seek, true, 'a same-origin audio element can always seek');
  assert.equal(instance.capabilities.volume, true, 'a same-origin audio element can always set volume');
  assert.equal(await instance.seek(90), true);
  assert.equal(instance.element.currentTime, 90, 'seek must reach the audio element');
  assert.equal(await instance.setVolume(0.5), true);
  assert.equal(instance.element.volume, 0.5, 'setVolume must reach the audio element');
  await assertNothingUncaught();
});

test('capability probing returns the stated default when nothing can be probed', () => {
  const h = harness();
  const resolve = h.LUVIZ.players.resolveCapabilities;

  const stated = { seek: true, volume: false };
  const fallback = resolve(stated, null);
  assert.equal(fallback.seek, true, 'the stated default must survive when no probe surface exists');
  assert.equal(fallback.volume, false);
  assert.equal(fallback.probed, false, 'an unprobed capability set must say so');
  assert.equal(fallback.source, 'default');

  const probed = resolve(stated, { volume: true });
  assert.equal(probed.volume, true, 'a probe that finds a volume setter must override the default');
  assert.equal(probed.seek, true, 'a probe that says nothing about seek must leave the default alone');
  assert.equal(probed.probed, true);
  assert.equal(probed.source, 'probe');

  // Every driver has to state its default rather than leave it undefined.
  for (const provider of ['soundcloud', 'youtube', 'mixcloud', 'file']) {
    const driver = h.LUVIZ.players.drivers[provider];
    assert.ok(driver.defaults, provider + ' must state default capabilities');
    assert.equal(typeof driver.defaults.seek, 'boolean', provider + ' must state a default for seek');
    assert.equal(typeof driver.defaults.volume, 'boolean', provider + ' must state a default for volume');
  }
});

test('mixcloud defaults to no volume, and a runtime probe is what flips it', async () => {
  const without = harness();
  const quiet = without.create(MIXES.mixcloud);
  await quiet.ready;
  assert.equal(quiet.capabilities.volume, false, 'Mixcloud documents no volume setter: default false');
  assert.equal(await quiet.setVolume(0.4), false, 'setVolume must degrade, not throw, when unsupported');

  const withVolume = harness({ mixcloud: { withVolume: true } });
  const loud = withVolume.create(MIXES.mixcloud);
  await loud.ready;
  assert.equal(loud.capabilities.volume, true, 'a runtime probe that finds setVolume must upgrade the flag');
  assert.equal(loud.capabilities.probed, true);
  assert.equal(await loud.setVolume(0.4), true);

  await assertNothingUncaught();
});

test('a seek refusal resolves false rather than rejecting, and degrades the flag', async () => {
  const h = harness({ mixcloud: { refuseSeek: true } });
  const instance = h.create(MIXES.mixcloud);
  const capabilityEvents = collect(instance, 'capabilities');
  const blocks = collect(instance, 'blocked');
  await instance.ready;
  assert.equal(instance.capabilities.seek, true, 'Mixcloud seek is assumed available until it refuses');

  const accepted = await instance.seek(300);
  assert.equal(accepted, false, 'a licensing refusal must resolve false, never reject');
  assert.equal(instance.capabilities.seek, false, 'a refusal must degrade the seek capability');
  assert.ok(capabilityEvents.length >= 1, 'a degraded capability must be announced');
  assert.deepEqual(blocks, [], 'a refusal is not a failure and must not raise blocked');

  await assertNothingUncaught();
});

// ===========================================================================
// Failure paths -> one normalised `blocked` event (R12)
// ===========================================================================

test('a provider error surfaces as a normalised blocked event, not an uncaught throw', async () => {
  const h = harness({ soundcloud: { errorBeforeReady: true } });
  const instance = h.create(MIXES.soundcloud);
  const blocks = collect(instance, 'blocked');

  const started = await instance.ready;
  assert.equal(started, false, 'a failed widget must resolve ready false, not reject');
  assert.ok(blocks.length >= 1, 'the failure must raise a normalised blocked event');

  const event = blocks[0];
  assert.equal(event.provider, 'soundcloud', 'blocked must name the provider');
  assert.equal(typeof event.reason, 'string', 'blocked must carry a machine-readable reason');
  assert.equal(typeof event.message, 'string', 'blocked must carry a sentence a visitor can read');
  assert.ok(event.message.length > 0);
  assert.ok(!/undefined|\[object Object\]/.test(event.message), 'the message must read as English');
  assert.equal(event.retryable, true, 'R12: the player bar needs to know it may offer a retry');
  assert.equal(event.mix && event.mix.title, MIXES.soundcloud.title);

  // Every method still answers, with a degraded value, rather than throwing.
  assert.equal(await instance.play(), false);
  assert.equal(await instance.pause(), false);
  assert.equal(await instance.seek(10), false);
  assert.equal(await instance.getPosition(), 0);
  assert.equal(await instance.getDuration(), 0);

  await assertNothingUncaught();
});

test('a third-party script that never loads raises blocked with a script reason', async () => {
  const h = harness({ scriptFails: true });
  const instance = h.create(MIXES.mixcloud);
  const blocks = collect(instance, 'blocked');
  assert.equal(await instance.ready, false);
  assert.ok(blocks.length >= 1);
  assert.equal(blocks[0].reason, 'script');
  assert.match(blocks[0].message, /mixcloud/i, 'the message must name the provider that failed');
  await assertNothingUncaught();
});

test('a blocked autoplay on the file provider raises blocked with an autoplay reason', async () => {
  const h = harness();
  const instance = h.create(MIXES.file);
  const blocks = collect(instance, 'blocked');
  await instance.ready;
  instance.element.refusePlay = true;

  const started = await instance.play();
  assert.equal(started, false, 'a refused play must resolve false, not reject');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].reason, 'autoplay');
  assert.equal(blocks[0].retryable, true);
  await assertNothingUncaught();
});

test('YouTube autoplay refusal reaches the same blocked event', async () => {
  const h = harness({ youtube: { blockAutoplay: true } });
  const instance = h.create(MIXES.youtube);
  const blocks = collect(instance, 'blocked');
  await instance.ready;
  await settle();
  assert.ok(blocks.length >= 1, 'onAutoplayBlocked must be wired to the blocked path');
  assert.equal(blocks[0].reason, 'autoplay');
  assert.equal(blocks[0].provider, 'youtube');
  await assertNothingUncaught();
});

test('requesting an unsupported provider raises a clear error naming the provider', () => {
  const h = harness();
  assert.throws(
    () => h.create({ title: 'Elsewhere', provider: 'spotify', url: 'https://open.spotify.com/x' }),
    (err) => {
      assert.match(err.message, /spotify/, 'the error must name the provider that was asked for');
      assert.match(err.message, /soundcloud/, 'the error must list what is supported');
      assert.match(err.message, /mixcloud/);
      assert.ok(!/\[object Object\]/.test(err.message));
      return true;
    }
  );
  assert.throws(
    () => h.create({ title: 'Nothing', url: 'https://example.com/x' }),
    /provider/i,
    'a mix with no provider at all must fail just as clearly'
  );
  assert.equal(h.LUVIZ.players.has('spotify'), false);
  assert.deepEqual(h.LUVIZ.players.providers().slice().sort(), ['file', 'mixcloud', 'soundcloud', 'youtube']);
});

// ===========================================================================
// The pure URL module (KTD15)
// ===========================================================================

test('provider-url is pure: it builds every embed URL with no DOM at all', () => {
  const h = harness();
  assert.equal(typeof h.LUVIZ.providerUrl.embedUrlFor, 'function');
  const source = fs.readFileSync(path.join(ROOT, 'js', 'provider-url.js'), 'utf8');
  assert.ok(!/\bdocument\b/.test(source), 'provider-url.js must not touch document');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(source), 'provider-url.js must not fetch anything');
  assert.ok(!/^\s*(import|export)\b/m.test(source), 'provider-url.js must be a classic script (KTD1)');
});

test('YouTube URLs carry enablejsapi=1 and playsinline=1 on every protocol', () => {
  const h = harness();
  const url = h.LUVIZ.providerUrl;
  for (const protocol of ['https:', 'http:', 'file:']) {
    const built = url.youTubeEmbedUrl(MIXES.youtube, { protocol: protocol, origin: 'https://luvizmusic.example' });
    assert.match(built, /[?&]enablejsapi=1(&|$)/, protocol + ': enablejsapi=1 is required by the iframe API');
    assert.match(built, /[?&]playsinline=1(&|$)/, protocol + ': playsinline=1 is required on iOS');
    assert.match(built, /^https:\/\/www\.youtube\.com\/embed\/LUVIZplaceholder\?/, protocol + ': wrong embed base');
  }
});

test('YouTube URLs carry origin over http(s) and omit it under file:', () => {
  const h = harness();
  const url = h.LUVIZ.providerUrl;

  for (const protocol of ['https:', 'http:']) {
    const built = url.youTubeEmbedUrl(MIXES.youtube, {
      protocol: protocol,
      origin: 'https://luvizmusic.example',
    });
    assert.match(built, /[?&]origin=https%3A%2F%2Fluvizmusic\.example(&|$)/, protocol + ': origin must be sent');
  }

  // Under file:// the origin serialises to "null" or "file://" and the API
  // handshake accepts neither, which kills the double-click preview.
  for (const origin of ['null', 'file://', '', undefined]) {
    const built = url.youTubeEmbedUrl(MIXES.youtube, { protocol: 'file:', origin: origin });
    assert.ok(!/[?&]origin=/.test(built), 'origin=' + String(origin) + ' must be omitted under file:');
  }
  assert.equal(url.wantsOrigin('file:'), false);
  assert.equal(url.wantsOrigin('https:'), true);
  assert.equal(url.wantsOrigin('http:'), true);
});

test('the built iframe src matches what the pure module produced', async () => {
  const h = harness({ location: { protocol: 'file:', origin: 'null', href: 'file:///C:/site/index.html' } });
  const instance = h.create(MIXES.youtube);
  await instance.ready;
  const src = instance.element.getAttribute('src');
  assert.match(src, /enablejsapi=1/);
  assert.match(src, /playsinline=1/);
  assert.ok(!/origin=/.test(src), 'the file:// preview must not send an origin');
  await assertNothingUncaught();
});

test('SoundCloud embeds load with auto_play=false and Mixcloud embeds carry a feed', () => {
  const h = harness();
  const url = h.LUVIZ.providerUrl;

  const sc = url.soundcloudEmbedUrl(MIXES.soundcloud);
  assert.match(sc, /^https:\/\/w\.soundcloud\.com\/player\/\?/);
  assert.match(sc, /[?&]auto_play=false(&|$)/, 'nothing may start playing before the visitor asks');
  assert.match(sc, /[?&]url=https%3A%2F%2Fsoundcloud\.com%2F/);

  const mc = url.mixcloudEmbedUrl(MIXES.mixcloud);
  assert.match(mc, /^https:\/\/player-widget\.mixcloud\.com\/widget\/iframe\/\?/);
  assert.match(mc, /[?&]feed=%2Fluvizmusic%2Fpanorama-system-test-3am%2F(&|$)/);

  assert.equal(url.fileSourceUrl(MIXES.file), 'media/mixes/warm-room-opening-hour.mp3');
  assert.equal(url.embedUrlFor(MIXES.file, { protocol: 'file:' }), 'media/mixes/warm-room-opening-hour.mp3');
  assert.throws(() => url.embedUrlFor({ provider: 'bandcamp', url: 'https://x' }, {}), /bandcamp/);
});

// ===========================================================================
// SoundCloud attribution (R14)
// ===========================================================================

test('a SoundCloud mix produces an attribution descriptor; another provider does not', async () => {
  const h = harness();
  const url = h.LUVIZ.providerUrl;

  const attribution = url.attributionFor(MIXES.soundcloud);
  assert.ok(attribution, 'a SoundCloud mix must carry attribution - it is a Terms of Use obligation');
  assert.equal(attribution.provider, 'soundcloud');
  assert.equal(attribution.required, true);
  assert.equal(attribution.credit, 'Uploaded by LUVIZMUSIC', 'the uploader credit must be carried through');
  assert.equal(attribution.sourceUrl, MIXES.soundcloud.url, 'a link back to the source URL is required');
  assert.ok(attribution.logo, 'the SoundCloud logo is required');
  assert.equal(typeof attribution.logo.alt, 'string');
  assert.match(attribution.logo.alt, /soundcloud/i);
  assert.ok(
    typeof attribution.logo.svg === 'string' && /<svg/.test(attribution.logo.svg),
    'the logo must render with no network request'
  );

  // A SoundCloud mix with no credit still gets an honest fallback, never blank.
  const uncredited = url.attributionFor({ provider: 'soundcloud', url: 'https://soundcloud.com/x/y' });
  assert.ok(uncredited.credit && uncredited.credit.trim().length > 0);

  for (const provider of ['youtube', 'mixcloud', 'file']) {
    assert.equal(url.attributionFor(MIXES[provider]), null, provider + ' must not carry SoundCloud attribution');
  }

  // The live instance exposes the same descriptor, so U6 has one thing to read.
  const scInstance = h.create(MIXES.soundcloud);
  await scInstance.ready;
  assert.deepEqual(scInstance.attribution, attribution);

  const other = harness();
  const fileInstance = other.create(MIXES.file);
  await fileInstance.ready;
  assert.equal(fileInstance.attribution, null);

  await assertNothingUncaught();
});

// ===========================================================================
// Lazy creation, reuse, and the autoplay allowance
// ===========================================================================

test('no provider frame is created at boot: the first selection creates it', async () => {
  const h = harness();
  assert.deepEqual(h.doc.created, [], 'loading the drivers must not create a single element');
  assert.deepEqual(h.loadScript.loaded, [], 'loading the drivers must not fetch a single third-party script');
  assert.deepEqual(h.mount.children, []);

  const instance = h.create(MIXES.soundcloud);
  await instance.ready;
  assert.equal(h.doc.created.length, 1, 'exactly one element for the selected provider');
  assert.equal(h.mount.children.length, 1, 'and it is mounted where it was asked to go');
  assert.deepEqual(h.loadScript.loaded, ['https://w.soundcloud.com/player/api.js']);
  assert.ok(!h.loadScript.loaded.some((s) => /youtube|mixcloud/.test(s)), 'unused providers must stay unloaded');
  await assertNothingUncaught();
});

test('every provider iframe carries allow="autoplay"', async () => {
  for (const provider of ['soundcloud', 'youtube', 'mixcloud']) {
    const h = harness();
    const instance = h.create(MIXES[provider]);
    await instance.ready;
    assert.equal(instance.element.tagName, 'IFRAME', provider + ' is an embed provider');
    const allow = instance.element.getAttribute('allow');
    assert.ok(
      allow && allow.split(';').some((part) => part.trim() === 'autoplay'),
      provider + ' iframe needs allow="autoplay"'
    );
  }
  const h = harness();
  const fileInstance = h.create(MIXES.file);
  await fileInstance.ready;
  assert.equal(fileInstance.element.tagName, 'AUDIO', 'the file provider escapes the iframe entirely');
  await assertNothingUncaught();
});

test('a second mix on the same provider reuses the frame and never swaps src', async () => {
  const h = harness();
  const first = h.create(MIXES.soundcloud);
  await first.ready;
  const frame = first.element;
  const srcAfterFirst = frame.getAttribute('src');

  const second = h.create(SECOND_SOUNDCLOUD_MIX);
  await second.ready;

  assert.equal(second.element, frame, 'the provider frame must be created once and reused');
  assert.equal(h.doc.created.length, 1, 'no second element may be created');
  assert.equal(frame.getAttribute('src'), srcAfterFirst, 'the src must never be swapped to change track');
  assert.equal(h.loadScript.loaded.length, 1, 'the provider script must be fetched once');

  const widget = h.apis.SC.Widget.instances.get(frame);
  assert.deepEqual(widget.loaded, [SECOND_SOUNDCLOUD_MIX.url], 'the track change must go through widget.load()');

  // Events now belong to the current selection.
  const firstPlays = collect(first, 'play');
  const secondPlays = collect(second, 'play');
  await second.play();
  assert.equal(secondPlays.length, 1);
  assert.equal(firstPlays.length, 0, 'a superseded instance must stop receiving provider events');

  await assertNothingUncaught();
});

test('SoundCloud binds READY before it calls anything on the widget', async () => {
  const h = harness();
  const instance = h.create(MIXES.soundcloud);
  await instance.ready;
  const widget = h.apis.SC.Widget.instances.get(instance.element);
  assert.equal(widget.calls[0][0], 'bind', 'the very first thing done to the widget must be a bind');
  assert.equal(widget.calls[0][1], h.apis.SC.Widget.Events.READY, 'and it must be READY');
  await assertNothingUncaught();
});

test('YouTube changes track through cueVideoById, not through the iframe src', async () => {
  const h = harness();
  const first = h.create(MIXES.youtube);
  await first.ready;
  const src = first.element.getAttribute('src');

  const second = h.create({
    title: 'Another Night',
    provider: 'youtube',
    url: 'https://youtu.be/SECONDplaceholder',
  });
  await second.ready;

  assert.equal(second.element, first.element);
  assert.equal(second.element.getAttribute('src'), src, 'the src must never be swapped');
  assert.deepEqual(h.apis.YT.Player.instances[0].cued, ['SECONDplaceholder']);
  assert.equal(h.apis.YT.Player.instances.length, 1, 'the player must be constructed once');
  await assertNothingUncaught();
});

// ===========================================================================
// KTD1 guards
// ===========================================================================

test('every adapter file is a classic script, never a module (KTD1)', () => {
  for (const rel of SCRIPTS) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/^\s*(import|export)\b/m.test(source), rel + ' must not use ES module syntax');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(source), rel + ' must not fetch anything');
    assert.ok(/window/.test(source), rel + ' must attach to window.LUVIZ');
  }
});
