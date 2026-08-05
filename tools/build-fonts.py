#!/usr/bin/env python3
"""Build the five served Mark Pro web faces from the licensed desktop OTFs.

    python tools/build-fonts.py

Reads   : "FF Mark Pro/" (gitignored, desktop-licensed - KTD8)
Writes  : assets/fonts/*.woff2 (committed, these are what the site serves)

Run it from anywhere; paths are resolved from this file, not the shell's
working directory. It is idempotent: a face whose bytes are unchanged is left
on disk untouched, so re-running never churns mtimes or the git index.

WHY THE BUILD LOOKS LIKE THIS
-----------------------------
The subset is Latin PLUS the Polish, Czech, Slovak, Hungarian, Turkish and
Romanian characters that European names are spelled with. That second half is
not a nicety, it is the entire reason this face set was chosen.

Mark OT was excluded (KTD7) because it carries only 13 of the 128 Latin
Extended-A characters, so a Polish, Czech, Turkish or Romanian crew name set
in an OT face would drop to a system font at the loudest typographic moment.
Mark Pro was picked to fix exactly that. A Latin-only subset would then throw
that benefit straight back away: it stops at Latin-1, so Cafe and Bjork
survive but Zazolc and Stefan still fall back. Shipping Latin-only would have
meant paying for a decision and then discarding what it bought.

So the shipped subset covers 297 codepoints per face for 89,876 bytes, and
still leaves better than 10KB of headroom under R25's 100,000 byte budget.
The two wider alternatives were both rejected on measurement: all of Latin
Extended-A fits by eight bytes, which is not a budget, and Extended-A plus
Extended-B costs 105,408 and busts R25 outright. See the table beside
EUROPEAN_NAME_UNICODES below for the full comparison.

Name IDs 7, 13 and 14 (trademark, licence description, licence URL) are kept
deliberately. Every supplied file carries OS/2 fsType = 4 and a nameID 14
pointing at the FontFont desktop EULA. The owner's web-serving licence is an
open question; stripping the licence strings would remove the evidence of
what these files are while that question stands. Never drop 7, 13 or 14.

Layout features are requested by name rather than with --layout-features='*',
which more than doubles the output on this family for features the design
never uses. --desubroutinize is not passed: this CFF has zero subrs, so it is
a verified no-op here.

CFF outlines are kept as CFF. Converting to TrueType is a lossy curve refit of
a licensed display face and buys nothing measurable at this size.

recalc_timestamp is off, so head.modified is carried through from the source
and two runs of this script produce byte-identical files.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NoReturn

# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "FF Mark Pro"
OUTPUT_DIR = REPO_ROOT / "assets" / "fonts"

#: R25. The combined payload of every generated face must stay under this.
TOTAL_BUDGET = 100_000

#: Matches the per-face ceiling asserted in tests/fontbudget.test.js.
PER_FACE_LIMIT = 20 * 1024

#: The five served faces. All Mark Pro; Mark OT is not built (KTD7).
#: `italic` is the expected style, verified below against post.italicAngle.
#: head.macStyle is 0 on every one of these files, so macStyle can never be
#: used to tell the italics apart - only the italic angle is truthful here.
FACES = (
    {"source": "FontFont_FF.Mark.Pro.Hairline.otf",     "out": "mark-250.woff2",  "weight": 250, "italic": False},
    {"source": "FontFont_FF.Mark.Pro.otf",              "out": "mark-400.woff2",  "weight": 400, "italic": False},
    {"source": "FontFont_FF.Mark.Pro.Bold.otf",         "out": "mark-700.woff2",  "weight": 700, "italic": False},
    {"source": "FontFont_FF.Mark.Pro.Medium.Italic.otf", "out": "mark-500i.woff2", "weight": 500, "italic": True},
    {"source": "FontFont_FF.Mark.Pro.Heavy.Italic.otf",  "out": "mark-800i.woff2", "weight": 800, "italic": True},
)

#: Half one of the subset: Basic Latin, Latin-1 Supplement, the handful of
#: marks and punctuation real web copy uses, the euro, the replacement char.
LATIN_UNICODES = ",".join(
    (
        "U+0000-00FF",
        "U+0131",
        "U+0152-0153",
        "U+02BB-02BC",
        "U+02C6",
        "U+02DA",
        "U+02DC",
        "U+0304",
        "U+0308",
        "U+0329",
        "U+2000-206F",
        "U+20AC",
        "U+2122",
        "U+2191",
        "U+2193",
        "U+2212",
        "U+2215",
        "U+FEFF",
        "U+FFFD",
    )
)

#: Half two: exactly the characters Polish, Czech, Slovak, Hungarian, Turkish
#: and Romanian names are spelled with, and nothing else. This is the half
#: that makes choosing Mark Pro over Mark OT mean something. Costs 11,092
#: bytes over Latin-only.
#:
#: All four options measured on this exact build, five faces combined:
#:
#:   A  latin only                      78,784 bytes   236 cp
#:   B  latin + pl/cs/sk/hu/tr/ro        89,876 bytes   297 cp   SHIPPED
#:   C  latin + all Latin Extended-A     99,992 bytes   361 cp   fits by 8 bytes
#:   D  latin + Extended-A and -B       105,408 bytes   398 cp   BUSTS R25
#:
#: B is the only variant that both clears R25 with real headroom and actually
#: delivers the coverage KTD7 chose this family for. C is a trap: eight bytes
#: of headroom is not a budget, and one kerning change would blow it.
#:
#: Adding a language later means adding its characters HERE and re-running,
#: not switching to a broad range. Broad ranges are what busts the budget.
EUROPEAN_NAME_UNICODES = (
    "U+0104-0107,U+010C-0111,U+0118-011B,U+011E-011F,U+0130-0131,U+0139-013E,"
    "U+0141-0144,U+0147-0148,U+0150-0151,U+0154-0155,U+0158-015B,U+015E-0165,"
    "U+016E-0173,U+0179-017E,U+0218-021B"
)

#: What actually gets built.
SUBSET_UNICODES = LATIN_UNICODES + "," + EUROPEAN_NAME_UNICODES

#: Checked against every built face. One representative character per
#: language, plus two Latin-1 accents as a control. Written as codepoints
#: rather than literals so this file stays pure ASCII and cannot be broken by
#: an editor helpfully re-encoding it.
SPOT_CHECK_CODEPOINTS = (
    ("Polish z-dot",        0x017C),  # z-dot above, in Zazolc
    ("Polish l-stroke",     0x0142),  # l with stroke
    ("Polish c-acute",      0x0107),  # c with acute
    ("Polish a-ogonek",     0x0105),  # a with ogonek
    ("Czech c-caron",       0x010D),  # c with caron
    ("Czech r-caron",       0x0159),  # r with caron, the Dvorak one
    ("Slovak l-acute",      0x013A),  # l with acute
    ("Hungarian o-dbl",     0x0151),  # o with double acute
    ("Turkish g-breve",     0x011F),  # g with breve
    ("Turkish dotless i",   0x0131),  # dotless i
    ("Turkish dotted I",    0x0130),  # I with dot above
    ("Turkish s-cedilla",   0x015F),  # s with cedilla
    ("Romanian s-comma",    0x0219),  # s with comma below
    ("Romanian t-comma",    0x021B),  # t with comma below
    ("Latin-1 e-acute",     0x00E9),  # control: was covered before too
    ("Latin-1 n-tilde",     0x00F1),  # control: was covered before too
)

#: Only what the design uses.
#:   kern - pair kerning, non-negotiable on a geometric sans at display size
#:   calt - contextual alternates the family ships
#:   locl - localised forms, so a Romanian or Turkish name is set correctly
#:   case - case-sensitive punctuation for the all-caps labels
#:   cpsp - capital spacing, again for the all-caps labels
#:   tnum - tabular figures, so dates, running times and tracklist numbers
#:          line up in a column (css/type.css .t-numeric)
#: Mark/mkmk positioning is not requested: the Latin subset above carries
#: precomposed accented glyphs, so nothing needs a mark attached at runtime.
#: Measured on this family, Latin subset, all five faces combined:
#:   kern,calt,locl,case,cpsp         77,048 bytes
#:   the same plus tnum               78,784 bytes  <- what we ship
#:   --layout-features='*'           163,716 bytes  (2.1x, busts R25)
#: The family also carries smcp, c2sc, onum, frac and seven stylistic sets.
#: None of them are requested, because none of them are used. Adding one is a
#: design decision with a byte cost, not a default.
LAYOUT_FEATURES = "kern,calt,locl,case,cpsp,tnum"

#: Kept on top of pyftsubset's default 0-6.
#: 7 trademark, 8 manufacturer, 9 designer, 13 licence, 14 licence URL.
NAME_IDS = "7,8,9,13,14"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def fail(message: str) -> NoReturn:
    """Stop with a plain-English reason and a non-zero exit code."""
    print("\nFAILED: " + message, file=sys.stderr)
    raise SystemExit(1)


def check_sources() -> None:
    if not SOURCE_DIR.is_dir():
        fail(
            f"the source directory {SOURCE_DIR} does not exist.\n"
            "The licensed OTFs are gitignored (KTD8), so a fresh clone will not\n"
            "have them. The generated woff2 files in assets/fonts are committed;\n"
            "you only need this script when the faces themselves change."
        )
    missing = [f["source"] for f in FACES if not (SOURCE_DIR / f["source"]).is_file()]
    if missing:
        fail(
            "these source faces are missing from "
            + str(SOURCE_DIR)
            + ":\n  "
            + "\n  ".join(missing)
        )


def verify_style(source: Path, expect_italic: bool) -> float:
    """Confirm a face really is (or is not) italic, and return its angle.

    head.macStyle is 0 on every file in this family, so it reports every
    italic as upright. post.italicAngle is the only honest signal: -12 on the
    italics, 0 on the uprights. Getting this wrong would ship an upright face
    behind `font-style: italic` and the mistake would be invisible in code
    review, so it is checked rather than assumed.
    """
    from fontTools.ttLib import TTFont

    with TTFont(source, lazy=True) as font:
        angle = float(font["post"].italicAngle)
        mac_style = int(font["head"].macStyle)

    is_italic = angle != 0.0
    if is_italic != expect_italic:
        fail(
            f"{source.name} has italicAngle {angle} (macStyle {mac_style}), which "
            f"means it is {'italic' if is_italic else 'upright'}, but the build "
            f"table expects {'italic' if expect_italic else 'upright'}."
        )
    return angle


def verify_coverage(built: Path) -> int:
    """Confirm the built face really carries the European name characters.

    The subset request and the subset result are two different things: a typo
    in a range, or a future "let us just trim it a bit" edit, would silently
    take these back out and nobody would notice until a crew member with a
    Polish surname turned up on the site in Arial. Return the codepoint count.
    """
    from fontTools.ttLib import TTFont

    with TTFont(built) as font:
        cmap = font.getBestCmap()

    missing = [
        f"{name} U+{cp:04X}"
        for name, cp in SPOT_CHECK_CODEPOINTS
        if cp not in cmap
    ]
    if missing:
        fail(
            built.name
            + " is missing characters the subset is supposed to carry:\n  "
            + "\n  ".join(missing)
            + "\nCheck EUROPEAN_NAME_UNICODES."
        )
    return len(cmap)


def subset(source: Path, destination: Path) -> None:
    """Run pyftsubset over one face, writing woff2 to `destination`."""
    command = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(source),
        "--unicodes=" + SUBSET_UNICODES,
        "--layout-features=" + LAYOUT_FEATURES,
        "--name-IDs+=" + NAME_IDS,
        "--flavor=woff2",
        # Byte-reproducible output: keep the source timestamp and bounds.
        "--no-recalc-timestamp",
        "--no-recalc-bounds",
        "--output-file=" + str(destination),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        fail(
            "pyftsubset failed on "
            + source.name
            + "\n  command: "
            + " ".join(command)
            + "\n"
            + (result.stderr or result.stdout).strip()
        )


def human(size: int) -> str:
    return f"{size / 1024:.1f}KB"


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    check_sources()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Source : {SOURCE_DIR}")
    print(f"Output : {OUTPUT_DIR}")
    print(
        f"Subset : Latin + European name characters "
        f"({SUBSET_UNICODES.count(',') + 1} ranges)"
    )
    print(f"Feats  : {LAYOUT_FEATURES}")
    print(f"Names  : default 0-6 plus {NAME_IDS} (trademark and licence kept)")
    print()

    rows: list[tuple[str, int, str, float, int]] = []
    total = 0
    work_dir = Path(tempfile.mkdtemp(prefix="luviz-fonts-"))
    try:
        for face in FACES:
            source = SOURCE_DIR / face["source"]
            angle = verify_style(source, face["italic"])

            staged = work_dir / face["out"]
            subset(source, staged)
            covered = verify_coverage(staged)

            final = OUTPUT_DIR / face["out"]
            new_bytes = staged.read_bytes()
            if final.is_file() and final.read_bytes() == new_bytes:
                state = "unchanged"
            else:
                state = "written"
                final.write_bytes(new_bytes)

            size = len(new_bytes)
            total += size
            rows.append((face["out"], size, state, angle, covered))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    width = max(len(name) for name, _, _, _, _ in rows)
    print(f"{'face'.ljust(width)}  {'bytes':>7}  {'':>7}  angle  {'cp':>4}  state")
    for name, size, state, angle, covered in rows:
        over = "  OVER" if size > PER_FACE_LIMIT else ""
        print(
            f"{name.ljust(width)}  {size:>7}  {human(size):>7}  "
            f"{angle:>5.0f}  {covered:>4}  {state}{over}"
        )
    print(f"{'TOTAL'.ljust(width)}  {total:>7}  {human(total):>7}")
    print(f"{'BUDGET'.ljust(width)}  {TOTAL_BUDGET:>7}  {human(TOTAL_BUDGET):>7}  (R25)")
    print()

    oversized = [name for name, size, _, _, _ in rows if size > PER_FACE_LIMIT]
    if oversized:
        fail(
            "these faces exceed the "
            + str(PER_FACE_LIMIT)
            + " byte per-face ceiling: "
            + ", ".join(oversized)
        )

    if total >= TOTAL_BUDGET:
        fail(
            f"the combined payload is {total} bytes, over R25's {TOTAL_BUDGET} byte\n"
            "budget. The fixed resolution order is: drop the Hairline face first,\n"
            "then the Medium Italic. Never strip name IDs 7, 13 or 14 while the\n"
            "licence question is open."
        )

    print(f"OK. {len(rows)} faces, {total} bytes, {TOTAL_BUDGET - total} bytes under budget.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
