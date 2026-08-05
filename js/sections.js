/* ==========================================================================
   LUVIZMUSIC - sections.js
   --------------------------------------------------------------------------
   THE BROWSER HALF OF THE PAGE. It turns the content files into markup and
   nothing else: no clock of its own, no partition rule, no player, no
   motion. The rule that decides which night is upcoming lives in the pure
   js/events-model.js so it can be tested without a browser (KTD15); this
   file is the thin DOM layer over it, verified by looking at the page.

   FOUR THINGS IT GUARANTEES

   1. NOTHING IS BUILT FROM A STRING. Every node is created with
      createElement and every piece of owner copy is set as textContent, so a
      stray angle bracket in content/crew.js prints as an angle bracket
      instead of becoming markup.

   2. EVERY SECTION HAS AN EMPTY STATE, and it is a printed notice rather
      than a blank space. "No upcoming events" is the steady state of this
      site between parties; it has to look like a decision.

   3. A MISSING IMAGE NEVER PRINTS A BROKEN GLYPH. Every photo and every
      cover gets an error handler that swaps the card to a ruled type-only
      tile - including the cached-failure case, which fires no error event.

   4. EACH RENDERER FAILS ALONE. They are called one at a time from
      js/app.js inside their own try/catch, so one bad content file cannot
      blank the other four sections (R9a).
   ========================================================================== */

