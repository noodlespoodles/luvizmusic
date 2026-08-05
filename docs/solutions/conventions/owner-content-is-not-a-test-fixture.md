---
title: "Owner-editable content is not a test fixture"
date: 2026-08-05
category: conventions
problem_type: convention
module: content
component: test-suite
tags:
  - testing
  - content-model
  - fixtures
  - non-technical-owner
applies_when: "A project ships editable content files that a non-developer owns, and the test suite asserts against them"
---

# Owner-editable content is not a test fixture

## Context

The LUVIZMUSIC site ships its content as plain `.js` files that the owner edits
directly: crew members, mixes, events. The build scaffolded those files with
invented placeholder content, and the test suite asserted against them to prove
the content contract worked.

Those assertions looked reasonable while the content was synthetic:

- `at least one mix must carry a beatGrid`
- `placeholder mixes cover all four providers`
- `at least one placeholder mix must show a multi-segment beatGrid`
- `at least one crew member must demonstrate links`

Then the owner supplied real content. Ten real mixes, all on one provider, none
with tempo data, and a crew where one member had nothing to link to yet. Four
tests went red. Nothing was broken. The owner had simply used the file the way
it was designed to be used.

## Guidance

**Assert the validator's behaviour against synthetic fixtures. Assert only
well-formedness against shipped content.**

Split every content assertion into one of two kinds:

```js
// WRONG - the shipped content is the fixture, so the owner's editing
// decisions determine whether the build passes.
test('placeholder mixes cover all four providers', () => {
  const used = new Set(LUVIZ.mixes.map((m) => m.provider));
  for (const provider of PROVIDERS) assert.ok(used.has(provider));
});

// RIGHT - the capability is proven with a synthetic probe...
test('the validator accepts every supported provider', () => {
  for (const provider of PROVIDERS) {
    assert.deepEqual(
      LUVIZ.validate.mixes([{ title: 'Probe', provider, url: 'https://x/y' }]),
      []
    );
  }
});

// ...and the shipped content is only checked for being well formed.
test('every mix declares a provider in the supported set', () => {
  for (const mix of LUVIZ.mixes) assert.ok(PROVIDERS.includes(mix.provider));
});
```

Two rules fall out of this:

1. **No floor assertions on real content.** "At least one X" is a fixture
   assertion wearing a content assertion's clothes. An empty events list is the
   normal state between parties; a crew member with no links yet is a person who
   has not sent you their Instagram.
2. **Time-stable fixtures.** Build date fixtures relative to an injected `now`,
   never a hardcoded future date, or the suite turns red on its own the day that
   date passes.

## Why This Matters

The owner here does not read code. A red build is not a signal he can act on,
and it does not tell him what he did wrong. Worse, it is not even true: the file
is valid, the site renders, and the only thing that changed is that the content
became real.

The cost is trust. A test suite that fails when the owner does exactly what the
system was built for teaches him that the tests are noise, which is precisely the
opposite of what a test suite is for on a project where verification is the only
proof he can evaluate.

There is also a straightforward maintenance cost. Every future content edit
becomes a potential build break, so either the owner stops editing or someone
keeps loosening assertions one at a time until they assert nothing.

## When to Apply

Any project where a non-developer owns files the test suite reads. Content
files, config the customer edits, seed data, fixtures a designer maintains.

The tell is a test whose name contains the word "placeholder", "demo", "sample"
or "example" while reading a path that ships to production. If the content is
real, the test name is a lie and the assertion is probably a fixture assertion.

## Examples

The four failures above resolved to three moves:

- **Deleted** the four-provider assertion. It was a proxy for adapter coverage,
  and the adapter's own tests already cover all four paths with stubs.
- **Moved** the beat-grid shape assertions onto the validator with synthetic
  multi-segment, out-of-order and out-of-range grids — which tests more than the
  original did, because a fixture can be deliberately malformed and real content
  cannot.
- **Removed the floor** from the remaining content tests, so they validate
  whatever is shipped without requiring any particular shape of it.

The comment left in the suite is the durable part:

```js
// The shipped content is real (the crew's own Mixcloud uploads), so it is not
// a fixture and must not be asserted against as if it were. Provider breadth
// and beat-grid shape are properties of the VALIDATOR, proven here with
// synthetic mixes; the content tests below only check that whatever is
// actually shipped is well formed.
```
