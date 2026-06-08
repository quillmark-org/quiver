# Feedback on `@quillmark/wasm@0.90.0`

This document captures notes, blockers, and critical feedback collected while
migrating `@quillmark/quiver` (and the downstream `tonguetoquill-web` SvelteKit
app) from `@quillmark/wasm@0.89.0` to `0.90.0`.

**Migration outcome:** successful. Build + 236 unit/integration tests pass
against the new release. The `@quillmark/wasm` type-check and `svelte-check`
for `tonguetoquill-web` are both clean (0 errors, 0 warnings, 4715 files).

---

## 1) `Quill.fromTree` rejects the minimal `Quill.yaml` fixtures that `engine.quill` accepted

**Severity: blocker for tests; requires test-fixture or test-strategy change.**

The old `engine.quill(tree)` accepted quill file trees containing a minimal
`Quill.yaml` like `name: memo\n`. `Quill.fromTree` validates the tree more
strictly — it throws `"Missing required 'quill' section"` on the same fixture.

In practice this forced a change in test strategy for all tests that previously
mocked `engine.quill(tree)`. Instead of returning a fake quill from an engine
mock, tests must now stub `Quill.fromTree` directly via `vi.spyOn`:

```ts
// Before: mock the engine
const engine = { quill(tree) { calls.push(tree); return fakeQuill; } };

// After: stub the static constructor
const spy = vi.spyOn(Quill, "fromTree").mockImplementation((tree) => {
  calls.push(tree);
  return fakeQuill as unknown as Quill;
});
```

This is more invasive than expected and represents a hidden coupling: code that
was engine-independent at the type level now requires a static-method stub to
unit-test. Recommendation: document in the migration guide that `Quill.fromTree`
validates the tree eagerly (i.e., it is not a thin wrapper — it is the parse +
validate step). A note like _"tests that were mocking `engine.quill` to return
fake handles must now stub `Quill.fromTree`"_ would have avoided the surprise.

---

## 2) `QuillMetadata` index signature silently swallows the `supportedFormats` removal

**Severity: silent runtime bug — not caught at compile time.**

`QuillMetadata` carries an index signature:

```ts
export interface QuillMetadata {
    name: string;
    version: string;
    backend: string;
    author: string;
    description: string;
    [key: string]: unknown;
}
```

Code that reads `quill.metadata.supportedFormats` gets `undefined` at runtime
instead of a type error at compile time. We caught this by reading the migration
guide carefully, but a consumer who skips the guide will hit a silent runtime
failure (e.g. an empty format picker, a crash when iterating the result).

**Recommendation:** Either:
- Remove the index signature from `QuillMetadata` so that unknown keys are
  rejected by the type-checker, **or**
- Add `supportedFormats?: never` to the interface to produce a useful type error
  at the access site:
  `Property 'supportedFormats' does not exist on type 'QuillMetadata'`.

The second approach gives consumers an actionable error message pointing them to
`engine.supportedFormats(quill)` without losing the escape hatch for
forward-compatible extra keys.

---

## 3) Breaking change to `@quillmark/quiver`'s own public API

**Severity: coordination friction; no consumer-facing blocker.**

`getQuill(ref, { engine })` was Quiver's own public API surface. With
`Quill.fromTree` being engine-free, the engine parameter became dead weight and
we dropped it (`getQuill(ref)`). This is the right call, but it means:

- The WASM release and the Quiver release must be coordinated. A consumer who
  updates `@quillmark/wasm` to 0.90 must also update `@quillmark/quiver` at the
  same time, or their `getQuill` calls will compile but call a removed engine
  method at runtime.
- During the migration window (WASM updated, Quiver not yet) the web-app needed
  a temporary `as unknown as` cast to paper over the stale Quiver types.

**Recommendation:** Publish the two packages together and call out in the
`@quillmark/wasm` changelog that `@quillmark/quiver >=0.14.0` (or whatever the
new version is) is required alongside `@quillmark/wasm >=0.90.0`. A peer-dep
bump on Quiver would make npm surface this automatically.

---

## 4) `Quill` must now be a value import, not a type-only import

**Severity: minor papercut.**

