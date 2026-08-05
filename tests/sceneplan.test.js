'use strict';

/**
 * U8 scene-plan tests (R15, R19, R20, KTD2, KTD12, KTD15).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * js/scene-plan.js is the DOM-free half of the choreography: it takes the
 * three things that decide what may move - the breakpoint band, whether the
 * visitor asked for less motion - and hands back a list of descriptors. It
 * never touches the page, so the breakpoint rules and the reduced-motion
 * promise can be proved here, under Node, where there is no `document` and
 * no `matchMedia` (KTD15). js/scenes.js is the browser half that turns those
 * descriptors into GSAP timelines, and it is verified in a browser.
 *
 * THE SCENE INVENTORY BELOW IS THE SPEC, TRANSCRIBED. It is written out here
 * rather than imported from the module so that these tests judge the module
 * against the plan instead of against itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLAN_FILE = path.join(ROOT, 'js', 'scene-plan.js');
const SCENES_FILE = path.join(ROOT, 'js', 'scenes.js');
const MOTION_CSS = path.join(ROOT, 'css', 'motion.css');

/* -------------------------------------------------------------------------
   The plan's scene inventory, in page order.
   id | section | driver | mobile magnitude
   ------------------------------------------------------------------------- */

const INVENTORY = [
  { id: 'hero-wordmark-bleed', section: 'hero', driver: 'scroll', mobile: 0.6 },
  { id: 'hero-grain-swell', section: 'hero', driver: 'intensity', mobile: 0.8 },
  { id: 'crew-name-cascade', section: 'crew', driver: 'batch', mobile: 0.7 },
  { id: 'crew-misregistration-drift', section: 'crew', driver: 'intensity', mobile: 0.5 },
  { id: 'mix-rail-entry', section: 'mixes', driver: 'scroll', mobile: 0.7 },
  { id: 'mix-beat-kick', section: 'mixes', driver: 'beat', mobile: 0.8 },
  { id: 'events-rule-draw', section: 'events', driver: 'batch', mobile: 0.8 },
  { id: 'contact-collapse', section: 'contact', driver: 'scroll', mobile: 0.6 },
];

/** The sections in the order the page prints them. */
const PAGE_ORDER = ['hero', 'crew', 'mixes', 'events', 'contact'];

/** The only two properties a scene is allowed to touch. */
const ANIMATABLE = ['transform', 'opacity'];

/** WCAG 2.3.1, restated by R20. */
const MAX_CYCLES_PER_SECOND = 3;

/** R19's floor: a phone may not be given a scene scaled down to nothing. */
const MIN_MOBILE_MAGNITUDE = 0.4;

const DESKTOP = { isDesktop: true, isMobile: false, reduceMotion: false };
const MOBILE = { isDesktop: false, isMobile: true, reduceMotion: false };

/** Load the classic browser script under Node, exactly as index.html would. */
function loadPlan() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  try {
    delete require.cache[require.resolve(PLAN_FILE)];
  } catch (err) {
    /* not previously required - the require below reports it */
  }
  require(PLAN_FILE);
  const plan = globalThis.LUVIZ && globalThis.LUVIZ.scenePlan;
  assert.ok(plan, 'js/scene-plan.js must define window.LUVIZ.scenePlan');
  return plan;
}

function readSource(file) {
  return fs.readFileSync(file, 'utf8');
}

