/* ==========================================================================
   LUVIZMUSIC - players/adapter.js
   --------------------------------------------------------------------------
   ONE playback interface over four structurally different providers (KTD4).

   The rest of the site only ever talks to what create() returns:

     create(mix, mountEl)  ->  an instance carrying
       play()          -> Promise<boolean>   true if it started
       pause()         -> Promise<boolean>
       seek(seconds)   -> Promise<boolean>   FALSE means refused, not broken
       getPosition()   -> Promise<number>    seconds
       getDuration()   -> Promise<number>    seconds
       setVolume(0-1)  -> Promise<boolean>
       on(event, cb)   -> a function that unsubscribes
       off(event, cb)
       destroy()
       ready           -> Promise<boolean>   false means it never came up
       capabilities    -> { seek, volume, probed, source }
       attribution     -> SoundCloud credit descriptor, or null (R14)
       element         -> the iframe or audio element in the page

   FOUR RULES THIS FILE ENFORCES, EACH FOR A REASON:

   1. NOTHING REJECTS. Every method resolves - with false, or with 0 - and the
      failure is announced once as a normalised `blocked` event. The player bar
      has exactly one thing to listen for, and a provider outage can never turn
      into an uncaught error that takes the page down (R12).

   2. CAPABILITIES ARE PROBED, NOT ASSUMED. Each driver states a default; the
      live player is then asked what it can really do, and the answer wins. A
      wrong belief costs one greyed-out control, not a silent dead button.

   3. A PROVIDER'S PLAYER IS BUILT LAZILY, ON FIRST USE, AND THEN REUSED. No
      visitor loads three third-party players before asking for any audio, and
      changing track goes through the provider's own load call rather than
      swapping the iframe src, which would throw away the ready widget.

   4. EVERY IFRAME CARRIES allow="autoplay". Without it the frame cannot start
      playback even after the visitor has tapped.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var players = LUVIZ.players || (LUVIZ.players = {});
  /* The drivers register themselves here; they may load before or after this file. */
  var drivers = players.drivers || (players.drivers = {});

  /* The normalised event set. Every provider speaks exactly these. */
  var EVENTS = ['ready', 'play', 'pause', 'finish', 'progress', 'seek', 'capabilities', 'blocked'];

  /* How long a provider gets to say it is ready before we call it blocked. */
  var READY_TIMEOUT_MS = 12000;

  /* One live player per provider, built on first use and then reused. */
  var handles = {};
  /* One fetch per third-party script, however many mixes use it. */
  var scriptLoads = {};

  function noop() {}

  function toBoolean(value) {
    return value !== false && value !== undefined && value !== null;
  }

  function toNumber(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? number : 0;
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function assertEvent(event) {
    if (EVENTS.indexOf(event) === -1) {
      throw new Error(
        'Unknown player event "' + String(event) + '". The player emits: ' + EVENTS.join(', ') + '.'
      );
    }
  }

  function createEmitter() {
    var map = {};

    function drop(event, cb) {
      var list = map[event];
      if (!list) {
        return;
      }
      var index = list.indexOf(cb);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }

    return {
      on: function (event, cb) {
        assertEvent(event);
        if (typeof cb !== 'function') {
          throw new TypeError('on("' + event + '") needs a function to call.');
        }
        (map[event] || (map[event] = [])).push(cb);
        return function off() {
          drop(event, cb);
        };
      },
      off: function (event, cb) {
        assertEvent(event);
        drop(event, cb);
      },
      emit: function (event, payload) {
        var list = map[event];
        if (!list || list.length === 0) {
          return;
        }
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) {
          try {
            copy[i](payload);
          } catch (err) {
            /* One bad listener must never stop the music. */
          }
        }
      },
      clear: function () {
        map = {};
      }
    };
  }

  /* ------------------------------------------------------------------
     Capabilities (KTD4)
     ------------------------------------------------------------------ */

  /**
   * resolveCapabilities(stated, probed)
   *
   * `stated` is what the driver believes before it has seen a live player.
   * `probed` is what the live player actually turned out to expose, or null
   * when there was nothing to probe. The probe wins where it has an opinion;
   * the stated default survives everywhere else, and says so.
   */
  function resolveCapabilities(stated, probed) {
    var resolved = {
      seek: !!(stated && stated.seek),
      volume: !!(stated && stated.volume),
      probed: false,
      source: 'default'
    };
    if (!probed || typeof probed !== 'object') {
      return resolved;
    }
    if (typeof probed.seek === 'boolean') {
      resolved.seek = probed.seek;
    }
    if (typeof probed.volume === 'boolean') {
      resolved.volume = probed.volume;
    }
    resolved.probed = true;
    resolved.source = 'probe';
    return resolved;
  }

  function applyCapabilities(target, next) {
    target.seek = next.seek;
    target.volume = next.volume;
    target.probed = next.probed;
    target.source = next.source;
    return target;
  }

  function safeProbe(api) {
    if (!api || typeof api.probe !== 'function') {
      return null;
    }
    try {
      return api.probe();
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------------
     The one normalised failure shape (R12)
     ------------------------------------------------------------------ */

  function friendlyMessage(label, reason, err) {
    switch (reason) {
      case 'autoplay':
        return 'This browser would not start the mix on its own. Press play again.';
      case 'script':
        return 'The ' + label + ' player could not be loaded. Check the connection, or an ad blocker, and try again.';
      case 'timeout':
        return 'The ' + label + ' player did not answer. Try again.';
      default:
        if (err && typeof err.message === 'string' && err.message.length > 0) {
          return err.message;
        }
        return 'The ' + label + ' player could not play this mix.';
    }
  }

  function normaliseBlocked(driver, mix, detail, during) {
    var info = detail || {};
    var err = info.error || null;
    var reason = info.reason || (err && err.reason) || 'provider';
    return {
      provider: driver.provider,
      providerLabel: driver.label,
      mix: mix || null,
      reason: reason,
      during: during || info.during || null,
      message: friendlyMessage(driver.label, reason, err),
      /* R12: the player bar always has something to offer the visitor. */
      retryable: true,
      error: err
    };
  }

  /* ------------------------------------------------------------------
     The browser-only layer: elements and script tags
     ------------------------------------------------------------------ */

  function allowsAutoplay(allow) {
    var parts = String(allow || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].trim() === 'autoplay') {
        return true;
      }
    }
    return false;
  }

  function buildElement(driver, doc, src) {
    var spec = driver.element || { tag: 'iframe' };
    var el = doc.createElement(spec.tag);

    if (spec.tag === 'iframe') {
      var allow = spec.allow || 'autoplay';
      if (!allowsAutoplay(allow)) {
        /* Rule 4 at the top of this file: no autoplay permission, no playback. */
        allow = 'autoplay; ' + allow;
      }
      el.setAttribute('allow', allow);
      el.setAttribute('frameborder', '0');
      el.setAttribute('scrolling', 'no');
      el.setAttribute('title', spec.title || (driver.label + ' player'));
    }

    var attributes = spec.attributes || {};
    for (var name in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, name)) {
        el.setAttribute(name, attributes[name]);
      }
    }

    if (src) {
      el.setAttribute('src', src);
      try {
        el.src = src;
      } catch (err) {
        /* Some elements only take the attribute. That is enough. */
      }
    }
    return el;
  }

  function makeScriptLoader(doc) {
    return function loadScript(src) {
      if (!src) {
        return Promise.resolve();
      }
      if (scriptLoads[src]) {
        return scriptLoads[src];
      }
      scriptLoads[src] = new Promise(function (resolve, reject) {
        var el = doc.createElement('script');
        el.async = true;
        el.onload = function () {
          resolve();
        };
        el.onerror = function () {
          /* Forget it, so a later attempt can genuinely retry. */
          delete scriptLoads[src];
          var err = new Error('The browser could not load ' + src);
          err.reason = 'script';
          reject(err);
        };
        el.src = src;
        (doc.head || doc.body).appendChild(el);
      });
      return scriptLoads[src];
    };
  }

  function withTimeout(promise, ms, win, driver) {
    if (!ms || !win || typeof win.setTimeout !== 'function') {
      return promise;
    }
    return new Promise(function (resolve, reject) {
      var timer = win.setTimeout(function () {
        var err = new Error(
          'The ' + driver.label + ' player did not become ready within ' + Math.round(ms / 1000) + ' seconds.'
        );
        err.reason = 'timeout';
        reject(err);
      }, ms);
      promise.then(
        function (value) {
          win.clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          win.clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function mountInto(handle, mountEl) {
    var el = handle.element;
    if (!el || !mountEl || typeof mountEl.appendChild !== 'function') {
      return;
    }
    if (el.parentNode === mountEl) {
      return;
    }
    /* appendChild MOVES the frame rather than rebuilding it. */
    mountEl.appendChild(el);
  }

  /* ------------------------------------------------------------------
     The per-provider handle: built once, reused for every later mix
     ------------------------------------------------------------------ */

  function createHandle(driver, mix, deps) {
    var handle = {
      provider: driver.provider,
      driver: driver,
      element: null,
      api: null,
      current: null,
      loadedUrl: null
    };

    handle.emit = function (event, payload) {
      var instance = handle.current;
      if (!instance) {
        return;
      }
      if (event === 'blocked') {
        instance._emit('blocked', normaliseBlocked(driver, instance.mix, payload, null));
        return;
      }
      instance._emit(event, payload);
    };

    var src;
    try {
      src = driver.srcFor(mix, deps.env);
      handle.element = buildElement(driver, deps.doc, src);
    } catch (err) {
      handle.ready = Promise.reject(err);
      handle.ready.catch(noop);
      handle.gate = handle.ready;
      handle.select = function () {
        return handle.gate;
      };
      return handle;
    }

    /* The first mix is already in the src, so it needs no load() call. */
    handle.loadedUrl = LUVIZ.providerUrl.sourceUrl(mix);

    var ctx = {
      mix: mix,
      url: src,
      element: handle.element,
      win: deps.win,
      doc: deps.doc,
      env: deps.env,
      emit: handle.emit,
      loadScript: deps.loadScript
    };

    /*
      Deliberately started a turn late, so that the instance this handle
      belongs to is already wired up before any provider event can fire.
    */
    var attached = Promise.resolve()
      .then(function () {
        return driver.attach(ctx);
      })
      .then(function (api) {
        if (!api) {
          throw new Error('The ' + driver.label + ' driver returned no player.');
        }
        handle.api = api;
        return Promise.resolve(api.ready).then(function () {
          return api;
        });
      });

    handle.ready = withTimeout(attached, deps.readyTimeoutMs, deps.win, driver);
    handle.ready.catch(noop);
    handle.gate = handle.ready;

    /* Change track through the provider's own load call, never through src. */
    handle.select = function (nextMix) {
      var url = LUVIZ.providerUrl.sourceUrl(nextMix);
      handle.gate = handle.gate.then(function (api) {
        if (handle.loadedUrl === url || typeof api.load !== 'function') {
          return api;
        }
        handle.loadedUrl = url;
        return Promise.resolve(api.load(nextMix)).then(function () {
          return api;
        });
      });
      handle.gate.catch(noop);
      return handle.gate;
    };

    return handle;
  }

  /* ------------------------------------------------------------------
     create()
     ------------------------------------------------------------------ */

  function create(mix, mountEl, options) {
    var opts = options || {};
    var provider = mix && mix.provider;
    var driver = Object.prototype.hasOwnProperty.call(drivers, provider) ? drivers[provider] : null;
    if (!driver) {
      /* Names the provider that was asked for, and the ones that exist. */
      throw LUVIZ.providerUrl.unsupportedError(provider);
    }

    var win = opts.win || global;
    var doc = opts.doc || (win && win.document);
    if (!doc) {
      throw new Error('The player adapter has nowhere to put the ' + driver.label + ' player.');
    }

    var deps = {
      win: win,
      doc: doc,
      env: opts.env || LUVIZ.providerUrl.envFrom(win && win.location),
      loadScript: opts.loadScript || makeScriptLoader(doc),
      readyTimeoutMs: typeof opts.readyTimeoutMs === 'number' ? opts.readyTimeoutMs : READY_TIMEOUT_MS
    };

    var emitter = createEmitter();
    var capabilities = resolveCapabilities(driver.defaults, null);

    var handle = handles[provider];
    if (!handle) {
      /* Lazily built, here, the first time a mix on this provider is picked. */
      handle = handles[provider] = createHandle(driver, mix, deps);
    }

    var instance = {
      provider: provider,
      mix: mix,
      element: handle.element,
      capabilities: capabilities,
      /* R14: the SoundCloud obligation travels with the player, as data. */
      attribution: LUVIZ.providerUrl.attributionFor(mix),
      _emit: emitter.emit
    };

    /* Provider events belong to the newest selection from here on. */
    handle.current = instance;
    mountInto(handle, mountEl);

    function raiseBlocked(err, during) {
      emitter.emit('blocked', normaliseBlocked(driver, mix, { error: err }, during));
    }

    function call(name, arg, fallback) {
      return handle.gate
        .then(function (api) {
          if (typeof api[name] !== 'function') {
            return fallback;
          }
          return api[name](arg);
        })
        .then(
          function (value) {
            return value === undefined ? fallback : value;
          },
          function (err) {
            raiseBlocked(err, name);
            return fallback;
          }
        );
    }

    instance.ready = handle.select(mix).then(
      function (api) {
        applyCapabilities(capabilities, resolveCapabilities(driver.defaults, safeProbe(api)));
        emitter.emit('capabilities', capabilities);
        emitter.emit('ready', { provider: provider, mix: mix, capabilities: capabilities });
        return true;
      },
      function (err) {
        raiseBlocked(err, 'ready');
        return false;
      }
    );

    instance.play = function () {
      return call('play', undefined, false).then(toBoolean);
    };

    instance.pause = function () {
      return call('pause', undefined, false).then(toBoolean);
    };

    /**
     * A false here means REFUSED, not broken. Mixcloud can decline to scrub
     * for licensing reasons, and the honest response is to turn the seek
     * control off for this mix and keep playing (KTD4).
     */
    instance.seek = function (seconds) {
      return call('seek', seconds, false).then(function (accepted) {
        var ok = accepted !== false;
        if (!ok && capabilities.seek) {
          capabilities.seek = false;
          capabilities.probed = true;
          capabilities.source = 'refusal';
          emitter.emit('capabilities', capabilities);
        }
        return ok;
      });
    };

    instance.setVolume = function (level) {
      if (!capabilities.volume) {
        return Promise.resolve(false);
      }
      return call('setVolume', level, false).then(toBoolean);
    };

    instance.getPosition = function () {
      return call('getPosition', undefined, 0).then(toNumber);
    };

    instance.getDuration = function () {
      return call('getDuration', undefined, 0).then(toNumber);
    };

    instance.on = function (event, cb) {
      return emitter.on(event, cb);
    };

    instance.off = function (event, cb) {
      emitter.off(event, cb);
    };

    /**
     * Lets go of this selection. The provider's frame stays in the page for
     * the next mix on the same provider - rebuilding it would mean another
     * third-party load and another ready handshake.
     */
    instance.destroy = function () {
      var wasCurrent = handle.current === instance;
      if (wasCurrent) {
        handle.current = null;
      }
      var stopped = wasCurrent ? instance.pause() : Promise.resolve(false);
      return stopped.then(function () {
        emitter.clear();
        return true;
      });
    };

    return instance;
  }

  /* ------------------------------------------------------------------ */

  players.EVENTS = EVENTS;
  players.READY_TIMEOUT_MS = READY_TIMEOUT_MS;
  players.create = create;
  players.resolveCapabilities = resolveCapabilities;

  players.has = function (provider) {
    return Object.prototype.hasOwnProperty.call(drivers, provider);
  };

  players.providers = function () {
    var out = [];
    for (var name in drivers) {
      if (Object.prototype.hasOwnProperty.call(drivers, name)) {
        out.push(name);
      }
    }
    return out;
  };

  /** Drops every built player. A debugging seam, not part of normal playback. */
  players.reset = function () {
    for (var provider in handles) {
      if (Object.prototype.hasOwnProperty.call(handles, provider)) {
        var handle = handles[provider];
        if (handle.api && typeof handle.api.destroy === 'function') {
          try {
            handle.api.destroy();
          } catch (err) {
            /* Already gone. */
          }
        }
        if (handle.element && handle.element.parentNode) {
          handle.element.parentNode.removeChild(handle.element);
        }
      }
    }
    handles = {};
    scriptLoads = {};
  };
})(typeof window !== 'undefined' ? window : globalThis);
