'use strict';

/**
 * U2 font-budget and type-system tests.
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * This suite reads the COMMITTED artefacts only. It never shells out to
 * Python and never rewrites a generated file, so it stays fast, offline, and
 * safe to run on a checkout that has no licensed OTFs in it. Reproducibility
 * of the build is checked by hand (re-run tools/build-fonts.py and diff), not
 * here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const CSS_DIR = path.join(ROOT, 'css');
const TYPE_CSS = path.join(CSS_DIR, 'type.css');

/** The five served faces, all from Mark Pro. Mark OT is deliberately absent. */
const EXPECTED_FACES = [
  { file: 'mark-250.woff2', weight: '250', style: 'normal' },
  { file: 'mark-400.woff2', weight: '400', style: 'normal' },
  { file: 'mark-700.woff2', weight: '700', style: 'normal' },
  { file: 'mark-500i.woff2', weight: '500', style: 'italic' },
  { file: 'mark-800i.woff2', weight: '800', style: 'italic' },
];

/** R25: total web font payload stays under 100KB. */
const TOTAL_BUDGET = 100000;

/**
 * Per-face ceiling. Five faces under 20KB each cannot exceed 100KB, so this
 * is the strictest bound consistent with R25 and catches a single face
 * regressing (an accidental Latin-Extended subset, or --layout-features='*')
 * long before the combined total notices.
 */
const PER_FACE_LIMIT = 20 * 1024;

/**
 * Characters the subset MUST carry, one per language plus two Latin-1
 * controls. This is the assertion that stops the KTD7 contradiction coming
 * back: Mark OT was rejected over Latin Extended-A coverage, so shipping a
 * subset that drops Latin Extended-A would throw away the reason this family
 * was chosen. Written as codepoints, not literals, so this file stays pure
 * ASCII and cannot be broken by an editor re-encoding it.
 */
const REQUIRED_CODEPOINTS = [
  ['Polish z-dot', 0x017c],
  ['Polish l-stroke', 0x0142],
  ['Polish c-acute', 0x0107],
  ['Polish a-ogonek', 0x0105],
  ['Czech c-caron', 0x010d],
  ['Czech r-caron', 0x0159],
  ['Slovak l-acute', 0x013a],
  ['Hungarian o-double-acute', 0x0151],
  ['Turkish g-breve', 0x011f],
  ['Turkish dotless i', 0x0131],
  ['Turkish dotted I', 0x0130],
  ['Turkish s-cedilla', 0x015f],
  ['Romanian s-comma', 0x0219],
  ['Romanian t-comma', 0x021b],
  ['Latin-1 e-acute', 0x00e9],
  ['Latin-1 n-tilde', 0x00f1],
];

function faceSize(file) {
  return fs.statSync(path.join(FONT_DIR, file)).size;
}

function readTypeCss() {
  return fs.readFileSync(TYPE_CSS, 'utf8');
}

/** Strip /* *\/ comments so prose about Mark OT cannot be mistaken for a rule. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Every @font-face block body, comments removed. */
function fontFaceBlocks(css) {
  const bodies = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let match;
  while ((match = re.exec(stripComments(css))) !== null) {
    bodies.push(match[1]);
  }
  return bodies;
}