/** Source with block comments removed, so prose cannot satisfy a check. */
function readCode(file) {
  return readSource(file).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every { element, properties } write across a descriptor list. */
function allWrites(scenes) {
  const out = [];
  for (const scene of scenes) {
    for (const write of scene.writes) {
      out.push({ scene, write });
    }
  }
  return out;
}

function byId(scenes) {
  const map = new Map();
  for (const scene of scenes) {
    map.set(scene.id, scene);
  }
  return map;
}

// ---------------------------------------------------------------------------
// KTD15: the module is pure
// ---------------------------------------------------------------------------

test('the scene plan is DOM-free and loads under Node (KTD15)', () => {
  const code = readCode(PLAN_FILE);
  for (const forbidden of [
    /\bdocument\b/,
    /\bnavigator\b/,
    /\blocalStorage\b/,
    /\bmatchMedia\s*\(/,
    /\bgsap\b/,
    /\bScrollTrigger\b/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
  ]) {
    assert.ok(
      !forbidden.test(code),
      'js/scene-plan.js must stay DOM-free and GSAP-free; found ' + forbidden
    );
  }
  assert.ok(
    !/^\s*(import|export)\b/m.test(code),
    'js/scene-plan.js must be a classic script, never a module (KTD1)'
  );
  const plan = loadPlan();
  assert.equal(typeof plan.scenes, 'function');
  assert.equal(typeof plan.finalStates, 'function');
});

test('the same environment always yields the same plan, and callers cannot corrupt it', () => {
  const plan = loadPlan();

  const first = plan.scenes(DESKTOP);
  const second = plan.scenes(DESKTOP);
  assert.deepEqual(first, second, 'the plan must be deterministic');
  assert.notEqual(first, second, 'each call must hand back its own array');

  first.length = 0;
  first.push({ id: 'injected' });
  const third = plan.scenes(DESKTOP);
  assert.deepEqual(third, second, 'mutating one result must not affect the next');

  /* The descriptors themselves are copies too. */
  const fourth = plan.scenes(DESKTOP);
  fourth[0].id = 'rewritten';
  assert.equal(plan.scenes(DESKTOP)[0].id, second[0].id);
});

test('an empty or contradictory environment resolves deterministically to the smaller magnitudes', () => {
  const plan = loadPlan();
  const nothing = plan.scenes();
  const both = plan.scenes({ isDesktop: true, isMobile: true, reduceMotion: false });
  const mobile = plan.scenes(MOBILE);

  assert.deepEqual(nothing, mobile, 'no environment at all must fall to the mobile band');
  assert.deepEqual(both, mobile, 'a contradictory environment must fall to the mobile band');
});

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

test('the plan builds exactly the eight scenes of the inventory, in page order', () => {
  const plan = loadPlan();
  const scenes = plan.scenes(DESKTOP);

  assert.deepEqual(
    scenes.map((s) => s.id),
    INVENTORY.map((s) => s.id),
    'the scene ids and their order come from the plan, not from taste'
  );

  scenes.forEach((scene, index) => {
    assert.equal(scene.order, index, scene.id + ' must carry its page position');
    assert.equal(scene.section, INVENTORY[index].section, scene.id + ' section');
    assert.equal(scene.driver, INVENTORY[index].driver, scene.id + ' driver');
  });
});

test('descriptors are returned in page order, section by section', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    const scenes = plan.scenes(env);
    let seen = -1;
    for (const scene of scenes) {
      const at = PAGE_ORDER.indexOf(scene.section);
      assert.ok(at >= 0, scene.id + ' names a section the page does not have');
      assert.ok(
        at >= seen,
        'triggers must be created in page order; ' + scene.id + ' comes after a later section'
      );
      seen = at;
    }
    /* Belt and braces for the refresh order GSAP resolves ties with. */
    const priorities = scenes.map((s) => s.refreshPriority);
    for (let i = 1; i < priorities.length; i++) {
      assert.ok(
        priorities[i] <= priorities[i - 1],
        'refreshPriority must fall with page position so an earlier trigger refreshes first'
      );
    }
  }
});

test('every scene has exactly one driver and exactly one loud motion event (R15)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const scene of plan.scenes(env)) {
      assert.ok(
        ['scroll', 'batch', 'intensity', 'beat'].includes(scene.driver),
        scene.id + ' must name one of the four drivers'
      );
      assert.equal(typeof scene.loudEvent, 'string');
      assert.ok(scene.loudEvent.length > 0, scene.id + ' must state its one loud event');
      /* One budget per scene: a second loud event would be a second event. */
      assert.equal(scene.loudEvents, undefined, scene.id + ' may not declare a list of loud events');
    }
  }
});

test('SplitText is used for the two per-line display reveals it was pinned for (KTD2)', () => {
  const plan = loadPlan();
  const split = plan
    .scenes(DESKTOP)
    .filter((s) => s.splitText)
    .map((s) => s.id);
  assert.deepEqual(split, ['hero-wordmark-bleed', 'crew-name-cascade']);
});

// ---------------------------------------------------------------------------
// R19: reduced motion
// ---------------------------------------------------------------------------

test('under prefers-reduced-motion: reduce the descriptor list is empty (R19)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    const reduced = Object.assign({}, env, { reduceMotion: true });
    assert.deepEqual(
      plan.scenes(reduced),
      [],
      'under reduce nothing scroll-driven may be created at all, not created and disabled'
    );
    assert.equal(plan.plan(reduced).reduceMotion, true);
  }
});

