/* ==========================================================================
   LUVIZMUSIC - players/youtube.js
   --------------------------------------------------------------------------
   The YouTube driver.

   YouTube's iframe API is SYNCHRONOUS-shaped: getCurrentTime() hands back a
   number there and then. Every getter here is still wrapped in a promise, so
   the rest of the site sees one shape across all four providers (KTD4).

   Three YouTube-specific rules are load-bearing:

     1. The embed needs enablejsapi=1, or our own transport controls cannot
        drive it, and playsinline=1, or iOS takes the video fullscreen.
     2. The `origin` parameter is sent ONLY over http:// and https://. See the
        long note in js/provider-url.js: sending it under file:// breaks the
        double-click preview outright.
     3. The API arrives through one global callback, onYouTubeIframeAPIReady,
        which the whole page shares. We chain onto whatever was there rather
        than overwriting it.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});
  var players = LUVIZ.players || (LUVIZ.players = {});
  var drivers = players.drivers || (players.drivers = {});

  var SCRIPT = 'https://www.youtube.com/iframe_api';

  /* YouTube's player states, spelled out so the mapping below reads plainly. */
  var STATE = {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
  };

  var ERROR_TEXT = {
    2: 'YouTube rejected that video id.',
    5: 'The YouTube player could not start in this browser.',
    100: 'That YouTube video is gone or private.',
    101: 'The owner of that YouTube video does not allow it to be played on other sites.',
    150: 'The owner of that YouTube video does not allow it to be played on other sites.'
  };

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

  /**
   * Resolves with the YT namespace once the shared API script has announced
   * itself. Loaded at most once per page, and only when a YouTube mix is
   * actually picked.
   */
  function apiReady(ctx) {
    var win = ctx.win;
    if (win.YT && typeof win.YT.Player === 'function') {
      return Promise.resolve(win.YT);
    }
    if (!win.__luvizYouTubeApi) {
      win.__luvizYouTubeApi = new Promise(function (resolve, reject) {
        /* Chain, never clobber: something else on the page may want this too. */
        var previous = win.onYouTubeIframeAPIReady;
        win.onYouTubeIframeAPIReady = function () {
          if (typeof previous === 'function') {
            try {
              previous();
            } catch (err) {
              /* Someone else's callback failing is not our failure. */
            }
          }
          resolve(win.YT);
        };
        ctx.loadScript(SCRIPT).then(
          function () {
            /* Some builds define YT before firing the callback. */
            if (win.YT && typeof win.YT.Player === 'function') {
              resolve(win.YT);
            }
          },
          function (err) {
            reject(err);
          }
        );
      });
    }
    return win.__luvizYouTubeApi;
  }

  drivers.youtube = {
    provider: 'youtube',
    label: 'YouTube',
    script: SCRIPT,

    /* Stated default; the adapter probes the live player and may override. */
    defaults: { seek: true, volume: true },

    element: {
      tag: 'iframe',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      title: 'YouTube player',
      attributes: {
        /*
          R13 wants a visible player of at least 200x200 CSS pixels. CSS in
          css/player.css does the real sizing; these attributes only stop a
          bare iframe collapsing to the 300x150 default if that CSS is missing.
        */
        width: '560',
        height: '315',
        allowfullscreen: 'allowfullscreen'
      }
    },

    srcFor: function (mix, env) {
      return LUVIZ.providerUrl.youTubeEmbedUrl(mix, env);
    },

    attach: function (ctx) {
      return apiReady(ctx).then(function (YT) {
        var states = YT.PlayerState || STATE;
        var player = null;
        var settled = false;

        var ready = new Promise(function (resolve, reject) {
          try {
            /*
              Attaching to the iframe we already mounted, rather than letting
              the API build one. That keeps the src - and its enablejsapi,
              playsinline and origin parameters - exactly as provider-url.js
              built it.
            */
            player = new YT.Player(ctx.element, {
              events: {
                onReady: function () {
                  settled = true;
                  resolve();
                },
                onStateChange: function (event) {
                  var code = event && event.data;
                  if (code === states.PLAYING) {
                    ctx.emit('play');
                  } else if (code === states.PAUSED) {
                    ctx.emit('pause');
                  } else if (code === states.ENDED) {
                    ctx.emit('finish');
                  }
                },
                onError: function (event) {
                  var code = event && event.data;
                  var err = new Error(ERROR_TEXT[code] || 'YouTube could not play this mix.');
                  err.reason = 'provider';
                  err.code = code;
                  if (!settled) {
                    settled = true;
                    reject(err);
                    return;
                  }
                  ctx.emit('blocked', { reason: 'provider', error: err });
                },
                /* The browser refused to start without a tap: R12/R12a path. */
                onAutoplayBlocked: function () {
                  var err = new Error('The browser would not start this mix on its own.');
                  err.reason = 'autoplay';
                  ctx.emit('blocked', { reason: 'autoplay', error: err });
                }
              }
            });
          } catch (err) {
            reject(err);
          }
        });

        return {
          ready: ready,

          play: function () {
            player.playVideo();
            return true;
          },

          pause: function () {
            player.pauseVideo();
            return true;
          },

          seek: function (seconds) {
            /* true = seek immediately rather than waiting for playback. */
            player.seekTo(Math.max(0, Number(seconds) || 0), true);
            return true;
          },

          setVolume: function (level) {
            /* YouTube takes 0-100; the site speaks 0-1 everywhere. */
            player.setVolume(clamp01(level) * 100);
            return true;
          },

          /* Synchronous getters, normalised to promises like the rest. */
          getPosition: function () {
            return toSeconds(player.getCurrentTime());
          },

          getDuration: function () {
            return toSeconds(player.getDuration());
          },

          /* Changing track goes through the API, never through the iframe src. */
          load: function (mix) {
            var id = LUVIZ.providerUrl.youTubeId(mix);
            if (!id) {
              throw new Error('That YouTube mix has no video id in its url.');
            }
            if (typeof player.cueVideoById === 'function') {
              player.cueVideoById(id);
            } else {
              player.loadVideoById(id);
            }
            return true;
          },

          probe: function () {
            if (!player) {
              return null;
            }
            return {
              seek: typeof player.seekTo === 'function',
              volume: typeof player.setVolume === 'function'
            };
          },

          destroy: function () {
            if (player && typeof player.destroy === 'function') {
              player.destroy();
            }
          }
        };
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
