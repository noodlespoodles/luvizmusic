/* ==========================================================================
   LUVIZMUSIC - players/soundcloud.js
   --------------------------------------------------------------------------
   The SoundCloud driver.

   SoundCloud's widget API is CALLBACK-shaped: you ask for the position and it
   hands the answer to a function you pass in. Every getter here is wrapped so
   that the rest of the site only ever sees a promise (KTD4).

   Two SoundCloud-specific rules are load-bearing:

     1. READY is bound BEFORE anything else is called on the widget. Calls made
        before the widget is ready are dropped, and SoundCloud never says so.
     2. The embed is loaded with auto_play=false. Nothing starts before the
        visitor asks for it.

   This file registers a description of the provider. It creates nothing until
   the adapter asks it to, which is the first time a visitor picks a
   SoundCloud mix.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var players = LUVIZ.players || (LUVIZ.players = {});
  var drivers = players.drivers || (players.drivers = {});

  var SCRIPT = 'https://w.soundcloud.com/player/api.js';

  function msToSeconds(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? number / 1000 : 0;
  }

  function clamp01(value) {
    var number = Number(value);
    if (!isFinite(number)) {
      return 0;
    }
    return Math.min(1, Math.max(0, number));
  }

  /** Turns one callback-shaped getter into a promise. */
  function ask(widget, method) {
    return new Promise(function (resolve, reject) {
      try {
        widget[method](function (value) {
          resolve(value);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  drivers.soundcloud = {
    provider: 'soundcloud',
    label: 'SoundCloud',
    script: SCRIPT,

    /*
      Stated default, not a hard-coded belief. The adapter probes the live
      widget and overrides these if the real object disagrees (KTD4).
    */
    defaults: { seek: true, volume: true },

    element: {
      tag: 'iframe',
      allow: 'autoplay',
      title: 'SoundCloud player'
    },

    srcFor: function (mix) {
      return LUVIZ.providerUrl.soundcloudEmbedUrl(mix);
    },

    attach: function (ctx) {
      return ctx.loadScript(SCRIPT).then(function () {
        var SC = ctx.win.SC;
        if (!SC || typeof SC.Widget !== 'function') {
          var missing = new Error('The SoundCloud player script loaded but SC.Widget was not in it.');
          missing.reason = 'script';
          throw missing;
        }

        var Events = SC.Widget.Events || {};
        var widget = SC.Widget(ctx.element);
        var settled = false;

        /* READY first, before any call. See the note at the top of this file. */
        var ready = new Promise(function (resolve, reject) {
          widget.bind(Events.READY, function () {
            settled = true;
            resolve();
          });
          widget.bind(Events.ERROR, function (detail) {
            var err = new Error('SoundCloud could not play this mix.');
            err.reason = 'provider';
            err.detail = detail;
            if (!settled) {
              settled = true;
              reject(err);
              return;
            }
            ctx.emit('blocked', { reason: 'provider', error: err });
          });
        });

        widget.bind(Events.PLAY, function () {
          ctx.emit('play');
        });
        widget.bind(Events.PAUSE, function () {
          ctx.emit('pause');
        });
        widget.bind(Events.FINISH, function () {
          ctx.emit('finish');
        });
        widget.bind(Events.SEEK, function () {
          ctx.emit('seek');
        });
        widget.bind(Events.PLAY_PROGRESS, function (detail) {
          ctx.emit('progress', { position: msToSeconds(detail && detail.currentPosition) });
        });

        return {
          ready: ready,

          play: function () {
            widget.play();
            return true;
          },

          pause: function () {
            widget.pause();
            return true;
          },

          seek: function (seconds) {
            widget.seekTo(Math.max(0, Number(seconds) || 0) * 1000);
            return true;
          },

          setVolume: function (level) {
            /* SoundCloud takes 0-100; the site speaks 0-1 everywhere. */
            widget.setVolume(clamp01(level) * 100);
            return true;
          },

          getPosition: function () {
            return ask(widget, 'getPosition').then(msToSeconds);
          },

          getDuration: function () {
            return ask(widget, 'getDuration').then(msToSeconds);
          },

          /* Changing track goes through load(), never through the iframe src. */
          load: function (mix) {
            return new Promise(function (resolve) {
              widget.load(LUVIZ.providerUrl.sourceUrl(mix), {
                auto_play: false,
                callback: function () {
                  resolve(true);
                }
              });
            });
          },

          /* What the live widget can actually do, read off the live widget. */
          probe: function () {
            if (!widget) {
              return null;
            }
            return {
              seek: typeof widget.seekTo === 'function',
              volume: typeof widget.setVolume === 'function'
            };
          },

          destroy: function () {
            try {
              widget.unbind(Events.PLAY_PROGRESS);
              widget.unbind(Events.PLAY);
              widget.unbind(Events.PAUSE);
              widget.unbind(Events.FINISH);
              widget.unbind(Events.SEEK);
            } catch (err) {
              /* An already-torn-down widget is not a problem worth reporting. */
            }
          }
        };
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