test('under reduce the module still reports the final states the page needs to render (R19)', () => {
  const plan = loadPlan();

  const wanted = new Set();
  for (const env of [DESKTOP, MOBILE]) {
    for (const { write } of allWrites(plan.scenes(env))) {
      wanted.add(write.element);
    }
  }
  assert.ok(wanted.size > 0, 'the motion plan must write something to have a final state');

  for (const env of [DESKTOP, MOBILE]) {
    const reduced = Object.assign({}, env, { reduceMotion: true });
    const states = plan.finalStates(reduced);
    assert.ok(states.length > 0, 'reduce must still report final states');

    const covered = new Set(states.map((s) => s.element));
    for (const element of wanted) {
      assert.ok(
        covered.has(element),
        element + ' is moved by a scene but has no final state to be set under reduce'
      );
    }

    for (const state of states) {
      assert.equal(typeof state.selector, 'string');
      assert.ok(state.selector.length > 0, state.element + ' needs a selector to set');
      assert.ok(state.set && typeof state.set === 'object', state.element + ' needs a set block');
      assert.ok(
        Object.keys(state.set).length > 0,
        state.element + ' final state must actually assign something'
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Breakpoint parity
// ---------------------------------------------------------------------------

test('desktop and mobile return the same set of scene ids, so no section loses its treatment', () => {
  const plan = loadPlan();
  const desktop = plan.scenes(DESKTOP).map((s) => s.id);
  const mobile = plan.scenes(MOBILE).map((s) => s.id);
  assert.deepEqual(mobile, desktop, 'a phone gets every scene the desktop gets');
});

test('every mobile magnitude is at least 0.4x its desktop counterpart, and matches the inventory', () => {
  const plan = loadPlan();
  const desktop = byId(plan.scenes(DESKTOP));
  const mobile = byId(plan.scenes(MOBILE));

  for (const row of INVENTORY) {
    const d = desktop.get(row.id);
    const m = mobile.get(row.id);
    assert.ok(d && m, row.id + ' must exist in both bands');

    assert.equal(d.magnitude, 1, row.id + ': the desktop band is the reference magnitude');
    assert.equal(m.magnitude, row.mobile, row.id + ': mobile magnitude comes from the inventory');
    assert.ok(
      m.magnitude >= MIN_MOBILE_MAGNITUDE,
      row.id + ': scene-id parity may not be satisfied by scaling the effect to nothing'
    );
  }
});

test('every scaled amount on a phone is at least 0.4x the desktop amount', () => {
  const plan = loadPlan();
  const desktop = byId(plan.scenes(DESKTOP));
  const mobile = byId(plan.scenes(MOBILE));

  for (const row of INVENTORY) {
    const d = desktop.get(row.id);
    const m = mobile.get(row.id);
    const keys = Object.keys(d.amounts);
    assert.ok(keys.length > 0, row.id + ' must state the size of its movement');
    assert.deepEqual(
      Object.keys(m.amounts),
      keys,
      row.id + ': both bands must describe the same movement'
    );

    for (const key of keys) {
      const from = d.amounts[key];
      const to = m.amounts[key];
      assert.equal(typeof to, 'number', row.id + '.' + key + ' must be a number');
      assert.ok(isFinite(to) && to !== 0, row.id + '.' + key + ' must be a real movement');
      const ratio = Math.abs(to / from);
      assert.ok(
        ratio >= MIN_MOBILE_MAGNITUDE,
        row.id + '.' + key + ' shrinks to ' + ratio.toFixed(3) + 'x on a phone'
      );
      assert.ok(
        Math.abs(ratio - row.mobile) < 1e-3,
        row.id + '.' + key + ' must scale by the inventory magnitude, not by taste'
      );
    }
  }
});

test('durations are not scaled by magnitude: a smaller move must not become a faster one', () => {
  const plan = loadPlan();
  const desktop = byId(plan.scenes(DESKTOP));
  const mobile = byId(plan.scenes(MOBILE));
  for (const row of INVENTORY) {
    assert.deepEqual(
      mobile.get(row.id).timing,
      desktop.get(row.id).timing,
      row.id + ': timing is the same on both bands'
    );
  }
});

// ---------------------------------------------------------------------------
// What a scene may touch
// ---------------------------------------------------------------------------

test('no descriptor animates a property outside transform and opacity', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const { scene, write } of allWrites(plan.scenes(env))) {
      assert.ok(Array.isArray(write.properties), scene.id + ' writes need a property list');
      assert.ok(write.properties.length > 0, scene.id + ' writes need at least one property');
      for (const property of write.properties) {
        assert.ok(
          ANIMATABLE.includes(property),
          scene.id + ' animates "' + property + '", which is neither transform nor opacity'
        );
      }
    }
  }
});

test('every scrub is a number, never true', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const scene of plan.scenes(env)) {
      if (!('scrub' in scene)) {
        continue;
      }
      assert.notEqual(scene.scrub, true, scene.id + ': scrub true gives no catch-up smoothing');
      assert.equal(typeof scene.scrub, 'number', scene.id + ': scrub must be numeric');
      assert.ok(scene.scrub > 0, scene.id + ': scrub must be a real catch-up time');
    }
    /* Every scroll-driven scene is scrubbed, and nothing else is. */
    for (const scene of plan.scenes(env)) {
      assert.equal(
        'scrub' in scene,
        scene.driver === 'scroll',
        scene.id + ': only the scroll-driven scenes carry a scrub'
      );
    }
  }
});

