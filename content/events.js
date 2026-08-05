/* ==========================================================================
   LUVIZMUSIC - events.js
   The dates. One block in { curly brackets } per night.
   --------------------------------------------------------------------------
   EVERY DATE BELOW IS INVENTED PLACEHOLDER CONTENT. Replace them.
   --------------------------------------------------------------------------
   HOW TO EDIT THIS FILE SAFELY

   * To ADD a night: copy one whole block from its opening { to its closing },
     including the comma after it, paste it in, and change the text.
     To REMOVE a night, delete the whole block including its comma.
   * You do NOT need to sort these. The page works out for itself which
     nights are still to come and which have already happened, and puts the
     soonest one first. Add new dates anywhere in the list.
   * You do NOT need to delete a night once it has passed. It moves into the
     past list on its own, the morning after.
   * NEVER change the labels on the left of the colons: title, date, venue,
     city, ticketUrl.
   * A missing quote breaks the whole file and the whole events section
     disappears. Every piece of text needs a quote at both ends. Write an
     apostrophe inside text as \' - for example: 'New Year\'s Eve'.
   * The comma at the end of a line separates one item from the next. A
     trailing comma after the LAST night is harmless. A MISSING comma
     between two nights is not.

   THE DATE FORMAT MATTERS

     date must be written as 'YYYY-MM-DD' - four-digit year, two-digit
     month, two-digit day, in that order, with dashes, inside quotes.

       RIGHT:  date: '2026-09-19',
       WRONG:  date: '19/09/2026',
       WRONG:  date: '19 September 2026',
       WRONG:  date: 2026-09-19,        (no quotes)

     Anything else and that night is reported as an error instead of shown.
     For a night that runs past midnight, use the date it STARTS.

   ticketUrl is optional. Leave the line out entirely for a night that has
   no tickets on sale (past nights, free nights, or one not yet announced).
   ========================================================================== */

window.LUVIZ.events = [

  /* ---- Still to come ---------------------------------------------------- */

  {
    title: 'Night 015 - All Residents',
    date: '2026-08-22',
    venue: 'The Annexe',
    city: 'London',
    ticketUrl: 'https://tickets.example/luvizmusic/night-015',
  },

  {
    title: 'Night 016 - Sister Freq b2b Panorama',
    date: '2026-09-19',
    venue: 'Bath House',
    city: 'Bristol',
    ticketUrl: 'https://tickets.example/luvizmusic/night-016',
  },

  {
    title: 'Night 017 - Nine Hours, One Room',
    date: '2026-10-24',
    venue: 'The Annexe',
    city: 'London',
    ticketUrl: 'https://tickets.example/luvizmusic/night-017',
  },

  {
    title: 'Night 018 - Year End',
    date: '2026-12-12',
    venue: 'Corn Exchange Basement',
    city: 'Manchester',
    /* No ticketUrl yet - tickets are not on sale. */
  },

  /* ---- Already happened (kept for the archive) -------------------------- */

  {
    title: 'Night 014 - Ama Dwomoh (Peak)',
    date: '2026-07-18',
    venue: 'The Annexe',
    city: 'London',
  },

  {
    title: 'Night 013 - Warm Room',
    date: '2026-06-27',
    venue: 'Bath House',
    city: 'Bristol',
  },

  {
    title: 'Night 012 - Sound System Rebuild',
    date: '2026-05-30',
    venue: 'The Annexe',
    city: 'London',
  },

  {
    title: 'Night 011 - Sister Freq (Closing)',
    date: '2026-04-18',
    venue: 'Corn Exchange Basement',
    city: 'Manchester',
  },

];

/* Leave this last line alone. It tells the page this file loaded correctly. */
window.LUVIZ._loaded('events');
