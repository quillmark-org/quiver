import { vi, type MockInstance } from "vitest";
import { Quill, type Quillmark, type Document } from "@quillmark/wasm";

/**
 * Stubs `Quill.fromTree` so tests can exercise `Quiver.getQuill` without the
 * real WASM validator (quill construction is now engine-free — `getQuill`
 * calls `Quill.fromTree(tree)` directly). Each call records the tree it was
 * given and returns a fresh fake `Quill` whose identity tracks the
 * caching/coalescing behavior under test.
 *
 * Returns `calls` (the trees passed to `Quill.fromTree`, in order) and a
 * `restore()` to undo the stub. Install in `beforeEach`/at test top and call
 * `restore()` after.
 */
export function mockQuillFromTree(): {
  calls: Array<Map<string, Uint8Array>>;
  spy: MockInstance;
  restore: () => void;
} {
  const calls: Array<Map<string, Uint8Array>> = [];
  const spy = vi
    .spyOn(Quill, "fromTree")
    .mockImplementation((tree: Map<string, Uint8Array>): Quill => {
      calls.push(tree);
      return { seedDocument: () => ({}) } as unknown as Quill;
    });
  return { calls, spy, restore: () => spy.mockRestore() };
}

/**
 * In-test mock for the Quillmark engine. Records every
 * `engine.render(quill, doc)` call. Quill construction is now engine-free
 * (`Quill.fromTree`), so the engine only renders. The mock implements only
 * the slice of the engine contract Quiver exercises, so it is cast to the
 * real `@quillmark/wasm` types.
 */
export function makeMockEngine(): {
  renders: Array<{ quill: Quill; doc: Document }>;
  engine: Quillmark;
} {
  const renders: Array<{ quill: Quill; doc: Document }> = [];
  const engine = {
    render(quill: Quill, doc: Document): unknown {
      renders.push({ quill, doc });
      return { ok: true };
    },
  } as unknown as Quillmark;
  return { renders, engine };
}
