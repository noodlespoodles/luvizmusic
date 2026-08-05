# LUVIZMUSIC — session handoff, 2026-08-05

Written for whoever picks this up next, human or agent. The plan at
`docs/plans/2026-08-05-001-feat-luvizmusic-site-plan.md` is the authority for
what the site is. This file is only about where the work stopped.

## Start here

```
cd "Other dev/Luvizmusic"     # its own git repo, branch feat/luvizmusic-site, NO remote
node --test                    # 183 tests, from the repo root. NOT `node --test tests/`
PREVIEW-SITE.bat               # double-click, serves on localhost, opens a browser
```

Ben edits content in `content/*.js` and nowhere else. He does not read the
code. Verification and plain English are what earn trust here, so show
evidence rather than asserting things work.

## The headline

The site renders, the player works, the choreography runs. **Ben's standing
note is that the GSAP work is under-delivered against the brief**: "It looks
really good as it stands, but I think we can push it quite a lot further."
The original ask was maximalist, intricate, out-there. What exists is
tasteful and restrained by comparison. That is the main job next.

## Built

U0 iOS spike page, U1 skeleton and content model, U2 fonts, U3 visual system,
U4 page shell and nav and boot, U5 four-provider adapter, U6 player bar,
U7 beat clock and intensity signal, U8 scroll choreography, plus
`js/mix-art.js` (generated cover art) and `js/nav-transition.js`.

## Not built

- **U11, the influences wall.** The biggest missing piece and the most
  typographically ambitious. ~92 artist names in `content/influences.js`,
  planned in the plan's U11 section: names smear when the visitor moves,
  resolve when they stop, flash on the beat. An agent was mid-build at
  handover, so check whether `js/influences.js` and a `#influences` section
  exist before starting.
- **U9**, custom cursor, marquee with a real pause control, swipe rail,
  section effects.
- **U10**, the owner handbook. No em-dashes in it, that is a standing
  preference for anything shipped.

## Waiting on Ben, not on code

1. **Crew bios still describe invented people.** Names and photos are real;
   the words are mine, about fictional characters. One bio still needed a
   pronoun neutralised because of it.
2. **Beat sync is dead for embedded mixes — decided 2026-08-05, do not
   revisit.** Ben's mixes have non-static tempo that speeds up as the mix
   progresses, so no hand-typed tempo map can track them, and the page cannot
   hear a cross-origin embed to correct itself. The beat layer stays inert.
   The ONLY route to real sync is self-hosting a mix through the `file`
   provider, which is same-origin and can drive a genuine AnalyserNode.
   Everything else runs off scroll and pointer via the intensity signal,
   which already works and needs nothing from Ben.
3. **The iOS first-play spike has never been run on a real phone.** It is at
   `spike/ios-activation.html`, served over HTTP, with instructions in
   `spike/README.md`. This is the single largest unverified assumption in the
   build, and the fallback if it fails is architectural, not cosmetic.

## Traps that have already bitten

- **Content is duplicated between `content/site.js` and `index.html`** for the
  no-JS path. JS wins on a normal load. Ben edited the markup twice expecting
  it to show. Drift guards now fail loudly and name the right file — keep them.
- **Do not assert placeholder shape against real content in tests.** Three
  tests broke when real mixes arrived because they asserted "at least one mix
  has a beat grid" and "placeholders cover all four providers". Those belong
  on the validator with synthetic fixtures.
- **Never let an agent press play on a provider embed while verifying.** One
  did, and played music through Ben's speakers. Say so explicitly in agent
  prompts and pass `--mute-audio` when driving Chrome.
- **Worktree isolation is broken here.** Luvizmusic is a nested repo inside
  the `Documents` repo, so an isolated worktree checks out the wrong project.
  Run agents in the main checkout with disjoint file sets instead.

## Where the taste lives

The art direction is not "dark mode techno". It is print economy: two inks,
one stock, effects that could plausibly have been made on a photocopier, a
darkroom enlarger or a one-colour press. Kill glow, keep grain. The core
device is a fixed, never-degraded mark over a degrading field, borrowed from
Will Bankhead's Trilogy Tapes sleeves. H5's Super Discount barcode and
price-tag grammar is the rigid counterpoint that stops the maximalism
becoming soup. Ben's reference list resolved "Raph Doug" to Ruf Dug, whose own
site is deliberately raw GIF-era HTML — that is a permission slip, not a
constraint.
