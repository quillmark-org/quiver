import { describe, it, expect, afterEach, vi } from "vitest";
import { Quiver } from "../node.js";
import { loadRenderQuill, type QuillCtor } from "../render-quill.js";
import { mockQuillFromTree } from "./helpers/mock-engine.js";

const SAMPLE_FIXTURE = new URL("./fixtures/sample-quiver", import.meta.url)
  .pathname;

/**
 * Stand-in for a *render* build's `Quill`, living in its own "memory". Records
 * every tree handed to `fromTree` and returns a single sentinel instance.
 */
function fakeRenderQuill() {
  const calls: Array<Map<string, Uint8Array>> = [];
  const sentinel = { seedDocument: () => ({}) };
  const Quill: QuillCtor<typeof sentinel> = {
    fromTree(tree) {
      calls.push(tree);
      return sentinel;
    },
  };
  return { calls, sentinel, Quill };
}

describe("loadRenderQuill (render-path escape hatch)", () => {
  // Spy the CORE build's `Quill.fromTree` to prove the render path never
  // touches it — that crossing is exactly the C1 boundary bug.
  let coreStub: ReturnType<typeof mockQuillFromTree> | undefined;
  afterEach(() => {
    coreStub?.restore();
    coreStub = undefined;
    vi.restoreAllMocks();
  });

  it("materializes via getTree + the injected render Quill, never the core Quill (regression-guards C1)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    coreStub = mockQuillFromTree();
    const render = fakeRenderQuill();

    const quill = await loadRenderQuill(quiver, "memo@1.0.0", render.Quill);

    // The render ctor received the real fixture tree (it came from getTree)…
    expect(quill).toBe(render.sentinel);
    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]!.has("Quill.yaml")).toBe(true);
    // …and the CORE Quill.fromTree was never invoked — the engine would only
    // ever see the render handle. This is the guard C1 was missing.
    expect(coreStub.calls).toHaveLength(0);
  });

  it("resolves selector refs through getTree", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const render = fakeRenderQuill();

    await loadRenderQuill(quiver, "memo", render.Quill); // selector → memo@1.1.0

    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("reuses the tree getQuill already cached — no second fetch (tree retention)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    coreStub = mockQuillFromTree();
    const render = fakeRenderQuill();
    const loadTreeSpy = vi.spyOn(quiver, "loadTree");

    // Editor/validation path materializes the core quill — and retains the tree.
    await quiver.getQuill("memo@1.0.0");
    expect(loadTreeSpy).toHaveBeenCalledTimes(1);

    // Render path for the same ref reuses that retained tree: no refetch.
    await loadRenderQuill(quiver, "memo@1.0.0", render.Quill);
    expect(loadTreeSpy).toHaveBeenCalledTimes(1);
    expect(render.calls).toHaveLength(1);
  });
});