test('no descriptor sets both scrub and toggleActions, because scrub wins silently', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const scene of plan.scenes(env)) {
      const hasScrub = 'scrub' in scene;
      const hasToggle = 'toggleActions' in scene;
      assert.ok(
        !(hasScrub && hasToggle),
        scene.id + ' declares both scrub and toggleActions; scrub would silently win'
      );
      if (hasToggle) {
        assert.equal(typeof scene.toggleActions, 'string');
      }
    }
  }
});

test('no two descriptors write the same property on the same element from different drivers', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    const owner = new Map();
    for (const { scene, write } of allWrites(plan.scenes(env))) {
      const driver = write.driver || scene.driver;
      for (const property of write.properties) {
        const key = write.element + '::' + property;
        const previous = owner.get(key);
        if (previous) {
          assert.equal(
            previous.driver,
            driver,
            'beat and intensity must never write the same property on the same element: ' +
              key + ' is written by ' + previous.scene + ' (' + previous.driver + ') and by ' +
              scene.id + ' (' + driver + ')'
          );
        }
        owner.set(key, { driver: driver, scene: scene.id });
      }
    }
  }
});

test('each element and property pair belongs to exactly one scene', () => {
  const plan = loadPlan();
  const seen = new Map();
  for (const { scene, write } of allWrites(plan.scenes(DESKTOP))) {
    for (const property of write.properties) {
      const key = write.element + '::' + property;
      assert.ok(
        !seen.has(key) || seen.get(key) === scene.id,
        key + ' is written by both ' + seen.get(key) + ' and ' + scene.id
      );
      seen.set(key, scene.id);
    }
  }
});

test('every write names a canonical element as well as a selector, so a collision cannot hide behind two spellings', () => {
  const plan = loadPlan();
  const selectorFor = new Map();
  for (const { scene, write } of allWrites(plan.scenes(DESKTOP))) {
    assert.equal(typeof write.element, 'string', scene.id + ' write needs an element key');
    assert.ok(write.element.length > 0);
    assert.equal(typeof write.selector, 'string', scene.id + ' write needs a selector');
    assert.ok(write.selector.length > 0);
    if (selectorFor.has(write.element)) {
      assert.equal(
        selectorFor.get(write.element),
        write.selector,
        write.element + ' must always mean the same selector'
      );
    }
    selectorFor.set(write.element, write.selector);
  }
});

// ---------------------------------------------------------------------------
// R15: motion never delays legibility
// ---------------------------------------------------------------------------

test('no text is faded by a scrub: type reveals once on entry and is then left alone (R15)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const { scene, write } of allWrites(plan.scenes(env))) {
      if (!write.text) {
        continue;
      }
      const driver = write.driver || scene.driver;
      if (write.properties.includes('opacity')) {
        assert.ok(
          driver === 'batch' || driver === 'reveal',
          scene.id + ' fades type from a ' + driver +
            ' driver; a reveal must be one-shot so legibility never waits on a scroll position'
        );
      }
      if ('scrub' in scene) {
        assert.ok(
          write.driver && write.driver !== 'scroll',
          scene.id + ' is scrubbed, so its type write must name its own one-shot driver ' +
            'rather than inherit the scroll position'
        );
      }
    }
  }
});

