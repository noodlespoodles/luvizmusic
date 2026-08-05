/* ==========================================================================
   LUVIZMUSIC - site.js
   The words that appear in the hero (top of the page) and in the contact
   section at the bottom.
   --------------------------------------------------------------------------
   EVERYTHING BELOW IS PLACEHOLDER TEXT. The night, the people and the
   addresses are invented. Replace them with the real thing before launch.
   --------------------------------------------------------------------------
   HOW TO EDIT THIS FILE SAFELY

   * Change only the text between the 'single quotes'. That is your copy.
   * NEVER change the words on the left of a colon (tagline, blurb,
     contactEmail, socialLinks). Those are the labels the site looks for.
     Rename one and that piece of the page goes blank.
   * NEVER delete the first line (window.LUVIZ.site = {) or the last two
     lines. They are the wrapper that hands your words to the page.
   * A missing quote breaks the whole file. Every piece of text needs a quote
     at the START and a quote at the END. If your text contains an
     apostrophe, write it as \' - for example: 'the night\'s last record'.
   * The comma at the end of each line separates one item from the next.
     A trailing comma after the LAST item in a list is fine and harmless -
     browsers ignore it. A MISSING comma between two items is not fine.
   * If something goes wrong, double-click CHECK-CONTENT.bat. It tells you
     the file and the line number.
   ========================================================================== */

window.LUVIZ.site = {

  /* One line, under the wordmark. Keep it short - it is set very large. */
  tagline: 'Nine hours, one room, no encores.',

  /* A short paragraph. Two or three sentences reads best. */
  blurb:
    'LUVIZMUSIC is a roaming night in the Paradise Garage lineage: ' +
    'long sets, loud lows, and a floor that is treated as an instrument. ' +
    'No guest-list theatre, no phones at the front, no records played to be filmed.',

  /* Bookings and press go here. It becomes a clickable mailto link. */
  contactEmail: 'bookings@luvizmusic.example',

  /* The buttons in the contact section.
     Add a line to add a button. Delete a line to remove one.
     Each one needs a label (what people read) and a url (where it goes).
     Every url must start with https:// */
  socialLinks: [
    { label: 'Instagram', url: 'https://instagram.com/luvizmusic' },
    { label: 'SoundCloud', url: 'https://soundcloud.com/luvizmusic' },
    { label: 'Mixcloud', url: 'https://mixcloud.com/luvizmusic' },
    { label: 'Resident Advisor', url: 'https://ra.co/promoters/luvizmusic' },
  ],

};

/* Leave this last line alone. It tells the page this file loaded correctly. */
window.LUVIZ._loaded('site');
