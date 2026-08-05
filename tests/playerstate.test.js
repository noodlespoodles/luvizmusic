'use strict';

/**
 * U6 player-state tests (R10, R11, R12, R12a, R15a, R21, KTD15).
 *
 * Run from the repo root with:   node --test
 * (Do NOT run `node --test tests/` - Node 24 rejects the directory form here
 * and reports it as a phantom failing test.)
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * The player is the one part of the site that can fail in a way the visitor
 * cannot see through: a button that does nothing looks identical to a browser
 * that refused, to a provider that is still loading, and to a CDN that never
 * answered. The rule that decides which of those four the visitor is looking
 * at is therefore pulled out of the DOM entirely and kept in
 * js/player-state.js as a pure transition table (KTD15). Node has no
 * `document`, and the no-install rule bars jsdom, so this is the only half of
 * the player that CAN be tested automatically. The other half - the bar
 * itself - is verified in a browser.
 *
 * NOTHING IN THIS FILE PLAYS ANY AUDIO. It never loads a provider, never
 * builds an iframe and never touches the network. It feeds the machine plain
 * data and reads plain data back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_FILE = path.join(ROOT, 'js', 'player-state.js');

/** Load the classic browser script under Node, exactly as index.html would. */
function loadMachine() {
  globalThis.window = globalThis;
  delete globalThis.LUVIZ;
  try {
    delete require.cache[require.resolve(MODULE_FILE)];
  } catch (err) {
    /* not previously required - the require below reports it */
  }
  require(MODULE_FILE);
  const machine = globalThis.LUVIZ && globalThis.LUVIZ.playerState;
  assert.ok(machine, 'js/player-state.js must define window.LUVIZ.playerState');
  return machine;
}

const MIX_A = { title: 'Shadowmixer 0321', provider: 'mixcloud', url: 'https://example.test/a' };
const MIX_B = { title: 'Knee', provider: 'mixcloud', url: 'https://example.test/b' };

/** A blocked payload shaped exactly like the one js/players/adapter.js emits. */
function blockedPayload(reason) {
  return {
    provider: 'mixcloud',
    providerLabel: 'Mixcloud',
    mix: MIX_A,
    reason: reason || 'autoplay',
    message: 'This browser would not start the mix on its own.',
    retryable: true,
  };
}

/** Walk a list of [event, payload] steps and hand back the last result. */
function run(machine, context, steps) {
  let result = { context: context, state: context.state };
  for (const step of steps) {
    const event = Array.isArray(step) ? step[0] : step;
    const payload = Array.isArray(step) ? step[1] : undefined;
    result = machine.reduce(result.context, event, payload);
  }
  return result;
}

// ---------------------------------------------------------------------------
// KTD15: the module is pure
// ---------------------------------------------------------------------------

test('the player state machine is DOM-free and loads under Node (KTD15)', () => {
  const source = fs.readFileSync(MODULE_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [
    /\bdocument\b/,
    /\bnavigator\b/,
    /\blocalStorage\b/,
    /\bmatchMedia\b/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
  ]) {
    assert.ok(
      !forbidden.test(source),
      'js/player-state.js must stay DOM-free and timer-free; found ' + forbidden
    );
  }
  const machine = loadMachine();
  assert.equal(typeof machine.reduce, 'function');
  assert.equal(typeof machine.initial, 'function');
  assert.equal(typeof machine.actions, 'function');
});

test('reduce never mutates the context it is handed', () => {
  const machine = loadMachine();
  const before = machine.initial(MIX_A);
  const snapshot = JSON.stringify(before);
  machine.reduce(before, machine.EVENTS.READY);
  assert.equal(JSON.stringify(before), snapshot, 'the input context was written to');
});

// ---------------------------------------------------------------------------
// Loading: the two ways it can end
// ---------------------------------------------------------------------------

test('a new player starts in Loading with the transport offering nothing to press', () => {
  const machine = loadMachine();
  const start = machine.initial(MIX_A);
  assert.equal(start.state, machine.STATES.LOADING);
  assert.deepEqual(machine.actions(start), [],
    'Loading must expose no action at all - the tap handler must never await');
  assert.ok(machine.copy(start).note.length > 0,
    'Loading needs visible copy, or a slow provider reads as a dead button');
});