test('a one-shot type reveal is short enough to be over before it is read as a delay (R15)', () => {
  const plan = loadPlan();
  for (const { scene, write } of allWrites(plan.scenes(DESKTOP))) {
    const driver = write.driver || scene.driver;
    if (!write.text || !(driver === 'batch' || driver === 'reveal')) {
      continue;
    }
    const timing = scene.timing || {};
    const total = (timing.durationMs || 0) + (timing.staggerMs || 0) * (timing.staggerCount || 1);
    assert.ok(total > 0, scene.id + ' must state how long its reveal takes');
    assert.ok(
      total <= 1200,
      scene.id + ' takes ' + total + 'ms to make its type readable'
    );
  }
});

// ---------------------------------------------------------------------------
// R20: flash safety
// ---------------------------------------------------------------------------

test('no scene drives colour, and none targets a full-viewport red fill (R20)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    for (const scene of plan.scenes(env)) {
      assert.equal(scene.drivesColour, false, scene.id + ' must not drive colour');
      assert.equal(scene.fullViewportFill, false, scene.id + ' must not fill the viewport');
    }
  }
});

test('the beat-driven scene cannot exceed three events a second (R20)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    const beats = plan.scenes(env).filter((s) => s.driver === 'beat');
    assert.ok(beats.length > 0, 'the inventory has a beat-driven scene');
    for (const scene of beats) {
      assert.equal(typeof scene.minIntervalMs, 'number');
      assert.ok(
        1000 / scene.minIntervalMs <= MAX_CYCLES_PER_SECOND,
        scene.id + ' can fire ' + (1000 / scene.minIntervalMs).toFixed(2) + ' times a second'
      );
      assert.ok(
        scene.maxCyclesPerSecond <= MAX_CYCLES_PER_SECOND,
        scene.id + ' declares a rate above the three-per-second cap'
      );
      assert.notEqual(scene.area, 'viewport', scene.id + ' may not pulse a full-viewport area');
    }
  }
});

test('a large-area opacity ramp is rate-bounded, and the only one is the clamped grain layer (R20)', () => {
  const plan = loadPlan();
  for (const env of [DESKTOP, MOBILE]) {
    /* Only a continuously driven scene can oscillate. A batched or one-shot
       reveal plays once and stops, which is not a flash however large it is. */
    for (const { scene, write } of allWrites(plan.scenes(env))) {
      const driver = write.driver || scene.driver;
      const repeatable = driver === 'intensity' || driver === 'beat';
      const large = scene.area === 'viewport' || scene.area === 'section';
      if (!repeatable || !large || !write.properties.includes('opacity')) {
        continue;
      }
      assert.ok(
        typeof scene.maxCyclesPerSecond === 'number' &&
          scene.maxCyclesPerSecond <= MAX_CYCLES_PER_SECOND,
        scene.id + ' ramps a large area without a stated rate bound'
      );
    }

    /* And a one-shot reveal really is one-shot. */
    for (const scene of plan.scenes(env)) {
      if (scene.driver === 'batch') {
        assert.equal(scene.once, true, scene.id + ' must play once and never toggle back');
      }
    }

    const viewport = plan.scenes(env).filter((s) => s.area === 'viewport');
    assert.deepEqual(
      viewport.map((s) => s.id),
      ['hero-grain-swell'],
      'the grain layer is the only full-viewport scene'
    );
    const grain = viewport[0];
    assert.equal(
      grain.amplitudeToken,
      '--grain-amplitude',
      'the grain ramp must name the token that clamps its amplitude in CSS'
    );
    for (const write of grain.writes) {
      assert.deepEqual(write.properties, ['opacity']);
    }
  }
});

// ---------------------------------------------------------------------------
// The breakpoints, stated once
// ---------------------------------------------------------------------------

test('the media queries state exactly U4\'s four bands, with no gap and no overlap', () => {
  const plan = loadPlan();
  assert.deepEqual(plan.BREAKPOINTS, { base: 320, mid: 600, desktop: 1024, ultrawide: 1800 });

  const media = plan.MEDIA;
  assert.equal(typeof media.reduce, 'string');
  assert.match(media.reduce, /prefers-reduced-motion:\s*reduce/);

  assert.match(media.base, /max-width:\s*599px/);
  assert.match(media.mid, /min-width:\s*600px/);
  assert.match(media.mid, /max-width:\s*1023px/);
  assert.match(media.desktop, /min-width:\s*1024px/);
  assert.match(media.desktop, /max-width:\s*1799px/);
  assert.match(media.ultrawide, /min-width:\s*1800px/);

  /* No fifth band may be invented here (layout.css is the source of truth). */
  assert.deepEqual(
    Object.keys(media).sort(),
    ['base', 'desktop', 'mid', 'reduce', 'ultrawide']
  );
});