Previously `Quill` was used exclusively as a type (`import type { Quill }`).
Calling `Quill.fromTree(tree)` requires it to be a value import. Any project
that was using `verbatimModuleSyntax` or aggressively stripping type imports
will hit a compile error until the import is changed:

```diff
- import type { Quill } from '@quillmark/wasm';
+ import { Quill } from '@quillmark/wasm';
```

The migration guide mentions the static import but does not call out the
import-style change. Worth a sentence: _"Note that `Quill` must now be imported
as a value (not a type-only import) so the static `fromTree` method is
available at runtime."_

---

## 5) Tree cache lifetime changed — one quill per ref, not one per (engine × ref)

**Severity: semantic change; informational.**

Under 0.89, `Quiver.getQuill(ref, { engine })` produced a separate quill
instance per engine — two engines requested the same ref, two network fetches,
two quill instances. Under 0.90 there is one quill per canonical ref regardless
of how many engines call `getQuill`. The tree is fetched once, `Quill.fromTree`
is called once, and the result is cached for the Quiver's lifetime.

This is the correct behavior given that `Quill` is now engine-free portable
data, and it halves the number of quill instances in multi-engine deployments
(e.g. a page that mounts both a live preview engine and a thumbnail worker
engine). The change is implicit in the migration guide but not spelled out as a
consequence. A note in the "Quiver" section would help library authors who had
tests asserting the per-engine isolation behavior.

---

## 6) Positive observations

- The split between `@quillmark/wasm/core` (no Typst, ~0.66 MB gzip) and
  `@quillmark/wasm` (full render, ~8 MB gzip) is immediately valuable. The
  editor path in `tonguetoquill-web` only needs schema, validation, and seeding
  — it can now load in ~10× less bytes. We plan to migrate the editor import in
  a follow-up.
- `Quill` being portable data means it can now be serialized, passed across
  `postMessage` boundaries, or shared between a main-thread editor and a Worker
  renderer — something that was impossible when it was an engine-bound handle.
- The shift of `UnsupportedBackend` from load time to render time is a good
  ergonomic change: it lets the core build load and inspect quills without a
  render engine present, which unblocks offline/editor-only use cases.
- `engine.supportedFormats(quill)` returning `Result` (throws on unsupported
  backend) rather than silently returning `[]` is the right choice.

---

## 7) Impact summary

**Changed files in `@quillmark/quiver`:**
- `src/quiver.ts` — cache redesign (`WeakMap<engine, Map>` → `Map<ref, Promise<Quill>>`); `getQuill` drops `{ engine }`; `#materializeQuill` uses `Quill.fromTree`.
- `src/preview.ts` — `getQuill(ref)` (no engine); `engine.render(quill, doc, opts)` instead of `quill.render(doc, opts)`.
- `src/testing.ts` — same two call-site changes.
- `src/__tests__/helpers/mock-engine.ts` — `makeMockEngine` records `render(quill, doc)` calls instead of `quill(tree)` calls; new `mockQuillFromTree()` stubs the static constructor.
- `src/__tests__/integration.test.ts` — drop `{ engine }` from `getQuill`; assertions updated.
- `src/__tests__/quiver-resolve.test.ts` — tests 9–13 updated to use `mockQuillFromTree`; test 14 ("distinct engines get distinct quills") removed as no longer applicable; tests 24–26 rewritten for the new single-instance-per-ref semantics.
- `src/__tests__/preview.test.ts` — mock engine updated to `render(quill, doc, opts)`.

**Changed files in `tonguetoquill-web`:**
- `src/lib/services/quillmark/service.ts` — `quiver.getQuill(ref)` (no engine); `engine.supportedFormats(quill)` instead of `quill.metadata.supportedFormats`; `engine.render(quill, doc, opts)` instead of `quill.render(doc, opts)`.
- `src/lib/server/services/quillmark/service.ts` — `Quill.fromTree(tree)` instead of `engine.quill(tree)` in `loadQuill`; `QuillClass` field added to the service to hold the imported class for static-method access.
- `src/lib/services/quillmark/types.ts` — JSDoc updated to remove stale mention of `.render(doc, opts)` on `Quill`.