test('Loading transitions to Ready when the widget reports ready', () => {
  const machine = loadMachine();
  const result = machine.reduce(machine.initial(MIX_A), machine.EVENTS.READY);
  assert.equal(result.state, machine.STATES.READY);
  assert.ok(result.changed);
  assert.ok(machine.actions(result.context).indexOf(machine.EVENTS.PLAY) >= 0,
    'Ready must expose PLAY, which is what enables the transport');
});

test('Loading transitions to Unavailable when the load fails', () => {
  const machine = loadMachine();
  const result = machine.reduce(machine.initial(MIX_A), machine.EVENTS.FAILED,
    blockedPayload('script'));
  assert.equal(result.state, machine.STATES.UNAVAILABLE);
  assert.ok(machine.actions(result.context).indexOf(machine.EVENTS.RETRY) >= 0);
  assert.ok(machine.copy(result.context).note.length > 0,
    'Unavailable needs visible copy naming what the visitor can do');
});

test('Loading transitions to Unavailable when the load times out', () => {
  const machine = loadMachine();
  /*
    The adapter normalises a timeout into the SAME blocked event it uses for
    an autoplay refusal, so the machine has to tell them apart by where it
    already is. A timeout while Loading is a dead CDN, not a refused gesture.
  */
  const result = machine.reduce(machine.initial(MIX_A), machine.EVENTS.BLOCKED,
    blockedPayload('timeout'));
  assert.equal(result.state, machine.STATES.UNAVAILABLE);
  assert.equal(result.context.blocks, 0,
    'a provider that never loaded has not refused a gesture, so it must not ' +
    'count toward the escalation to the native control');
});

test('Unavailable retries back into Loading rather than pretending to play', () => {
  const machine = loadMachine();
  const dead = machine.reduce(machine.initial(MIX_A), machine.EVENTS.FAILED, blockedPayload('script'));
  const again = machine.reduce(dead.context, machine.EVENTS.RETRY);
  assert.equal(again.state, machine.STATES.LOADING);
  assert.ok(again.effects.indexOf('reload') >= 0);
});

// ---------------------------------------------------------------------------
// R11: play is only ever offered when it can be taken synchronously
// ---------------------------------------------------------------------------

test('play from Ready enters Playing and asks for playback', () => {
  const machine = loadMachine();
  const ready = machine.reduce(machine.initial(MIX_A), machine.EVENTS.READY);
  const result = machine.reduce(ready.context, machine.EVENTS.PLAY);
  assert.equal(result.state, machine.STATES.PLAYING);
  assert.deepEqual(result.effects, ['play']);
  assert.ok(machine.actions(result.context).indexOf(machine.EVENTS.PAUSE) >= 0);
});

test('play from Loading is rejected and leaves the state alone (R11)', () => {
  const machine = loadMachine();
  const start = machine.initial(MIX_A);
  const result = machine.reduce(start, machine.EVENTS.PLAY);
  assert.equal(result.state, machine.STATES.LOADING);
  assert.equal(result.changed, false);
  assert.equal(result.rejected, true);
  assert.deepEqual(result.effects, [],
    'a rejected play must not reach the provider - the tap handler would ' +
    'then have to await the widget, which loses the gesture on iOS');
  assert.ok(/load/i.test(result.reason), 'the rejection must say why, in plain English');
});

test('pause from Playing enters Paused, and play from Paused resumes', () => {
  const machine = loadMachine();
  const playing = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY,
  ]);
  const paused = machine.reduce(playing.context, machine.EVENTS.PAUSE);
  assert.equal(paused.state, machine.STATES.PAUSED);
  assert.deepEqual(paused.effects, ['pause']);

  const resumed = machine.reduce(paused.context, machine.EVENTS.PLAY);
  assert.equal(resumed.state, machine.STATES.PLAYING);
  assert.deepEqual(resumed.effects, ['play']);
});

// ---------------------------------------------------------------------------
// R12 / R12a: one block offers retry, two blocks change the architecture
// ---------------------------------------------------------------------------