/** Every url(...) target inside a block, unquoted and stripped of ?query#frag. */
function urlsIn(block) {
  return [...block.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) =>
    m[2].trim().split(/[?#]/)[0]
  );
}

function declaration(block, property) {
  const match = new RegExp(
    '(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)',
    'i'
  ).exec(block);
  return match ? match[1].trim() : null;
}

/** Top-level clamp() calls, tolerating one level of nested parentheses. */
function clampCalls(css) {
  const re = /clamp\(((?:[^()]|\([^()]*\))*)\)/g;
  return [...stripComments(css).matchAll(re)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Reading coverage straight out of the committed woff2 files.
//
// The site has no build step and no node_modules, so there is no font library
// to lean on. This is a deliberately minimal WOFF2 reader: enough to find the
// cmap table and list the codepoints it maps, and nothing more. It only ever
// reads, never writes.
//
// It is written to fail loudly rather than quietly: an unparseable file or an
// unrecognised cmap format throws, and a parser that silently returned an
// empty set would still fail the assertions below, which check that specific
// characters are PRESENT.
// ---------------------------------------------------------------------------

/** WOFF2 known-table-tag table. Index 63 means an explicit 4-byte tag. */
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** WOFF2's variable-length integer. Returns [value, nextPosition]. */
function readUIntBase128(buf, start) {
  let value = 0;
  let pos = start;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf.readUInt8(pos);
    pos += 1;
    // Multiply rather than shift: a 5-byte value overflows a 32-bit shift.
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos];
  }
  throw new Error('malformed UIntBase128 in the WOFF2 table directory');
}

/**
 * Decompress a WOFF2 and return its table directory plus the raw sfnt bytes.
 * Tables live back-to-back in the decompressed stream, in directory order.
 */
function readWoff2(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(path.basename(file) + ' is not a WOFF2 file');
  }
  const numTables = buf.readUInt16BE(12);
  let pos = 48; // the WOFF2 header is a fixed 48 bytes

  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf.readUInt8(pos);
    pos += 1;
    const tagIndex = flags & 0x3f;
    const transformVersion = (flags >> 6) & 0x03;

    let tag;
    if (tagIndex === 63) {
      tag = buf.subarray(pos, pos + 4).toString('latin1');
      pos += 4;
    } else {
      tag = WOFF2_KNOWN_TAGS[tagIndex];
    }

    let length;
    [length, pos] = readUIntBase128(buf, pos);

    // glyf and loca inverted the convention: for them 0 means "transformed".
    const transformed =
      tag === 'glyf' || tag === 'loca'
        ? transformVersion === 0
        : transformVersion !== 0;
    if (transformed) {
      [length, pos] = readUIntBase128(buf, pos);
    }

    tables.push({ tag: tag, length: length });
  }

  const data = zlib.brotliDecompressSync(buf.subarray(pos));
  let offset = 0;
  for (const table of tables) {
    table.offset = offset;
    offset += table.length;
  }
  return { tables: tables, data: data };
}

/** Codepoints mapped to a real glyph by a cmap format 4 subtable. */
function readCmapFormat4(data, at, into) {
  const segCount = data.readUInt16BE(at + 6) / 2;
  const endAt = at + 14;
  const startAt = endAt + segCount * 2 + 2; // +2 skips reservedPad
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;

  for (let seg = 0; seg < segCount; seg += 1) {
    const end = data.readUInt16BE(endAt + seg * 2);
    const start = data.readUInt16BE(startAt + seg * 2);
    const delta = data.readInt16BE(deltaAt + seg * 2);
    const rangeOffset = data.readUInt16BE(rangeAt + seg * 2);
    if (start === 0xffff) continue;

    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let gid;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const glyphAt = rangeAt + seg * 2 + rangeOffset + (cp - start) * 2;
        if (glyphAt + 1 >= data.length) continue;
        gid = data.readUInt16BE(glyphAt);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) into.add(cp);
    }
  }
}

/** Codepoints mapped to a real glyph by a cmap format 12 subtable. */
function readCmapFormat12(data, at, into) {
  const groups = data.readUInt32BE(at + 12);
  for (let g = 0; g < groups; g += 1) {
    const groupAt = at + 16 + g * 12;
    const start = data.readUInt32BE(groupAt);
    const end = data.readUInt32BE(groupAt + 4);
    const startGid = data.readUInt32BE(groupAt + 8);
    for (let cp = start; cp <= end; cp += 1) {
      if (startGid + (cp - start) !== 0) into.add(cp);
    }
  }
}

