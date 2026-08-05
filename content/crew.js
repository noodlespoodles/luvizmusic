/* ==========================================================================
   LUVIZMUSIC - crew.js
   The residents. One block in { curly brackets } per person, in the order
   you want them to appear on the page.
   --------------------------------------------------------------------------
   EVERY PERSON BELOW IS INVENTED PLACEHOLDER CONTENT. Replace them.
   --------------------------------------------------------------------------
   HOW TO EDIT THIS FILE SAFELY

   * To ADD a person: copy one whole block from its opening { to its
     closing }, including the comma after it, paste it in, then change the
     text. To REMOVE a person, delete the whole block including its comma.
   * Change only the text between the 'single quotes'.
   * NEVER change the labels on the left of the colons: name, alias, bio,
     photo, links, label, url. The page looks for those exact words.
   * A missing quote breaks the whole file, and the crew section will not
     appear. Every piece of text needs a quote at both ends. Write an
     apostrophe inside text as \' - for example: 'Sunday\'s resident'.
   * The comma at the end of a line separates one item from the next.
     A trailing comma after the LAST person is harmless. A MISSING comma
     between two people is not.
   * photo is the path to a picture inside this website's folder. Put the
     file in assets/crew/ and write the path exactly as it appears here,
     with forward slashes. Landscape or square images around 1200px wide
     look best. If the file is not there, the page shows a plain panel
     instead - nothing breaks.
   * links can be an empty list [] if someone has no public profiles.
   ========================================================================== */

/* --------------------------------------------------------------------------
   THE PHOTOS ARE REAL. The BIOS ARE NOT: they still describe the invented
   people the site was scaffolded with, and only the names and photos have
   been swapped. Rewrite each bio in your own words when you get a chance.
   Nothing else needs changing when you do.
   -------------------------------------------------------------------------- */

window.LUVIZ.crew = [

  {
    name: 'Ben Vorster',
    alias: 'DJ Sync',
    bio:
      'Started the night in a rented rehearsal room with two decks and a borrowed sub. ' +
      'Plays the long middle stretch: disco edits into unquantised house, always on the beat, ' +
      'never on the nose.',
    photo: 'assets/crew/ben-vorster.jpg',
    links: [
      /* Add Ben's links here. */
    ],
  },

  {
    name: 'Greg Canning',
    alias: 'DJ Egg',
    bio:
      'Sound engineer by trade, resident by accident. Tunes the room before every night ' +
      'and opens it once the tuning is done. Keeps a running list of records that only ' +
      'work on a properly aligned system.',
    photo: 'assets/crew/greg-canning.jpg',
    links: [
      { label: 'SoundCloud', url: 'https://soundcloud.com/gregcanning' },
      { label: 'Bookings', url: 'mailto:info@onenationrecords.co.za' },
    ],
  },

  {
    name: 'Donovan Pugh',
    alias: 'DJ Kerry Gold',
    bio:
      'Closes. Trained on gospel organ, which is audible about four hours in. ' +
      'Has never once played a record they could not explain the reason for.',
    photo: 'assets/crew/donovan-pugh.jpg',
    links: [
      /* Add Donovan's links here. */
    ],
  },

];

/* Leave this last line alone. It tells the page this file loaded correctly. */
window.LUVIZ._loaded('crew');