test('a block from Playing enters Blocked and exposes retry (R12)', () => {
  const machine = loadMachine();
  const playing = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY,
  ]);
  const result = machine.reduce(playing.context, machine.EVENTS.BLOCKED, blockedPayload('autoplay'));
  assert.equal(result.state, machine.STATES.BLOCKED);
  assert.equal(result.context.blocks, 1);
  assert.ok(machine.actions(result.context).indexOf(machine.EVENTS.RETRY) >= 0,
    'R12: a failed play must always leave the visitor something to press');
  assert.ok(/blocked/i.test(result.announce) && /retry/i.test(result.announce),
    'R21: a screen-reader user must be told that playback was blocked and ' +
    'that retry is available, or they get silence with no explanation');
});

test('a second consecutive block enters NativeFallback, not Blocked again (R12a)', () => {
  const machine = loadMachine();
  const result = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY,
    machine.EVENTS.PLAY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
    machine.EVENTS.RETRY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
  ]);
  assert.equal(result.state, machine.STATES.NATIVE_FALLBACK,
    'R12a: a retry runs the identical code path, so re-offering it after a ' +
    'second refusal would fail identically forever');
  assert.equal(result.context.blocks, 2);
  assert.ok(result.effects.indexOf('revealNative') >= 0,
    'entering the fallback must reveal the provider\'s own control');
  assert.ok(machine.actions(result.context).indexOf(machine.EVENTS.RETRY) < 0,
    'the same retry must not be offered a third time');
});

test('two blocks with no retry in between escalate just the same', () => {
  const machine = loadMachine();
  const result = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY,
    machine.EVENTS.PLAY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
  ]);
  assert.equal(result.state, machine.STATES.NATIVE_FALLBACK);
});

test('the native fallback tells the visitor which panel to press, out loud', () => {
  const machine = loadMachine();
  const result = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY,
    machine.EVENTS.PLAY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
  ]);
  assert.ok(/Mixcloud/.test(machine.copy(result.context).note),
    'the instruction must name the provider whose button to press');
  assert.ok(machine.announce(result).length > 0, 'R21: the escalation is announced');
});

test('a successful play from NativeFallback enters Playing and hands control back', () => {
  const machine = loadMachine();
  const fallback = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY,
    machine.EVENTS.PLAY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
  ]);
  const playing = machine.reduce(fallback.context, machine.EVENTS.PLAYING);
  assert.equal(playing.state, machine.STATES.PLAYING);
  assert.ok(machine.actions(playing.context).indexOf(machine.EVENTS.PAUSE) >= 0,
    'R12a: after the native first play, the site transport resumes');
  assert.equal(playing.context.blocks, 0,
    'confirmed playback clears the run of refusals, so the ladder starts again');
  assert.ok(/now playing/i.test(playing.announce), 'R21: now playing is announced');
});

test('only CONFIRMED playback clears the block count, never the optimistic tap', () => {
  const machine = loadMachine();
  const blocked = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY,
    machine.EVENTS.PLAY,
    [machine.EVENTS.BLOCKED, blockedPayload('autoplay')],
  ]);
  const retried = machine.reduce(blocked.context, machine.EVENTS.RETRY);
  assert.equal(retried.context.blocks, 1,
    'pressing retry is a request, not a result; clearing the count here ' +
    'would make the escalation unreachable and R12a dead code');
});

// ---------------------------------------------------------------------------
// The end of a mix, and choosing another one
// ---------------------------------------------------------------------------

test('finish enters Ended, exposes NEXT and does not auto-advance', () => {
  const machine = loadMachine();
  const playing = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY,
  ]);
  const ended = machine.reduce(playing.context, machine.EVENTS.FINISH);
  assert.equal(ended.state, machine.STATES.ENDED);
  assert.deepEqual(ended.actions, [machine.EVENTS.NEXT]);
  assert.deepEqual(ended.effects, [],
    'iOS needs a fresh gesture, so nothing may start on its own here');
  assert.ok(/ended|finish/i.test(ended.announce), 'R21: the end of the mix is announced');
});

