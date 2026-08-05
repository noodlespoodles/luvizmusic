# iOS activation test

This is a throwaway test page. It is not part of the site. It exists to answer one
question that decides how the music player has to work.

## The question

When you tap the play button on the site, the site has to send a "start playing"
message into the SoundCloud, YouTube, or Mixcloud box embedded in the page. Those
boxes belong to those companies, not to us, so the message has to cross a boundary.

On Android and on desktop this is fine. On an iPhone it might not be. Apple requires
that the play command happens in the same instant as your tap, and it is not written
down anywhere reliable whether that permission survives the trip across the boundary.

If it does not survive, a "try again" button is useless, because the second tap does
exactly the same thing and fails exactly the same way. The site would instead need to
show you SoundCloud's own play button for the first play, and take over afterwards.

This page tells us which of those two worlds we are in.

## How to run it

1. Double click `PREVIEW-SITE.bat` in the main project folder. A black window opens
   and prints an address, something like `http://localhost:8951/`.
2. That window must stay open. Note the address.
3. On your computer, find your local network address. Open the black window's printed
   address on the computer first to check the site is being served.
4. On your iPhone, connected to the same wifi, open your computer's network address
   followed by `/spike/ios-activation.html`.

The page must be opened over the network like this. Opening the file directly from
disk will not work, because the music services need a real web address to talk to.

## What to do

The page has three sections, one per music service. Each has a big PLAY button and a
big TAP AGAIN button. Everything the test learns is printed on the page itself, so you
never need to open any developer tools.

For each service:

1. Wait until its PLAY button stops being greyed out.
2. Tap PLAY once.
3. Write down whether sound started.
4. If it says BLOCKED, tap TAP AGAIN once, and write down whether sound started then.

Turn your volume up first. Silence and failure look the same otherwise.

## What to write down

| Service | Did PLAY start the sound? | If it was blocked, did TAP AGAIN work? |
| --- | --- | --- |
| SoundCloud | | |
| YouTube | | |
| Mixcloud | | |

## What the answers mean

**PLAY works on all three.** Best case. The player works as designed: one tap on our
own controls and the mix runs while you browse.

**PLAY is blocked but TAP AGAIN works.** The refusal is temporary, not permanent. The
retry button in the real player is a genuine fix and nothing needs redesigning.

**PLAY is blocked and TAP AGAIN is also blocked.** The permission does not survive the
trip. That service needs its own play button shown for the first play, after which our
controls take over. This is a real design change and it is much cheaper to know now
than after the whole site is built around the other answer.

**Results differ per service.** Entirely possible, and useful. Each service is handled
separately in the code, so one can use the fallback while the others do not.

## Note

The tracks embedded in this page are public uploads chosen only because they are
well known and unlikely to be deleted. They are not connected to LUVIZMUSIC and are
not a suggestion for the site. If one of them has been taken down by its uploader, that
service's section will fail to load, which is not the same as a blocked play. The page
shows a separate status for that case.
