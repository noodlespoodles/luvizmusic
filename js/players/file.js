/* ==========================================================================
   LUVIZMUSIC - players/file.js
   --------------------------------------------------------------------------
   The self-hosted driver: a mix the crew puts in this site's own folder.

   This one exists because it escapes everything the embeds impose (KTD14).
   There is no iframe, so there is no cross-frame relay and no third-party
   script. The audio is same-origin, so the browser will let us read its
   position exactly, set its volume, and - later - hang a real AnalyserNode
   off it instead of guessing the tempo from a beat grid.

   It is the only provider that can honestly declare BOTH seek and volume, and
   it still probes the live element rather than taking that on trust.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var players = LUVIZ.players || (LUVIZ.players = {});
  var drivers = players.drivers || (players.drivers = {});

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

  drivers.file = {
    provider: 'file',
    label: 'this site',
    /* No third-party script: the browser already knows how to play audio. */
    script: null,

    /* Stated default. Still probed below against the live element. */
    defaults: { seek: true, volume: true },

    element: {
      tag: 'audio',
      attributes: {
        preload: 'metadata',
        playsinline: 'playsinline'
      }
    },

    srcFor: function (mix) {
      return LUVIZ.providerUrl.fileSourceUrl(mix);
    },

    attach: function (ctx) {
      var el = ctx.element;

      el.addEventListener('play', function () {
        ctx.emit('play');
      });
      el.addEventListener('pause', function () {
        ctx.emit('pause');
      });
      el.addEventListener('ended', function () {
        ctx.emit('finish');
      });
      el.addEventListener('seeked', function () {
        ctx.emit('seek');
      });
      el.addEventListener('timeupdate', function () {
        ctx.emit('progress', {
          position: toSeconds(el.currentTime),
          duration: toSeconds(el.duration)
        });
      });
      el.addEventListener('error', function () {
        var err = new Error('That audio file could not be read. Check the path in content/mixes.js.');
        err.reason = 'provider';
        ctx.emit('blocked', { reason: 'provider', error: err });
      });

      return {
        /* An audio element takes calls immediately; metadata catches up later. */
        ready: Promise.resolve(),

        play: function () {
          var started;
          try {
            started = el.play();
          } catch (err) {
            err.reason = 'autoplay';
            throw err;
          }
          return Promise.resolve(started).then(
            function () {
              return true;
            },
            function (err) {
              /*
                A rejected play() on a same-origin audio element almost always
                means the browser wants a tap first. That is the R12 path, not
                a broken file.
              */
              var refused = new Error('The browser would not start this mix on its own.');
              refused.reason = err && err.name === 'NotAllowedError' ? 'autoplay' : 'provider';
              refused.detail = err;
              throw refused;
            }
          );
        },

        pause: function () {
          el.pause();
          return true;
        },

        seek: function (seconds) {
          el.currentTime = Math.max(0, Number(seconds) || 0);
          return true;
        },

        setVolume: function (level) {
          el.volume = clamp01(level);
          return true;
        },

        getPosition: function () {
          return toSeconds(el.currentTime);
        },

        getDuration: function () {
          return toSeconds(el.duration);
        },

        /*
          For an audio element, setting src and calling load() IS the element's
          own load call - there is no separate API to go through, and no
          third-party frame whose state we would be throwing away.
        */
        load: function (mix) {
          var url = LUVIZ.providerUrl.fileSourceUrl(mix);
          el.src = url;
          el.setAttribute('src', url);
          if (typeof el.load === 'function') {
            el.load();
          }
          return true;
        },

        probe: function () {
          if (!el) {
            return null;
          }
          return {
            seek: 'currentTime' in el,
            volume: 'volume' in el
          };
        },

        destroy: function () {
          try {
            el.pause();
          } catch (err) {
            /* Already stopped. */
          }
        }
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