test('NEXT from Ended cues the following mix without playing it', () => {
  const machine = loadMachine();
  const ended = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY, machine.EVENTS.FINISH,
  ]);
  const next = machine.reduce(ended.context, machine.EVENTS.NEXT, { mix: MIX_B });
  assert.equal(next.state, machine.STATES.READY);
  assert.equal(next.context.mix, MIX_B);
  assert.ok(next.effects.indexOf('play') < 0, 'NEXT cues; it never plays');
});

test('selecting a different mix while Playing stops the current one first', () => {
  const machine = loadMachine();
  const playing = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY,
  ]);
  const result = machine.reduce(playing.context, machine.EVENTS.SELECT, { mix: MIX_B });
  assert.equal(result.state, machine.STATES.READY);
  assert.equal(result.context.mix, MIX_B);
  assert.deepEqual(result.effects, ['stop', 'select'],
    'the running mix must be stopped BEFORE the next one is loaded, or two ' +
    'providers play over each other');
  assert.equal(result.effects.indexOf('stop'), 0);
});

test('selecting a different mix while Paused also returns to Ready', () => {
  const machine = loadMachine();
  const paused = run(machine, machine.initial(MIX_A), [
    machine.EVENTS.READY, machine.EVENTS.PLAY, machine.EVENTS.PAUSE,
  ]);
  const result = machine.reduce(paused.context, machine.EVENTS.SELECT, { mix: MIX_B });
  assert.equal(result.state, machine.STATES.READY);
  assert.equal(result.context.mix, MIX_B);
});

test('selecting from Ready needs no stop, because nothing is sounding', () => {
  const machine = loadMachine();
  const ready = machine.reduce(machine.initial(MIX_A), machine.EVENTS.READY);
  const result = machine.reduce(ready.context, machine.EVENTS.SELECT, { mix: MIX_B });
  assert.deepEqual(result.effects, ['select']);
});

// ---------------------------------------------------------------------------
// R21: every state entry has something to say
// ---------------------------------------------------------------------------

test('every state carries on-screen copy, so none of them reads as a dead button', () => {
  const machine = loadMachine();
  for (const state of Object.keys(machine.STATES).map((k) => machine.STATES[k])) {
    const copy = machine.copy({ state: state, mix: MIX_A, blocks: 0, block: blockedPayload() });
    assert.ok(copy && typeof copy.label === 'string' && copy.label.length > 0,
      state + ' has no status label');
    assert.ok(copy && typeof copy.note === 'string' && copy.note.length > 0,
      state + ' has no explanatory note');
  }
});

test('the four announcements R21 names are all reachable', () => {
  const machine = loadMachine();
  const start = machine.initial(MIX_A);

  const playing = run(machine, start, [machine.EVENTS.READY, machine.EVENTS.PLAY, machine.EVENTS.PLAYING]);
  assert.match(playing.announce, /now playing/i);

  const paused = machine.reduce(playing.context, machine.EVENTS.PAUSE);
  assert.match(paused.announce, /paused/i);

  const blocked = machine.reduce(playing.context, machine.EVENTS.BLOCKED, blockedPayload('autoplay'));
  assert.match(blocked.announce, /blocked/i);
  assert.match(blocked.announce, /retry/i);

  const ended = machine.reduce(playing.context, machine.EVENTS.FINISH);
  assert.match(ended.announce, /ended|finished/i);
});

test('the optimistic tap says nothing, so the live region cannot lie', () => {
  const machine = loadMachine();
  const ready = machine.reduce(machine.initial(MIX_A), machine.EVENTS.READY);
  const tapped = machine.reduce(ready.context, machine.EVENTS.PLAY);
  assert.equal(tapped.announce, '',
    'announcing "now playing" on the tap would be wrong for the whole time ' +
    'the provider takes to refuse');
});

test('an unknown event is rejected rather than throwing', () => {
  const machine = loadMachine();
  const result = machine.reduce(machine.initial(MIX_A), 'SOMETHING_ELSE');
  assert.equal(result.rejected, true);
  assert.equal(result.state, machine.STATES.LOADING);
});