/** Every codepoint the given woff2 file can actually render. */
function faceCodepoints(file) {
  const { tables, data } = readWoff2(file);
  const cmap = tables.find((t) => t.tag === 'cmap');
  if (!cmap) throw new Error(path.basename(file) + ' has no cmap table');

  const subtables = data.readUInt16BE(cmap.offset + 2);
  const covered = new Set();
  let parsed = 0;

  for (let i = 0; i < subtables; i += 1) {
    const recordAt = cmap.offset + 4 + i * 8;
    const subtableAt = cmap.offset + data.readUInt32BE(recordAt + 4);
    const format = data.readUInt16BE(subtableAt);
    if (format === 4) {
      readCmapFormat4(data, subtableAt, covered);
      parsed += 1;
    } else if (format === 12) {
      readCmapFormat12(data, subtableAt, covered);
      parsed += 1;
    }
    // Any other format is ignored, but `parsed` below catches the case where
    // NOTHING was understood, so this can never silently report zero coverage.
  }

  if (parsed === 0) {
    throw new Error(
      path.basename(file) + ' has no cmap subtable in format 4 or 12'
    );
  }
  return covered;
}

/** Split on commas that are not inside parentheses. */
function topLevelArgs(inner) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  args.push(current.trim());
  return args;
}

// ---------------------------------------------------------------------------
// the served artefacts
// ---------------------------------------------------------------------------

test('the five expected woff2 faces exist in assets/fonts', () => {
  assert.ok(fs.existsSync(FONT_DIR), 'assets/fonts must exist - run tools/build-fonts.py');
  for (const face of EXPECTED_FACES) {
    const file = path.join(FONT_DIR, face.file);
    assert.ok(fs.existsSync(file), face.file + ' is missing - run tools/build-fonts.py');
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 0, face.file + ' must not be empty');
    assert.equal(
      bytes.subarray(0, 4).toString('latin1'),
      'wOF2',
      face.file + ' must carry the wOF2 signature'
    );
  }
});

