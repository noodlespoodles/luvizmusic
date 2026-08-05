/* ==========================================================================
   LUVIZMUSIC - players/mixcloud.js
   --------------------------------------------------------------------------
   The Mixcloud driver.

   Mixcloud's widget API is PROMISE-shaped already: getPosition() hands back a
   promise. That makes it the easy one of the three, but it carries two traps
   the other two do not:

     1. seek() CAN BE REFUSED. Mixcloud licenses some shows on terms that
        forbid scrubbing, and in that case seek() resolves FALSE rather than
        failing. That is a refusal, not an error: the site turns its seek
        control off for that mix and carries on playing (KTD4).
     2. There is NO published volume setter. The stated default here is
        therefore volume:false, and only a runtime probe that actually finds a
        setVolume method on the live widget is allowed to say otherwise.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var players = LUVIZ.players || (LUVIZ.players = {});
  var drivers = players.drivers || (players.drivers = {});

  var SCRIPT = 'https://widget.mixcloud.com/media/js/widgetApi.js';

  function toSeconds(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? number : 0;
  }

  function clamp01(value) {
    var number = Number(value);
    if (!isFinite(number)) {
      return 0;
    }
    return Math.min(1, Math.max(0, number));
  }

  /** Subscribes to a Mixcloud event only if that event actually exists. */
  function listen(events, name, handler) {
    var channel = events && events[name];
    if (channel && typeof channel.on === 'function') {
      channel.on(handler);
      return true;
    }
    return false;
  }

  drivers.mixcloud = {
    provider: 'mixcloud',
    label: 'Mixcloud',
    script: SCRIPT,

    /*
      Stated default. seek is assumed available until a show refuses; volume is
      assumed absent until a probe finds a setter. Both are overridable at
      runtime, which is the whole point of KTD4.
    */
    defaults: { seek: true, volume: false },

    element: {
      tag: 'iframe',
      allow: 'autoplay',
      title: 'Mixcloud player'
    },

    srcFor: function (mix) {
      return LUVIZ.providerUrl.mixcloudEmbedUrl(mix);
    },

    attach: function (ctx) {
      return ctx.loadScript(SCRIPT).then(function () {
        var Mixcloud = ctx.win.Mixcloud;
        if (!Mixcloud || typeof Mixcloud.PlayerWidget !== 'function') {
          var missing = new Error('The Mixcloud widget script loaded but Mixcloud.PlayerWidget was not in it.');
          missing.reason = 'script';
          throw missing;
        }

        var widget = Mixcloud.PlayerWidget(ctx.element);
        var events = widget.events || {};

        listen(events, 'play', function () {
          ctx.emit('play');
        });
        listen(events, 'pause', function () {
          ctx.emit('pause');
        });
        listen(events, 'ended', function () {
          ctx.emit('finish');
        });
        listen(events, 'progress', function (position) {
          ctx.emit('progress', { position: toSeconds(position) });
        });
        listen(events, 'error', function (detail) {
          var err = new Error('Mixcloud could not play this mix.');
          err.reason = 'provider';
          err.detail = detail;
          ctx.emit('blocked', { reason: 'provider', error: err });
        });

        return {
          ready: Promise.resolve(widget.ready),

          play: function () {
            return Promise.resolve(widget.play()).then(function () {
              return true;
            });
          },

          pause: function () {
            return Promise.resolve(widget.pause()).then(function () {
              return true;
            });
          },

          /*
            A false here is a REFUSAL, not a failure. It travels back to the
            adapter as false, which turns the seek control off for this mix
            without raising anything the visitor has to act on.
          */
          seek: function (seconds) {
            return Promise.resolve(widget.seek(Math.max(0, Number(seconds) || 0))).then(function (accepted) {
              return accepted !== false;
            });
          },

          setVolume: function (level) {
            if (typeof widget.setVolume !== 'function') {
              return false;
            }
            return Promise.resolve(widget.setVolume(clamp01(level))).then(function () {
              return true;
            });
          },

          getPosition: function () {
            return Promise.resolve(widget.getPosition()).then(toSeconds);
          },

          getDuration: function () {
            return Promise.resolve(widget.getDuration()).then(toSeconds);
          },

          /* Changing show goes through load(), never through the iframe src. */
          load: function (mix) {
            return Promise.resolve(widget.load(LUVIZ.providerUrl.sourceUrl(mix), false)).then(function () {
              return true;
            });
          },

          /*
            The honest answer about this widget, read off this widget. If
            Mixcloud ever ships a volume setter, this is what notices.
          */
          probe: function () {
            if (!widget) {
              return null;
            }
            return {
              seek: typeof widget.seek === 'function',
              volume: typeof widget.setVolume === 'function'
            };
          },

          destroy: function () {
            /* Mixcloud publishes no teardown call; dropping the iframe is it. */
          }
        };
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
