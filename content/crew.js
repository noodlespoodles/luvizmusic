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

window.LUVIZ.crew = [

  {
    name: 'Ama Dwomoh',
    alias: 'LUVIZ',
    bio:
      'Started the night in a rented rehearsal room with two decks and a borrowed sub. ' +
      'Plays the long middle stretch: disco edits into unquantised house, always on the beat, ' +
      'never on the nose.',
    photo: 'assets/crew/ama-dwomoh.jpg',
    links: [
      { label: 'SoundCloud', url: 'https://soundcloud.com/luviz' },
      { label: 'Instagram', url: 'https://instagram.com/luviz' },
    ],
  },

  {
    name: 'Ruben Castellanos',
    alias: 'PANORAMA',
    bio:
      'Sound engineer by trade, resident by accident. Tunes the room before every night ' +
      'and opens it once the tuning is done. Keeps a running list of records that only ' +
      'work on a properly aligned system.',
    photo: 'assets/crew/ruben-castellanos.jpg',
    links: [
      { label: 'Mixcloud', url: 'https://mixcloud.com/panorama' },
    ],
  },

  {
    name: 'Ines Okonkwo',
    alias: 'SISTER FREQ',
    bio:
      'Closes. Trained on gospel organ, which is audible about four hours in. ' +
      'Has never once played a record she could not explain the reason for.',
    photo: 'assets/crew/ines-okonkwo.jpg',
    links: [
      { label: 'Resident Advisor', url: 'https://ra.co/dj/sisterfreq' },
      { label: 'Bandcamp', url: 'https://sisterfreq.bandcamp.com' },
    ],
  },

  {
    name: 'Teodor Balan',
    alias: 'TEO',
    bio:
      'Lights, room layout, and the door. Believes a dance floor is a building material ' +
      'and treats it accordingly. Occasionally plays the first hour when nobody is looking.',
    photo: 'assets/crew/teodor-balan.jpg',
    links: [],
  },

];

/* Leave this last line alone. It tells the page this file loaded correctly. */
window.LUVIZ._loaded('crew');