test('assets/fonts holds only the five faces, so nothing untracked inflates the payload', () => {
  const present = fs
    .readdirSync(FONT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.woff2'))
    .sort();
  assert.deepEqual(
    present,
    EXPECTED_FACES.map((f) => f.file).sort(),
    'assets/fonts must contain exactly the five served faces'
  );
});

test('the combined font payload is under 100,000 bytes (R25)', () => {
  const sizes = EXPECTED_FACES.map((f) => ({ file: f.file, bytes: faceSize(f.file) }));
  const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
  const detail = sizes.map((s) => s.file + ' ' + s.bytes).join(', ');
  assert.ok(
    total < TOTAL_BUDGET,
    'total font payload ' + total + ' bytes exceeds the ' + TOTAL_BUDGET +
      ' byte budget (' + detail + ')'
  );
});

test('no single face exceeds 20KB', () => {
  for (const face of EXPECTED_FACES) {
    const bytes = faceSize(face.file);
    assert.ok(
      bytes <= PER_FACE_LIMIT,
      face.file + ' is ' + bytes + ' bytes, over the ' + PER_FACE_LIMIT + ' byte per-face ceiling'
    );
  }
});

// ---------------------------------------------------------------------------
// coverage: the reason this family was chosen in the first place
// ---------------------------------------------------------------------------

test('every shipped face carries the European name characters (KTD7)', () => {
  for (const face of EXPECTED_FACES) {
    const covered = faceCodepoints(path.join(FONT_DIR, face.file));
    const missing = REQUIRED_CODEPOINTS.filter(([, cp]) => !covered.has(cp)).map(
      ([name, cp]) => name + ' U+' + cp.toString(16).toUpperCase().padStart(4, '0')
    );
    assert.deepEqual(
      missing,
      [],
      face.file + ' cannot render: ' + missing.join(', ') +
        '. Mark OT was rejected over exactly this coverage, so a subset that ' +
        'drops it throws away the reason the family was chosen. See ' +
        'EUROPEAN_NAME_UNICODES in tools/build-fonts.py.'
    );
  }
});

test('all five faces cover the same characters, so no face is a stale build', () => {
  const perFace = EXPECTED_FACES.map((face) => ({
    file: face.file,
    covered: faceCodepoints(path.join(FONT_DIR, face.file)),
  }));

  // A sanity floor on the reader itself: Latin-1 alone is ~200 codepoints, so
  // anything below this means the parser is broken rather than the font.
  for (const { file, covered } of perFace) {
    assert.ok(
      covered.size > 250,
      file + ' reports only ' + covered.size + ' codepoints, which is too few ' +
        'to be a Latin plus European-names subset'
    );
  }

  const [first, ...rest] = perFace;
  for (const other of rest) {
    assert.equal(
      other.covered.size,
      first.covered.size,
      other.file + ' covers ' + other.covered.size + ' codepoints but ' +
        first.file + ' covers ' + first.covered.size +
        ': the faces were not built from the same subset'
    );
  }
});

// ---------------------------------------------------------------------------
// css/type.css against those artefacts
// ---------------------------------------------------------------------------

test('css/type.css declares exactly the five faces with the right weight and style', () => {
  const blocks = fontFaceBlocks(readTypeCss());
  assert.equal(blocks.length, EXPECTED_FACES.length, 'expected five @font-face blocks');

  for (const face of EXPECTED_FACES) {
    const block = blocks.find((b) => urlsIn(b).some((u) => u.endsWith(face.file)));
    assert.ok(block, 'no @font-face block serves ' + face.file);
    assert.equal(
      declaration(block, 'font-weight'),
      face.weight,
      face.file + ' must be declared at weight ' + face.weight
    );
    assert.equal(
      declaration(block, 'font-style'),
      face.style,
      face.file + ' must be declared as font-style: ' + face.style
    );
    assert.match(
      declaration(block, 'font-family') || '',
      /^["']?Mark Pro["']?$/,
      face.file + ' must join the "Mark Pro" family'
    );
    assert.equal(
      declaration(block, 'font-display'),
      'swap',
      face.file + ' must use font-display: swap'
    );
  }
});

test('every @font-face src resolves to a file that exists', () => {
  const blocks = fontFaceBlocks(readTypeCss());
  for (const block of blocks) {
    const urls = urlsIn(block);
    assert.ok(urls.length > 0, '@font-face block declares no url()');
    for (const url of urls) {
      assert.ok(
        !/^(https?:)?\/\//.test(url),
        url + ' must be self-hosted, not a remote URL (R1)'
      );
      const resolved = path.resolve(CSS_DIR, url);
      assert.ok(
        fs.existsSync(resolved),
        'css/type.css points at ' + url + ', which resolves to a missing file'
      );
    }
  }
});

test('no @font-face references a Mark OT file', () => {
  const blocks = fontFaceBlocks(readTypeCss());
  for (const block of blocks) {
    assert.ok(
      !/mark[-_. ]?ot/i.test(block),
      'a @font-face block references Mark OT, which has too little coverage (KTD7)'
    );
    for (const url of urlsIn(block)) {
      assert.ok(
        !/\.otf$/i.test(url),
        url + ' is a desktop OTF; only generated woff2 files are served (KTD8)'
      );
    }
  }
});

// ---------------------------------------------------------------------------
// the type scale
// ---------------------------------------------------------------------------

test('every clamp() keeps a rem term in the middle, so browser zoom still works', () => {
  const calls = clampCalls(readTypeCss());
  assert.ok(calls.length > 0, 'the type scale must be built on clamp()');
  for (const inner of calls) {
    const args = topLevelArgs(inner);
    assert.equal(args.length, 3, 'clamp(' + inner + ') must take three arguments');
    assert.match(
      args[1],
      /\d\s*rem\b/,
      'clamp(' + inner + ') has no rem term in its preferred value: bare vw defeats zoom'
    );
  }
});

test('the scale is exposed as custom properties later units can consume', () => {
  const css = stripComments(readTypeCss());
  const declared = new Set(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1].toLowerCase())
  );
  for (const name of [
    '--type-family',
    '--type-display',
    '--type-body',
    '--type-caption',
    '--type-label',
  ]) {
    assert.ok(declared.has(name), name + ' must be exposed as a custom property');
  }
});
