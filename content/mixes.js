/* ==========================================================================
   LUVIZMUSIC - mixes.js
   The recorded sets. One block in { curly brackets } per mix, in the order
   you want them to appear.
   --------------------------------------------------------------------------
   EVERY MIX BELOW IS INVENTED PLACEHOLDER CONTENT. The links point at
   addresses that do not exist yet. Paste in your real share links.
   --------------------------------------------------------------------------
   HOW TO EDIT THIS FILE SAFELY

   * To ADD a mix: copy one whole block from its opening { to its closing },
     including the comma after it, paste it in, and change the text.
     To REMOVE a mix, delete the whole block including its comma.
   * Change only the text between the 'single quotes', and the numbers in
     the beat grid.
   * NEVER change the labels on the left of the colons: title, provider,
     url, beatGrid, atMs, bpm, artwork, credit.
   * A missing quote breaks the whole file and the whole mixes section
     disappears. Every piece of text needs a quote at both ends. Write an
     apostrophe inside text as \' - for example: 'Ama\'s birthday set'.
   * The comma at the end of a line separates one item from the next. A
     trailing comma after the LAST mix is harmless. A MISSING comma between
     two mixes is not.

   THE FOUR THINGS EVERY MIX NEEDS

     title     What the mix is called.
     provider  Where it is hosted. Exactly one of these four words, in
               lower case and in quotes:
                 'soundcloud'  'youtube'  'mixcloud'  'file'
               Anything else and that mix will not play.
     url       For soundcloud / youtube / mixcloud: the normal share link you
               copy from the site, in quotes.
               For 'file': the path to an audio file you have put inside this
               website's folder, for example 'media/mixes/night-014.mp3'.
     (that is all that is required - everything below is optional)

   THE OPTIONAL EXTRAS

     artwork   Path to a cover image inside this website's folder, e.g.
               'assets/mixes/night-014.jpg'. Leave the line out and the mix
               shows a plain typographic panel instead.
     credit    Who uploaded it. SoundCloud requires the uploader to be
               credited, so keep it filled in for SoundCloud mixes.
     beatGrid  The tempo map, explained below.

   THE BEAT GRID (this is the one that makes the page pulse)

     The page pulses in time with the music. It cannot hear the music, so
     each mix has to tell it the tempo. That is the beat grid.

     Each entry says: "from this moment onwards, the tempo is this."
       atMs  how far into the mix that tempo starts, in MILLISECONDS
             (milliseconds = minutes x 60000. So 19 minutes = 1140000.)
             The first entry is almost always atMs: 0.
       bpm   the tempo in beats per minute, between 60 and 200.

     A DJ mix changes tempo, so add one entry per stretch. Getting a tempo
     slightly wrong slowly drifts out of time, so a rough map with several
     entries beats one precise number.

     Entries must be in order, earliest first.

     NO BEAT GRID AT ALL IS A VALID CHOICE. Leave the beatGrid line out and
     that mix simply does not pulse - the page stays still rather than
     pulsing at the wrong speed. See the Mixcloud entry below.
   ========================================================================== */

window.LUVIZ.mixes = [

  /* --- A SoundCloud mix with a full three-part tempo map. ---------------- */
  {
    title: 'Night 014 - Ama Dwomoh (Peak)',
    provider: 'soundcloud',
    url: 'https://soundcloud.com/luvizmusic/night-014-ama-dwomoh-peak',
    artwork: 'assets/mixes/night-014.jpg',
    credit: 'Uploaded by LUVIZMUSIC',
    beatGrid: [
      { atMs: 0, bpm: 118 },        /* opening stretch, 0 min in */
      { atMs: 1140000, bpm: 124 },  /* lifts at 19 min */
      { atMs: 2760000, bpm: 128 },  /* peak from 46 min */
    ],
  },

  /* --- A YouTube mix at one steady tempo the whole way through. ---------- */
  {
    title: 'Night 011 - Sister Freq (Closing)',
    provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=LUVIZplaceholder',
    artwork: 'assets/mixes/night-011.jpg',
    credit: 'Filmed by Teodor Balan',
    beatGrid: [
      { atMs: 0, bpm: 122 },        /* one entry = one tempo, start to finish */
    ],
  },

  /* --- A Mixcloud mix with NO beat grid: it plays, it does not pulse. ---- */
  {
    title: 'Panorama - System Test, 3am',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/luvizmusic/panorama-system-test-3am/',
    artwork: 'assets/mixes/system-test.jpg',
    credit: 'Uploaded by LUVIZMUSIC',
    /* No beatGrid line here on purpose - the tempo wanders too much to map. */
  },

  /* --- A mix hosted in this website's own folder. ------------------------ */
  {
    title: 'Warm Room - Opening Hour',
    provider: 'file',
    url: 'media/mixes/warm-room-opening-hour.mp3',
    artwork: 'assets/mixes/warm-room.jpg',
    credit: 'Recorded live at The Annexe',
    beatGrid: [
      { atMs: 0, bpm: 112 },
      { atMs: 900000, bpm: 120 },   /* picks up at 15 min */
    ],
  },

  /* --- The bare minimum a mix can be: title, provider, url. -------------- */
  {
    title: 'Night 009 - Teo (First Hour)',
    provider: 'soundcloud',
    url: 'https://soundcloud.com/luvizmusic/night-009-teo-first-hour',
  },

];

/* Leave this last line alone. It tells the page this file loaded correctly. */
window.LUVIZ._loaded('mixes');
