/* ==========================================================================
   LUVIZMUSIC - mixes.js
   The recorded sets. One block in { curly brackets } per mix, in the order
   you want them to appear.
   --------------------------------------------------------------------------
   THESE ARE THE REAL MIXES, pulled from mixcloud.com/raboobi. The cover
   images have been downloaded into assets/mixes/ so the site does not depend
   on Mixcloud staying up to show them.
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
     pulsing at the wrong speed. None of the mixes below has one yet, so
     nothing pulses at the moment.
   ========================================================================== */

window.LUVIZ.mixes = [

  /* ------------------------------------------------------------------------
     THESE ARE REAL. Pulled from https://www.mixcloud.com/raboobi/ on
     2026-08-05, newest first.

     NO BEAT GRIDS YET. Without one a mix simply does not pulse, which is on
     purpose: a wrong tempo looks worse than no pulse at all, because the
     visuals drift out of time within a few minutes. To switch the pulsing on
     for a mix, add a beatGrid to it. See the example at the bottom of this
     file.
     ---------------------------------------------------------------------- */

  {
    title: 'Shadowmixer 0321',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/shadowmixer-0321/',
    artwork: 'assets/mixes/shadowmixer-0321.jpg',
    credit: 'raboobi on Mixcloud',  /* house */
  },

  {
    title: 'mAsTeR sTuDiO',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/master-studio/',
    artwork: 'assets/mixes/master-studio.jpg',
    credit: 'raboobi on Mixcloud',
  },

  {
    title: 'Merci B - Good Vibes Radio - 0919',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/merci-b-good-vibes-radio-0919/',
    credit: 'raboobi on Mixcloud',
  },

  {
    title: 'Knee',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/knee/',
    artwork: 'assets/mixes/knee.jpg',
    credit: 'raboobi on Mixcloud',
  },

  {
    title: 'E36',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/e36/',
    artwork: 'assets/mixes/e36.jpg',
    credit: 'raboobi on Mixcloud',  /* house */
  },

  {
    title: 'Boris is 40 yo',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/boris-is-40-yo/',
    artwork: 'assets/mixes/boris-is-40-yo.jpg',
    credit: 'raboobi on Mixcloud',  /* deep house, hip hop */
  },

  {
    title: 'Mac Banana 3',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/mac-banana-3/',
    credit: 'raboobi on Mixcloud',  /* house, deep house, jazz, hip hop, disco */
  },

  {
    title: 'Disco Delta Tango',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/disco-delta-tango/',
    artwork: 'assets/mixes/disco-delta-tango.jpg',
    credit: 'raboobi on Mixcloud',  /* disco */
  },

  {
    title: 'Mac Banana 001',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/mac-banana-001/',
    artwork: 'assets/mixes/mac-banana-001.jpg',
    credit: 'raboobi on Mixcloud',  /* jazz, house, funk, techno, hip hop */
  },

  {
    title: 'Nice party teaser mix',
    provider: 'mixcloud',
    url: 'https://www.mixcloud.com/raboobi/nice-party-teaser-mix/',
    artwork: 'assets/mixes/nice-party-teaser-mix.jpg',
    credit: 'raboobi on Mixcloud',
  },

  /* ------------------------------------------------------------------------
     OTHER PLACES YOU CAN HOST A MIX

     The site handles four hosts. Only Mixcloud is in use above. When you post
     a mix somewhere else, copy the matching block below, delete the comment
     markers wrapping it, and fill in your link.

     Worth knowing: a YouTube mix has to show a real, visible YouTube player,
     because YouTube's rules forbid hiding it. SoundCloud and Mixcloud can sit
     in the slim bar. A 'file' mix is an audio file you put in the site folder
     yourself, and it is the only kind that can never be taken down by anyone
     else.
     ---------------------------------------------------------------------- */

  /*
  {
    title: 'A mix hosted on SoundCloud',
    provider: 'soundcloud',
    url: 'https://soundcloud.com/your-name/your-mix',
    credit: 'Uploaded by LUVIZMUSIC',
  },

  {
    title: 'A mix hosted on YouTube',
    provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=REPLACE_ME',
  },

  {
    title: 'A mix you host yourself',
    provider: 'file',
    url: 'media/mixes/your-mix.mp3',
  },
  */

  /* ------------------------------------------------------------------------
     HOW TO MAKE A MIX PULSE IN TIME

     Add a beatGrid. It is a list of tempo changes. atMs is how many
     milliseconds into the mix the tempo changes, and bpm is the beats per
     minute from that point on. One minute is 60000 milliseconds.

     If the whole mix is one steady tempo, a single line is enough:

       beatGrid: [ { atMs: 0, bpm: 122 } ],

     If it moves through several tracks at different tempos, add a line each
     time it changes, in order:

       beatGrid: [
         { atMs: 0,       bpm: 118 },   // opens at 118
         { atMs: 1140000, bpm: 124 },   // lifts at 19 minutes
         { atMs: 2700000, bpm: 121 },   // settles at 45 minutes
       ],

     You do not have to be perfect. Being a beat or two out is fine. Being ten
     out is not, so if you are unsure, leave the beatGrid off entirely.
     ---------------------------------------------------------------------- */

];

if (window.LUVIZ._loaded) { window.LUVIZ._loaded('mixes'); }