(function (global) {
  'use strict';

  var document = global.document;
  var LUVIZ = global.LUVIZ || (global.LUVIZ = {});

  /* How a provider key is spelled where a visitor can see it. */
  var PROVIDER_LABELS = {
    soundcloud: 'SoundCloud',
    youtube: 'YouTube',
    mixcloud: 'Mixcloud',
    file: 'Hosted here'
  };

  /* ------------------------------------------------------------------
     Small DOM helpers. Deliberately tiny: this is not a framework.
     ------------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function isFilled(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function twoDigits(number) {
    return (number < 10 ? '0' : '') + number;
  }

  /** The initials a type-only tile prints when a photo does not arrive. */
  function initialsOf(name) {
    var words = String(name || '').trim().split(/\s+/);
    var letters = '';
    for (var i = 0; i < words.length && letters.length < 2; i++) {
      if (words[i]) {
        letters += words[i].charAt(0).toUpperCase();
      }
    }
    return letters || '?';
  }

  /* ------------------------------------------------------------------
     Missing media (R9a's sibling: a mistyped path is owner error too)
     ------------------------------------------------------------------ */

  /**
   * Replace a duotone figure's contents with a ruled type-only tile.
   * The whole tile is decorative: the name it stands for is printed
   * immediately below it, so repeating it to a screen reader adds noise.
   */
  function fallbackTile(figure, label) {
    clear(figure);
    figure.classList.remove('duotone', 'duotone--bright', 'duotone--bone');
    figure.classList.add('media--fallback');
    figure.setAttribute('aria-hidden', 'true');

    /* A cover drawn from the title, rather than a tile announcing an absence.
       Deterministic, so it does not change under the visitor between visits.
       js/mix-art.js is loaded before this file; the type-only tile below is
       the fallback's fallback if it ever is not. */
    var art = window.LUVIZ && window.LUVIZ.mixArt;
    if (art && typeof art.cover === 'function') {
      var img = el('img');
      img.className = 'media__img media__img--generated';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.src = art.cover(label).dataUri;
      figure.appendChild(img);
      return;
    }

    figure.appendChild(el('span', 'media__initials', initialsOf(label)));
    figure.appendChild(el('span', 'media__note', 'No picture yet'));
  }

  /**
   * A duotone figure holding an image that may or may not exist.
   * `path` may be empty, in which case the tile is used straight away.
   */
  function mediaFigure(path, label, classes) {
    var figure = el('figure', classes);

    if (!isFilled(path)) {
      fallbackTile(figure, label);
      return figure;
    }

    var img = el('img');
    img.className = 'media__img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';

    /* The error handler is attached BEFORE src is set, so a path that fails
       instantly cannot beat us to it. */
    img.onerror = function () {
      fallbackTile(figure, label);
    };
    img.onload = function () {
      /* Some engines report a decode failure as a load with no pixels. */
      if (img.naturalWidth === 0) {
        fallbackTile(figure, label);
      }
    };

    img.src = path;
    figure.appendChild(img);

    /* A cached 404 can have finished before this line runs and fires no
       event at all, which is exactly how a broken glyph gets on the page. */
    if (img.complete && img.naturalWidth === 0) {
      fallbackTile(figure, label);
    }

    return figure;
  }

  /* ------------------------------------------------------------------
     Shared furniture
     ------------------------------------------------------------------ */

  /**
   * The printed notice a section shows when it has nothing to list.
   * H5 retail grammar: a double-ruled box, a red label, the line that says
   * what happens next, and a barcode. Not an error, not an absence.
   */
  function emptyState(label, line, note) {
    var box = el('div', 'empty rule-box rule-box--thick rule-box--double');
    box.appendChild(el('p', 'empty__label', label));
    box.appendChild(el('p', 'empty__line', line));
    if (note) {
      box.appendChild(el('p', 'empty__note', note));
    }
    var barcode = el('span', 'barcode');
    barcode.setAttribute('aria-hidden', 'true');
    box.appendChild(barcode);
    return box;
  }

  /** Shown in place of a list whose content file did not load (R9a). */
  function unavailableState(file) {
    return emptyState(
      'Not loaded',
      'This list could not be read.',
      file + ' did not load, so this section is empty. The notice at the top ' +
      'of the page says what to do about it. Everything else still works.'
    );
  }

  function linkRow(links, className) {
    if (!Array.isArray(links) || links.length === 0) {
      return null;
    }
    var list = el('ul', className || 'link-row');
    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      if (!isFilled(link.label) || !isFilled(link.url)) {
        continue;
      }
      var item = el('li');
      var anchor = el('a', null, link.label);
      anchor.href = link.url;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      item.appendChild(anchor);
      list.appendChild(item);
    }
    return list.childNodes.length ? list : null;
  }

  /* ==================================================================
     HERO
     ================================================================== */

  function renderHero(site) {
    if (!site || typeof site !== 'object') {
      /* Leave the static copy in index.html standing: it is the same words,
         and a visitor should never see the hero go blank. */
      return false;
    }

    var tagline = byId('hero-tagline');
    if (tagline && isFilled(site.tagline)) {
      tagline.textContent = site.tagline;
    }

    var blurb = byId('hero-blurb');
    if (blurb && isFilled(site.blurb)) {
      blurb.textContent = site.blurb;
    }

    return true;
  }

  /* ==================================================================
     CREW
     ================================================================== */

  function crewCard(member, index) {
    var card = el('li', 'crew-card reveal');
    card.setAttribute('data-crew-index', String(index));

    card.appendChild(
      mediaFigure(member.photo, member.name, 'crew-card__figure media duotone')
    );

    /* Layered type by grid overlap: the ghost numeral and the name share one
       grid cell, so source order and reflow survive. The numeral is
       decoration and says so. */
    var nameplate = el('div', 'crew-card__nameplate layer-stack');
    var numeral = el('span', 'crew-card__index', twoDigits(index + 1));
    numeral.setAttribute('aria-hidden', 'true');
    nameplate.appendChild(numeral);
    nameplate.appendChild(el('h3', 'crew-card__name', member.name));
    card.appendChild(nameplate);

    if (isFilled(member.alias)) {
      var alias = el('p', 'crew-card__alias');
      alias.appendChild(el('span', 'chip chip--bright', member.alias));
      card.appendChild(alias);
    }

    if (isFilled(member.bio)) {
      card.appendChild(el('p', 'crew-card__bio', member.bio));
    }

    var links = linkRow(member.links);
    if (links) {
      card.appendChild(links);
    }

    return card;
  }

  function renderCrew(crew) {
    var list = byId('crew-list');
    if (!list) {
      return false;
    }
    clear(list);

    if (crew === undefined) {
      list.appendChild(unavailableState('content/crew.js'));
      return false;
    }

    if (!Array.isArray(crew) || crew.length === 0) {
      list.appendChild(
        emptyState(
          'Line-up to come',
          'The residents for this run are not announced yet.',
          'Names go up once the room and the system are confirmed.'
        )
      );
      return true;
    }

    for (var i = 0; i < crew.length; i++) {
      var member = crew[i];
      if (!member || typeof member !== 'object') {
        continue;
      }
      list.appendChild(crewCard(member, i));
    }
    return true;
  }

  /* ==================================================================
     MIXES
     ================================================================== */

  function mixCard(mix, index) {
    var card = el('li', 'mix-card reveal');
    card.setAttribute('data-mix-index', String(index));
    if (isFilled(mix.provider)) {
      card.setAttribute('data-provider', mix.provider);
    }

    card.appendChild(
      mediaFigure(mix.artwork, mix.title, 'mix-card__figure media media--square duotone duotone--bright')
    );

    var meta = el('div', 'mix-card__meta');
    var providerLabel = PROVIDER_LABELS[mix.provider] || mix.provider || 'Unknown';
    meta.appendChild(el('span', 'chip chip--bone', providerLabel));

    /* A mix with a beat grid is one the page can pulse in time with. */
    if (LUVIZ.validate && LUVIZ.validate.pulses(mix)) {
      meta.appendChild(el('span', 'chip chip--bright', mix.beatGrid[0].bpm + ' BPM'));
    }
    card.appendChild(meta);

    card.appendChild(el('h3', 'mix-card__title', mix.title));

    if (isFilled(mix.credit)) {
      card.appendChild(el('p', 'mix-card__credit', mix.credit));
    }

    /*
      U6 and U7 hang the player bar off data-mix-index above. Until then this
      link is the honest thing to ship: it works with no player, no embed and
      no JavaScript beyond this render, and it never autoplays anything.
    */
    if (isFilled(mix.url)) {
      var row = el('ul', 'link-row');
      var item = el('li');
      var anchor = el('a', null,
        mix.provider === 'file' ? 'Open the recording' : 'Open on ' + providerLabel);
      anchor.href = mix.url;
      anchor.rel = 'noopener noreferrer';
      if (mix.provider !== 'file') {
        anchor.target = '_blank';
      }
      item.appendChild(anchor);
      row.appendChild(item);
      card.appendChild(row);
    }

    return card;
  }

  function renderMixes(mixes) {
    var list = byId('mix-list');
    if (!list) {
      return false;
    }
    clear(list);

    if (mixes === undefined) {
      list.appendChild(unavailableState('content/mixes.js'));
      return false;
    }

    if (!Array.isArray(mixes) || mixes.length === 0) {
      list.appendChild(
        emptyState(
          'Shelf empty',
          'No mixes are posted right now.',
          'Sets go up after the night they were recorded on, unedited, ' +
          'with whatever the room did to them.'
        )
      );
      return true;
    }

    for (var i = 0; i < mixes.length; i++) {
      var mix = mixes[i];
      if (!mix || typeof mix !== 'object') {
        continue;
      }
      list.appendChild(mixCard(mix, i));
    }
    return true;
  }

  /* ==================================================================
     EVENTS
     ================================================================== */

  function eventRow(event, model) {
    var row = el('li', 'event reveal');
    var when = model.formatDate(event.date);

    var plate = el('p', 'event__plate price-tag');
    plate.appendChild(el('span', 'event__day', when.day));
    plate.appendChild(document.createTextNode(' '));
    plate.appendChild(el('span', 'event__month', when.month + ' ' + when.year));
    row.appendChild(plate);

    var body = el('div', 'event__body');
    body.appendChild(el('h4', 'event__title', event.title));

    var where = el('p', 'event__where');
    var whereParts = [];
    if (isFilled(event.venue)) { whereParts.push(event.venue); }
    if (isFilled(event.city)) { whereParts.push(event.city); }
    /* The full date is spelled out here so a screen reader is not left to
       guess at "22 AUG 2026" from the plate. */
    where.textContent = whereParts.join(', ') + (when.ok ? ' · ' + when.long : '');
    body.appendChild(where);
    row.appendChild(body);

    var action = el('p', 'event__action');
    if (isFilled(event.ticketUrl)) {
      var anchor = el('a', null, 'Tickets');
      anchor.href = event.ticketUrl;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      /* "Tickets" four times over is uselessly ambiguous out of context. */
      anchor.setAttribute('aria-label', 'Tickets for ' + event.title);
      action.appendChild(anchor);
    } else {
      action.appendChild(el('span', 'event__pending', 'Not on sale yet'));
    }
    row.appendChild(action);

    return row;
  }

  function eventGroup(title, events, model) {
    var group = el('div', 'events__group');
    group.appendChild(el('h3', 'events__group-title', title));
    var list = el('ul', 'event-list');
    for (var i = 0; i < events.length; i++) {
      list.appendChild(eventRow(events[i], model));
    }
    group.appendChild(list);
    return group;
  }

  function renderEvents(events, now) {
    var root = byId('events-lists');
    if (!root) {
      return false;
    }
    clear(root);

    if (events === undefined) {
      root.appendChild(unavailableState('content/events.js'));
      return false;
    }

    var model = LUVIZ.eventsModel;
    if (!model) {
      root.appendChild(unavailableState('js/events-model.js'));
      return false;
    }

    var split = model.partition(events, now);

    if (split.upcoming.length > 0) {
      root.appendChild(eventGroup('Still to come', split.upcoming, model));
    } else {
      /*
        THE STEADY STATE. Between parties this is what the page says, and it
        has to read as a printed notice rather than as a gap.
      */
      var group = el('div', 'events__group');
      group.appendChild(el('h3', 'events__group-title', 'Still to come'));
      group.appendChild(
        emptyState(
          'No dates on sale',
          'The next night is announced here first.',
          'A date goes up the day the room is confirmed. Nothing is held ' +
          'back for a mailing list.'
        )
      );
      root.appendChild(group);
    }

    if (split.past.length > 0) {
      root.appendChild(eventGroup('Been and gone', split.past, model));
    }

    /* An unreadable date is named on the page, never silently dropped. */
    if (split.problems.length > 0) {
      var box = el('div', 'events__problems rule-box rule-box--thin');
      box.appendChild(el('p', 'empty__label', 'Dates that need fixing'));
      var list = el('ul');
      for (var i = 0; i < split.problems.length; i++) {
        list.appendChild(el('li', null, split.problems[i].message));
      }
      box.appendChild(list);
      root.appendChild(box);
    }

    return true;
  }

  /* ==================================================================
     CONTACT
     ================================================================== */

  function renderContact(site) {
    var list = byId('contact-links');
    var email = byId('contact-email');

    if (site && isFilled(site.contactEmail) && email) {
      email.textContent = site.contactEmail;
      email.href = 'mailto:' + site.contactEmail;
    }

    if (!list) {
      return false;
    }
    clear(list);

    if (!site || typeof site !== 'object') {
      list.appendChild(unavailableState('content/site.js'));
      return false;
    }

    var links = site.socialLinks;
    if (!Array.isArray(links) || links.length === 0) {
      return true; /* The email above is the contact; no notice needed. */
    }

    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      if (!isFilled(link.label) || !isFilled(link.url)) {
        continue;
      }
      var item = el('li');
      var anchor = el('a', 'chip chip--deep', link.label);
      anchor.href = link.url;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      item.appendChild(anchor);
      list.appendChild(item);
    }
    return true;
  }

  /* ==================================================================
     THE CONTENT ALERT (R9a)
     ==================================================================
     One notice, naming every file that failed and every entry that does
     not validate, in words an owner can act on. It never blames the
     visitor and it always says the rest of the page still works.
     ================================================================== */

  function renderAlert(report) {
    var box = byId('content-alert');
    if (!box) {
      return false;
    }
    clear(box);

    var missing = (report && report.missing) || [];
    var errors = (report && report.errors) || [];
    var broken = (report && report.broken) || [];

    if (missing.length === 0 && errors.length === 0 && broken.length === 0) {
      box.hidden = true;
      return false;
    }

    box.appendChild(el('p', 'content-alert__title', 'Some content did not load'));

    var i;

    for (i = 0; i < missing.length; i++) {
      box.appendChild(
        el('p', null,
          'content/' + missing[i] + '.js did not load. It usually means a ' +
          'missing quote or comma. The rest of the site is still shown.')
      );
    }

    for (i = 0; i < broken.length; i++) {
      box.appendChild(el('p', null, broken[i]));
    }

    if (missing.length > 0 && LUVIZ.missingMessage) {
      box.appendChild(el('p', null, LUVIZ.missingMessage()));
    }

    if (errors.length > 0) {
      box.appendChild(el('p', null, 'Some entries need fixing:'));
      var list = el('ul', 'content-alert__list');
      for (i = 0; i < errors.length; i++) {
        list.appendChild(el('li', null, errors[i]));
      }
      box.appendChild(list);
    }

    box.hidden = false;
    return true;
  }

  LUVIZ.sections = {
    PROVIDER_LABELS: PROVIDER_LABELS,
    hero: renderHero,
    crew: renderCrew,
    mixes: renderMixes,
    events: renderEvents,
    contact: renderContact,
    alert: renderAlert
  };
})(typeof window !== 'undefined' ? window : globalThis);