test('the two wide bands take the desktop magnitudes and the two narrow bands the mobile ones', () => {
  const plan = loadPlan();
  assert.equal(plan.resolve({ isDesktop: true, isMobile: false }).band, 'desktop');
  assert.equal(plan.resolve({ isDesktop: false, isMobile: true }).band, 'mobile');
  assert.equal(plan.resolve({ reduceMotion: true }).reduceMotion, true);
});

// ---------------------------------------------------------------------------
// The browser half, checked as source (KTD15 puts its behaviour in a browser)
// ---------------------------------------------------------------------------

test('js/scenes.js absorbs the mobile address bar without normalizeScroll', () => {
  const code = readCode(SCENES_FILE);
  assert.match(
    code,
    /ScrollTrigger\.config\(\s*\{[^}]*ignoreMobileResize:\s*true/,
    'ScrollTrigger.config({ ignoreMobileResize: true }) absorbs the address bar'
  );
  assert.ok(
    !/normalizeScroll/.test(code),
    'normalizeScroll is experimental and does not prevent the iOS address bar behaviour anyway'
  );
});

test('js/scenes.js degrades to a static readable page when GSAP is blocked', () => {
  const code = readCode(SCENES_FILE);
  assert.match(
    code,
    /typeof\s+gsap\s*===\s*['"]undefined['"]/,
    'a blocked CDN must be detected explicitly, not inferred from an exception'
  );
  assert.match(code, /cursor/, 'the guard must restore the native cursor');
});

test('js/scenes.js registers the three plugins and batches repeated reveals', () => {
  const code = readCode(SCENES_FILE);
  assert.match(code, /registerPlugin/, 'plugins are registered here, not in index.html');
  assert.match(code, /ScrollTrigger\.batch\s*\(/, 'repeated reveals use one batch, not one trigger each');
  for (const plugin of ['ScrollTrigger', 'SplitText', 'Observer']) {
    assert.ok(code.includes(plugin), 'js/scenes.js must know about ' + plugin);
  }
  assert.ok(
    !/scrub:\s*true/.test(code),
    'scrub: true gives no catch-up smoothing; every scrub is numeric'
  );
});

test('js/scenes.js reads the intensity signal and never an input device (R17)', () => {
  const code = readCode(SCENES_FILE);
  for (const forbidden of [
    /ontouchstart/,
    /maxTouchPoints/,
    /addEventListener\(\s*['"](?:pointer|touch|mouse|wheel)/,
    /\(hover:\s*hover\)/,
    /\(pointer:\s*(?:fine|coarse)\)/,
  ]) {
    assert.ok(
      !forbidden.test(code),
      'no effect may read an input device directly, or touch parity breaks silently: ' + forbidden
    );
  }
  assert.match(code, /LUVIZ\.intensity/, 'the one signal is the only input');
});

test('css/motion.css keeps its measurements computable and its heights honest (KTD12)', () => {
  /* Comments are stripped first: a declaration cannot live in one, and the
     file is expected to explain in prose why these two are absent. */
  const code = readCode(MOTION_CSS);
  assert.ok(
    !/content-visibility/.test(code),
    'content-visibility: auto behaves like display: none for measurement and makes trigger positions uncomputable'
  );
  assert.ok(
    !/backdrop-filter/.test(code),
    'backdrop-filter on fixed chrome repaints every scroll frame (KTD12)'
  );

  assert.ok(
    !/\b\d+vh\b/.test(code),
    'bare vh units resize with the mobile address bar; use svh'
  );
  assert.match(code, /100svh/, 'the scene stage is sized in svh');

  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b/.test(code),
    'every colour comes from css/tokens.css; motion.css declares none of its own'
  );

  const willChange = [...code.matchAll(/will-change:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(willChange.length > 0, 'motion.css owns the will-change hints');
  for (const value of willChange) {
    for (const part of value.split(',')) {
      assert.ok(
        ['transform', 'opacity', 'auto'].includes(part.trim()),
        'will-change may only promise transform or opacity, found "' + part.trim() + '"'
      );
    }
  }
});
