/* ==========================================================================
   LUVIZMUSIC - namespace and content contract
   --------------------------------------------------------------------------
   This file must load FIRST, before any file in content/.

   It does three jobs:

   1. Creates the single global the whole site hangs off: window.LUVIZ.
   2. Keeps a register of which content files actually loaded. Each content
      file calls window.LUVIZ._loaded('mixes') as its very last line. If a
      content file has a typo in it, the browser refuses to run ANY of that
      file - so that last line never runs, and the file is detectable by its
      absence instead of by an exception. That is how a single broken file
      degrades to a named on-page message instead of a blank page.
   3. Holds the shared validation rules, so the page, the tests, and
      CHECK-CONTENT.bat all judge content by exactly the same standard.

   No modules, no fetch, no JSON (see KTD1): everything here has to work when
   index.html is opened straight off the disk by double-click.

   OWNERS: you never need to edit this file. Edit the files in content/.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* The content files the site expects, in load order. */
  LUVIZ.CONTENT_KEYS = ['site', 'crew', 'mixes', 'events'];

  /* Which of them reported in. Reset every time this file runs. */
  LUVIZ._register = {};

  /* Called at the bottom of each content file. */
  LUVIZ._loaded = function (key) {
    LUVIZ._register[key] = true;
  };

  LUVIZ._isLoaded = function (key) {
    return LUVIZ._register[key] === true && LUVIZ[key] !== undefined;
  };

  /* The content files that were expected but never reported in. */
  LUVIZ._missing = function () {
    var missing = [];
    for (var i = 0; i < LUVIZ.CONTENT_KEYS.length; i++) {
      var key = LUVIZ.CONTENT_KEYS[i];
      if (!LUVIZ._isLoaded(key)) {
        missing.push(key);
      }
    }
    return missing;
  };

  LUVIZ.fileFor = function (key) {
    return 'content/' + key + '.js';
  };

  /* One sentence, safe to show a visitor, naming the files that did not load. */
  LUVIZ.missingMessage = function () {
    var missing = LUVIZ._missing();
    if (missing.length === 0) {
      return '';
    }
    var files = [];
    for (var i = 0; i < missing.length; i++) {
      files.push(LUVIZ.fileFor(missing[i]));
    }
    return (
      (missing.length === 1 ? 'This file could not be read: ' : 'These files could not be read: ') +
      files.join(', ') +
      '. Everything else on the page still works. Run CHECK-CONTENT.bat to see which line is wrong.'
    );
  };

  /* ------------------------------------------------------------------
     Turning a browser or Node syntax error into something a human can act on.
     ------------------------------------------------------------------ */

  function lineNumberFrom(err) {
    if (err && typeof err.lineNumber === 'number') {
      return err.lineNumber;
    }
    var stack = err && err.stack ? String(err.stack) : '';
    var firstLine = stack.split('\n')[0] || '';
    var match = /:(\d+)\s*$/.exec(firstLine);
    if (match) {
      return parseInt(match[1], 10);
    }
    match = /:(\d+):\d+\)?\s*$/.exec(stack.split('\n')[1] || '');
    return match ? parseInt(match[1], 10) : null;
  }

  function hintFor(message) {
    if (/Invalid or unexpected token/i.test(message)) {
      return 'A quote is probably missing, or an odd character crept in. Every piece of text needs a quote at both ends.';
    }
    if (/Unexpected end of (input|script)/i.test(message)) {
      return 'Something was opened and never closed. Count the closing brackets: every { needs a }, every [ needs a ], every ( needs a ).';
    }
    if (/Unexpected (identifier|string|number)/i.test(message)) {
      return 'A comma is probably missing between two entries, or a quote was closed too early.';
    }
    if (/Unexpected token/i.test(message)) {
      return 'There is probably one comma too many, or a bracket in the wrong place.';
    }
    if (/is not defined/i.test(message)) {
      return 'A word outside quotes was read as code. If it is meant to be text, wrap it in quotes.';
    }
    return 'Check that line and the one above it for a missing quote, comma, bracket or brace.';
  }

  /**
   * explain('content/mixes.js', err) -> one plain-English paragraph.
   * Used by the on-page error banner, by the tests, and by CHECK-CONTENT.bat.
   */
  LUVIZ.explain = function (fileLabel, err) {
    var label = fileLabel || 'a content file';
    var message = err && err.message ? String(err.message) : String(err);
    var line = lineNumberFrom(err);
    var where = line ? ' at line ' + line : '';
    return (
      label + ' could not be read' + where + '. ' +
      hintFor(message) +
      ' Nothing else on the page is affected.' +
      ' (Technical detail: ' + ((err && err.name) || 'Error') + ': ' + message + ')'
    );
  };

  /* ------------------------------------------------------------------
     Validation rules, shared by the page, the tests and CHECK-CONTENT.bat.
     Every function returns an array of plain-English problems.
     An empty array means "all good".
     ------------------------------------------------------------------ */

  var PROVIDERS = ['soundcloud', 'youtube', 'mixcloud', 'file'];
  var BPM_MIN = 60;
  var BPM_MAX = 200;

  function isFilledString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function checkLinks(list, where, errors) {
    if (list === undefined) {
      return;
    }
    if (!Array.isArray(list)) {
      errors.push(where + ': links must be a list in square brackets.');
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var link = list[i] || {};
      if (!isFilledString(link.label)) {
        errors.push(where + ': link ' + (i + 1) + ' has no label. Give it the name people should click.');
      }
      if (!isFilledString(link.url)) {
        errors.push(where + ': link ' + (i + 1) + ' has no url.');
      } else if (!/^https?:\/\//i.test(link.url)) {
        errors.push(where + ': link ' + (i + 1) + ' url should start with https://');
      }
    }
  }

  function isRealIsoDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    var parts = value.split('-');
    var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return (
      date.getUTCFullYear() === +parts[0] &&
      date.getUTCMonth() === +parts[1] - 1 &&
      date.getUTCDate() === +parts[2]
    );
  }

  var validate = {
    PROVIDERS: PROVIDERS,
    BPM_MIN: BPM_MIN,
    BPM_MAX: BPM_MAX,

    site: function (site) {
      var errors = [];
      if (!site || typeof site !== 'object') {
        errors.push('site: content/site.js should set window.LUVIZ.site to a block in curly brackets.');
        return errors;
      }
      if (!isFilledString(site.tagline)) {
        errors.push('site: tagline is empty. This is the line under the wordmark.');
      }
      if (!isFilledString(site.blurb)) {
        errors.push('site: blurb is empty. This is the short paragraph about the night.');
      }
      if (!isFilledString(site.contactEmail)) {
        errors.push('site: contactEmail is empty.');
      } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(site.contactEmail)) {
        errors.push('site: contactEmail "' + site.contactEmail + '" does not look like an email address.');
      }
      checkLinks(site.socialLinks, 'site.socialLinks', errors);
      return errors;
    },

    crew: function (crew) {
      var errors = [];
      if (!Array.isArray(crew)) {
        errors.push('crew: content/crew.js should set window.LUVIZ.crew to a list in square brackets.');
        return errors;
      }
      for (var i = 0; i < crew.length; i++) {
        var member = crew[i] || {};
        var where = 'crew entry ' + (i + 1) + (isFilledString(member.name) ? ' (' + member.name + ')' : '');
        if (!isFilledString(member.name)) {
          errors.push(where + ': name is empty.');
        }
        if (!isFilledString(member.bio)) {
          errors.push(where + ': bio is empty.');
        }
        checkLinks(member.links, where, errors);
      }
      return errors;
    },

    mixes: function (mixes) {
      var errors = [];
      if (!Array.isArray(mixes)) {
        errors.push('mixes: content/mixes.js should set window.LUVIZ.mixes to a list in square brackets.');
        return errors;
      }
      for (var i = 0; i < mixes.length; i++) {
        var mix = mixes[i] || {};
        var where = 'mix ' + (i + 1) + (isFilledString(mix.title) ? ' (' + mix.title + ')' : '');
        if (!isFilledString(mix.title)) {
          errors.push(where + ': title is empty.');
        }
        if (!isFilledString(mix.url)) {
          errors.push(where + ': url is empty. Paste the share link for the mix.');
        }
        if (PROVIDERS.indexOf(mix.provider) === -1) {
          errors.push(
            where + ': provider "' + String(mix.provider) + '" is not supported. Use one of: ' +
            PROVIDERS.join(', ') + '.'
          );
        }
        errors = errors.concat(validate.beatGrid(mix.beatGrid, where));
      }
      return errors;
    },

    beatGrid: function (grid, where) {
      var errors = [];
      var label = where || 'mix';
      if (grid === undefined) {
        return errors; /* No grid is allowed: that mix simply does not pulse. */
      }
      if (!Array.isArray(grid) || grid.length === 0) {
        errors.push(label + ': beatGrid must be a list of tempo segments, or left out entirely.');
        return errors;
      }
      var previous = -1;
      for (var i = 0; i < grid.length; i++) {
        var segment = grid[i] || {};
        var at = label + ' beatGrid segment ' + (i + 1);
        if (!isNumber(segment.atMs) || segment.atMs < 0) {
          errors.push(at + ': atMs must be a number of milliseconds, 0 or more.');
        } else if (segment.atMs <= previous) {
          errors.push(at + ': atMs must be later than the segment before it.');
        } else {
          previous = segment.atMs;
        }
        if (!isNumber(segment.bpm) || segment.bpm < BPM_MIN || segment.bpm > BPM_MAX) {
          errors.push(at + ': bpm must be a number between ' + BPM_MIN + ' and ' + BPM_MAX + '.');
        }
      }
      return errors;
    },

    events: function (events) {
      var errors = [];
      if (!Array.isArray(events)) {
        errors.push('events: content/events.js should set window.LUVIZ.events to a list in square brackets.');
        return errors;
      }
      for (var i = 0; i < events.length; i++) {
        var event = events[i] || {};
        var where = 'event ' + (i + 1) + (isFilledString(event.title) ? ' (' + event.title + ')' : '');
        if (!isFilledString(event.title)) {
          errors.push(where + ': title is empty.');
        }
        if (!isFilledString(event.venue)) {
          errors.push(where + ': venue is empty.');
        }
        if (!isFilledString(event.city)) {
          errors.push(where + ': city is empty.');
        }
        if (!isFilledString(event.date) || !isRealIsoDay(event.date)) {
          errors.push(
            where + ': date "' + String(event.date) + '" is not a real date written as YYYY-MM-DD ' +
            '(for example 2026-09-19).'
          );
        }
        if (event.ticketUrl !== undefined && !/^https?:\/\//i.test(String(event.ticketUrl))) {
          errors.push(where + ': ticketUrl should start with https://, or be left out.');
        }
      }
      return errors;
    },

    /* True when the mix carries a beat grid and may therefore drive the pulse. */
    pulses: function (mix) {
      return !!(mix && Array.isArray(mix.beatGrid) && mix.beatGrid.length > 0);
    },

    /* An event happening today or later is upcoming. `now` is ms or a Date. */
    isUpcoming: function (event, now) {
      var stamp = Date.parse(String(event && event.date) + 'T00:00:00Z');
      if (isNaN(stamp)) {
        return false;
      }
      var reference = now instanceof Date ? now.getTime() : Number(now);
      var startOfDay = Date.parse(new Date(reference).toISOString().slice(0, 10) + 'T00:00:00Z');
      return stamp >= startOfDay;
    },

    /* Whole-site check: every loaded key validated, every missing key named. */
    all: function (luviz) {
      var source = luviz || LUVIZ;
      var errors = [];
      var missing = source._missing ? source._missing() : [];
      if (source.site !== undefined) {
        errors = errors.concat(validate.site(source.site));
      }
      if (source.crew !== undefined) {
        errors = errors.concat(validate.crew(source.crew));
      }
      if (source.mixes !== undefined) {
        errors = errors.concat(validate.mixes(source.mixes));
      }
      if (source.events !== undefined) {
        errors = errors.concat(validate.events(source.events));
      }
      return {
        ok: errors.length === 0 && missing.length === 0,
        errors: errors,
        missing: missing
      };
    }
  };

  LUVIZ.validate = validate;
})(typeof window !== 'undefined' ? window : globalThis);
