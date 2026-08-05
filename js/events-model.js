/* ==========================================================================
   LUVIZMUSIC - events-model.js
   --------------------------------------------------------------------------
   WHICH NIGHTS ARE STILL TO COME, WHICH HAVE BEEN AND GONE, AND IN WHAT ORDER
   THEY READ. That is the whole job of this file (R8).

   It is deliberately DOM-free (KTD15). It never touches the page, never reads
   the clock, and never throws: it takes a list of nights and a "now", and
   hands back three lists - upcoming, past, and the entries it could not read.
   That is what makes it testable under `node --test`, where there is no
   document and no browser (see tests/events.test.js).

   TWO RULES WORTH KNOWING:

   1. TODAY COUNTS AS UPCOMING. A night listed for today has not happened yet
      at any hour of that day, so it stays at the top of the list until the
      following morning. The comparison is done at whole-day resolution in
      UTC, so it does not shift with the visitor's time zone: a date in
      content/events.js is a calendar day, not an instant.

   2. AN UNREADABLE DATE IS REPORTED, NOT DROPPED. A night with a mistyped
      date is the one the owner most needs to be told about. Silently hiding
      it would look exactly like a night that was never added.
   ========================================================================== */

(function (global) {
  'use strict';

  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  var MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var DAYS_LONG = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  /*
    Month and weekday names are spelled out here rather than taken from
    toLocaleDateString. The site is set in one voice, and a locale-dependent
    string would render differently on the owner's machine, on a visitor's
    phone, and under Node - which would make the tests below unstable for a
    reason that has nothing to do with the site.
  */

  var DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** The instant a YYYY-MM-DD calendar day starts, in UTC. NaN if unreadable. */
  function dayStamp(value) {
    var match = DATE_SHAPE.exec(String(value));
    if (!match) {
      return NaN;
    }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var stamp = Date.UTC(year, month - 1, day);
    var check = new Date(stamp);
    /* Date.UTC rolls 2027-02-31 forward into March; a real day round-trips. */
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return NaN;
    }
    return stamp;
  }

  /** The start of the calendar day `now` falls in. Accepts a Date or ms. */
  function startOfDay(now) {
    var reference = now instanceof Date ? now.getTime() : Number(now);
    if (!isFinite(reference)) {
      return NaN;
    }
    return Math.floor(reference / MS_PER_DAY) * MS_PER_DAY;
  }

  /** A short label for an entry, for use inside a problem message. */
  function nameOf(event) {
    if (event && typeof event === 'object' && typeof event.title === 'string') {
      var title = event.title.trim();
      if (title.length > 0) {
        return title;
      }
    }
    return 'A night with no title';
  }

  function problem(event, message) {
    return { event: event, message: message };
  }

  /**
   * partition(events, now) -> { upcoming, past, problems, total }
   *
   *   upcoming  soonest first, today included
   *   past      most recent first
   *   problems  { event, message } for every entry that could not be read
   *   total     how many entries came in, so nothing can go missing silently
   *
   * Never throws. Never mutates the array it is given. The entries handed
   * back are the caller's own objects, not copies.
   */
  function partition(events, now) {
    var problems = [];

    if (!Array.isArray(events)) {
      problems.push(
        problem(null,
          'The dates could not be read. content/events.js should set ' +
          'window.LUVIZ.events to a list in square brackets.')
      );
      return { upcoming: [], past: [], problems: problems, total: 0 };
    }

    var today = startOfDay(now);
    if (!isFinite(today)) {
      /* A caller with no usable clock still gets its dates, in date order. */
      today = Infinity;
    }

    var upcoming = [];
    var past = [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];

      if (!event || typeof event !== 'object') {
        problems.push(
          problem(
            { title: 'Entry ' + (i + 1) },
            'Entry ' + (i + 1) + ' in content/events.js is not a block in curly ' +
            'brackets. Each night looks like { title: ..., date: ..., venue: ..., city: ... }.'
          )
        );
        continue;
      }

      var stamp = dayStamp(event.date);
      if (isNaN(stamp)) {
        problems.push(
          problem(
            event,
            nameOf(event) + ' has a date the page cannot read' +
            (event.date === undefined ? ' (there is no date line at all)' : ': "' + String(event.date) + '"') +
            '. Dates are written as YYYY-MM-DD, for example \'2026-09-19\'. ' +
            'This night is not shown until that is fixed.'
          )
        );
        continue;
      }

      /* index rides along so equal dates keep the order they were written in */
      var entry = { event: event, stamp: stamp, index: i };
      if (stamp >= today) {
        upcoming.push(entry);
      } else {
        past.push(entry);
      }
    }

    upcoming.sort(function (a, b) {
      return a.stamp - b.stamp || a.index - b.index;
    });
    past.sort(function (a, b) {
      return b.stamp - a.stamp || a.index - b.index;
    });

    function unwrap(list) {
      var out = [];
      for (var j = 0; j < list.length; j++) {
        out.push(list[j].event);
      }
      return out;
    }

    return {
      upcoming: unwrap(upcoming),
      past: unwrap(past),
      problems: problems,
      total: events.length
    };
  }

  /**
   * formatDate('2027-09-19') -> the parts a date needs on the page.
   * Pure, so the view layer never does date arithmetic of its own.
   */
  function formatDate(value) {
    var stamp = dayStamp(value);
    if (isNaN(stamp)) {
      return {
        ok: false,
        iso: '',
        day: '--',
        month: 'TBC',
        year: '',
        weekday: '',
        long: 'Date to be confirmed'
      };
    }
    var date = new Date(stamp);
    var day = date.getUTCDate();
    var monthName = MONTHS_LONG[date.getUTCMonth()];
    var dayName = DAYS_LONG[date.getUTCDay()];
    return {
      ok: true,
      iso: String(value),
      day: String(day),
      month: monthName.slice(0, 3).toUpperCase(),
      year: String(date.getUTCFullYear()),
      weekday: dayName.slice(0, 3).toUpperCase(),
      long: dayName + ' ' + day + ' ' + monthName + ' ' + date.getUTCFullYear()
    };
  }

  LUVIZ.eventsModel = {
    MS_PER_DAY: MS_PER_DAY,
    dayStamp: dayStamp,
    startOfDay: startOfDay,
    partition: partition,
    formatDate: formatDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
