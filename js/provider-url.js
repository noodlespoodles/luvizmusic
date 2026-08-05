/* ==========================================================================
   LUVIZMUSIC - provider-url.js
   --------------------------------------------------------------------------
   Everything about a provider that can be decided WITHOUT a browser: what the
   embed address should be, which query parameters are mandatory, and what
   SoundCloud's Terms of Use oblige us to show next to a SoundCloud mix.

   This file is deliberately pure (KTD15). It never touches the page, never
   creates an element, never reaches the network. That is what lets it be
   tested under `node --test`, which has no browser in it at all. The thin
   browser-only layer that actually mounts an iframe lives in js/players/.

   OWNERS: you never need to edit this file. Edit content/mixes.js.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* The four providers the site can play. Kept in step with js/namespace.js. */
  var PROVIDERS = ['soundcloud', 'youtube', 'mixcloud', 'file'];

  var SOUNDCLOUD_PLAYER = 'https://w.soundcloud.com/player/';
  var YOUTUBE_EMBED = 'https://www.youtube.com/embed/';
  var MIXCLOUD_WIDGET = 'https://player-widget.mixcloud.com/widget/iframe/';

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  function sourceUrl(mixOrUrl) {
    if (typeof mixOrUrl === 'string') {
      return mixOrUrl.trim();
    }
    if (mixOrUrl && typeof mixOrUrl.url === 'string') {
      return mixOrUrl.url.trim();
    }
    return '';
  }

  function providerOf(mix) {
    return mix && typeof mix.provider === 'string' ? mix.provider : mix && mix.provider;
  }

  /** Builds a query string, dropping any pair whose value is null/undefined. */
  function query(pairs) {
    var parts = [];
    for (var i = 0; i < pairs.length; i++) {
      var key = pairs[i][0];
      var value = pairs[i][1];
      if (value === null || value === undefined) {
        continue;
      }
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return parts.join('&');
  }

  function unsupportedError(provider) {
    var error = new Error(
      'Unsupported player provider "' + String(provider) + '". ' +
      'LUVIZMUSIC can play: ' + PROVIDERS.join(', ') + '. ' +
      'Check the provider line for that mix in content/mixes.js.'
    );
    error.reason = 'unsupported';
    error.provider = provider;
    return error;
  }

  function supports(provider) {
    return PROVIDERS.indexOf(provider) !== -1;
  }

  /* ------------------------------------------------------------------
     YouTube
     ------------------------------------------------------------------ */

  /** Pulls the 11-ish character video id out of any shape of YouTube link. */
  function youTubeId(mixOrUrl) {
    var url = sourceUrl(mixOrUrl);
    if (!url) {
      return null;
    }
    var match = /[?&]v=([A-Za-z0-9_-]{4,})/.exec(url);
    if (match) {
      return match[1];
    }
    match = /youtu\.be\/([A-Za-z0-9_-]{4,})/.exec(url);
    if (match) {
      return match[1];
    }
    match = /\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{4,})/.exec(url);
    if (match) {
      return match[1];
    }
    /* Someone pasted the bare id rather than the whole link. */
    if (/^[A-Za-z0-9_-]{6,}$/.test(url)) {
      return url;
    }
    return null;
  }

  /**
   * THE ONE RULE THAT BREAKS THE DOUBLE-CLICK PREVIEW IF IGNORED.
   *
   * The YouTube iframe API checks the `origin` parameter against the page that
   * embedded it. Over http:// and https:// that check passes. Opened straight
   * off the disk the page's origin serialises to "null" or "file://", and the
   * API handshake accepts neither - so the player never becomes ready and the
   * mix simply never starts. Under file:// we therefore send no origin at all.
   */
  function wantsOrigin(protocol) {
    return protocol === 'http:' || protocol === 'https:';
  }

  function usableOrigin(origin) {
    if (typeof origin !== 'string') {
      return false;
    }
    var trimmed = origin.trim();
    if (!trimmed || trimmed === 'null') {
      return false;
    }
    return /^https?:\/\//i.test(trimmed);
  }

  /** { protocol, origin } read off a Location-shaped object. Never throws. */
  function envFrom(location) {
    var protocol = location && typeof location.protocol === 'string' ? location.protocol : 'file:';
    var origin = location && typeof location.origin === 'string' ? location.origin : '';
    return { protocol: protocol, origin: origin };
  }

  function youTubeEmbedUrl(mixOrUrl, env) {
    var id = youTubeId(mixOrUrl);
    if (!id) {
      throw new Error(
        'This YouTube mix has no video id in its url: "' + sourceUrl(mixOrUrl) + '". ' +
        'Paste the normal watch link, for example ' +
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    }
    var where = env || {};
    var pairs = [
      /* enablejsapi is what lets the site's own transport controls drive it. */
      ['enablejsapi', '1'],
      /* playsinline stops iOS taking the video fullscreen on first play. */
      ['playsinline', '1'],
      ['autoplay', '0'],
      ['rel', '0'],
      ['modestbranding', '1']
    ];
    if (wantsOrigin(where.protocol) && usableOrigin(where.origin)) {
      pairs.push(['origin', where.origin.trim()]);
    }
    return YOUTUBE_EMBED + encodeURIComponent(id) + '?' + query(pairs);
  }

  /* ------------------------------------------------------------------
     SoundCloud
     ------------------------------------------------------------------ */

  function soundcloudEmbedUrl(mixOrUrl) {
    var url = sourceUrl(mixOrUrl);
    if (!url) {
      throw new Error('This SoundCloud mix has no url. Paste its share link into content/mixes.js.');
    }
    return SOUNDCLOUD_PLAYER + '?' + query([
      ['url', url],
      /* Nothing may start before the visitor asks for it. */
      ['auto_play', 'false'],
      /* show_user keeps the uploader visible inside the widget too (R14). */
      ['show_user', 'true'],
      ['show_artwork', 'true'],
      ['show_comments', 'false'],
      ['show_teaser', 'false'],
      ['hide_related', 'true'],
      ['visual', 'false'],
      ['single_active', 'false'],
      ['callback', 'true']
    ]);
  }

  /* ------------------------------------------------------------------
     Mixcloud
     ------------------------------------------------------------------ */

  /** Mixcloud identifies a show by its feed path, not by its full address. */
  function mixcloudFeed(mixOrUrl) {
    var url = sourceUrl(mixOrUrl);
    if (!url) {
      return '';
    }
    var path = url;
    var stripped = /^https?:\/\/[^/]+(\/.*)$/i.exec(url);
    if (stripped) {
      path = stripped[1];
    }
    path = path.replace(/[?#].*$/, '');
    if (path.charAt(0) !== '/') {
      path = '/' + path;
    }
    if (path.charAt(path.length - 1) !== '/') {
      path = path + '/';
    }
    return path;
  }

  function mixcloudEmbedUrl(mixOrUrl) {
    var feed = mixcloudFeed(mixOrUrl);
    if (!feed || feed === '/') {
      throw new Error('This Mixcloud mix has no url. Paste its share link into content/mixes.js.');
    }
    return MIXCLOUD_WIDGET + '?' + query([
      ['hide_cover', '1'],
      ['light', '0'],
      ['autoplay', '0'],
      ['feed', feed]
    ]);
  }

  /* ------------------------------------------------------------------
     file (a mix the crew hosts itself)
     ------------------------------------------------------------------ */

  function fileSourceUrl(mixOrUrl) {
    var url = sourceUrl(mixOrUrl);
    if (!url) {
      throw new Error(
        'This self-hosted mix has no url. Point it at an audio file inside this ' +
        'site folder, for example media/mixes/night-014.mp3.'
      );
    }
    return url;
  }

  /* ------------------------------------------------------------------
     Dispatch
     ------------------------------------------------------------------ */

  function embedUrlFor(mix, env) {
    var provider = providerOf(mix);
    switch (provider) {
      case 'soundcloud':
        return soundcloudEmbedUrl(mix);
      case 'youtube':
        return youTubeEmbedUrl(mix, env);
      case 'mixcloud':
        return mixcloudEmbedUrl(mix);
      case 'file':
        return fileSourceUrl(mix);
      default:
        throw unsupportedError(provider);
    }
  }

  /* ------------------------------------------------------------------
     SoundCloud attribution (R14)

     SoundCloud's Terms of Use require the uploader to be credited, the
     SoundCloud logo to be shown, and a link back to the track on SoundCloud.
     This is an obligation, not decoration, so it is described here as data
     and rendered by the player bar rather than being left to whoever
     remembers. The logo travels as inline SVG so it costs no request and
     still appears when the page is opened straight off the disk.
     ------------------------------------------------------------------ */

  var SOUNDCLOUD_LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 20" role="img" ' +
    'aria-label="SoundCloud" fill="currentColor" focusable="false">' +
    '<rect x="0" y="9" width="2" height="7" rx="1"/>' +
    '<rect x="4" y="6" width="2" height="10" rx="1"/>' +
    '<rect x="8" y="3" width="2" height="13" rx="1"/>' +
    '<rect x="12" y="5" width="2" height="11" rx="1"/>' +
    '<rect x="16" y="1" width="2" height="15" rx="1"/>' +
    '<rect x="20" y="4" width="2" height="12" rx="1"/>' +
    '<path d="M25 16V3.6A9.2 9.2 0 0 1 38.4 8.2 6.6 6.6 0 0 1 41 7.7a6.2 6.2 0 0 1 0 ' +
    '12.3v-.1H25z" transform="translate(0,-4)"/>' +
    '</svg>';

  function attributionFor(mix) {
    if (!mix || providerOf(mix) !== 'soundcloud') {
      return null;
    }
    var credit = typeof mix.credit === 'string' && mix.credit.trim().length > 0
      ? mix.credit.trim()
      : 'Uploaded to SoundCloud';
    return {
      provider: 'soundcloud',
      /* required:true is the flag that stops this being treated as optional chrome. */
      required: true,
      credit: credit,
      sourceUrl: sourceUrl(mix),
      sourceLabel: 'Listen on SoundCloud',
      logo: {
        alt: 'SoundCloud',
        /* Inline first, so attribution never depends on a file being present. */
        svg: SOUNDCLOUD_LOGO_SVG,
        /*
          Optional upgrade path: drop the official mark from SoundCloud's own
          brand page at this path and the player bar will prefer it. The inline
          SVG above is our own drawing, not the official artwork.
        */
        src: 'assets/brand/soundcloud-logo.svg',
        href: 'https://soundcloud.com'
      }
    };
  }

  /* ------------------------------------------------------------------ */

  LUVIZ.providerUrl = {
    PROVIDERS: PROVIDERS,
    supports: supports,
    unsupportedError: unsupportedError,
    sourceUrl: sourceUrl,
    envFrom: envFrom,
    wantsOrigin: wantsOrigin,
    youTubeId: youTubeId,
    youTubeEmbedUrl: youTubeEmbedUrl,
    soundcloudEmbedUrl: soundcloudEmbedUrl,
    mixcloudFeed: mixcloudFeed,
    mixcloudEmbedUrl: mixcloudEmbedUrl,
    fileSourceUrl: fileSourceUrl,
    embedUrlFor: embedUrlFor,
    attributionFor: attributionFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
