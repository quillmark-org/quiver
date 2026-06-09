import { describe, it, expect, afterEach, vi } from "vitest";
import { Quiver } from "../node.js";
import {
  loadRenderQuill,
  toRenderDocument,
  type QuillCtor,
  type DocumentCtor,
} from "../render-quill.js";
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

  it("getTree returns a structurally valid tree usable by Quill.fromTree (render-path data contract)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);

    // getTree is the wire format the render build's `Quill.fromTree(tree)`
    // consumes: a Map<string, Uint8Array> that always carries `Quill.yaml`.
    // Asserting this shape guards the render path's contract without needing
    // the (72 MB) render WASM build at test time.
    const tree = await quiver.getTree("memo@1.0.0");

    expect(tree).toBeInstanceOf(Map);
    expect(tree.has("Quill.yaml")).toBe(true);
    for (const [path, bytes] of tree) {
      expect(typeof path).toBe("string");
      expect(bytes).toBeInstanceOf(Uint8Array);
    }

    // The injected render-Quill ctor (a stand-in for `@quillmark/wasm`'s real
    // `Quill.fromTree`) accepts exactly this Map shape.
    const render = fakeRenderQuill();
    const quill = render.Quill.fromTree(tree);
    expect(quill).toBe(render.sentinel);
  });

  // PENDING: full real-engine render integration.
  //
  // A true end-to-end test — getTree(ref) → render-build `Quill.fromTree(tree)`
  // → `seedDocument` → `new Quillmark().render(quill, doc, opts)` asserting a
  // real artifact — is NOT yet implementable here. Two blockers:
  //   1. The render build (`@quillmark/wasm` root, ~72 MB Typst WASM) is a
  //      heavyweight, environment-dependent dependency.
  //   2. None of the current fixtures are *renderable* quills: their Quill.yaml
  //      is a bare `name:` with no `quill:` section / backend / glue, so the
  //      render build's real `Quill.fromTree` rejects them
  //      ("Missing required 'quill' section in Quill.yaml"). A real render test
  //      would require authoring a complete renderable quill fixture (backend
  //      declaration, glue template, fonts/assets) — heavy new infra.
  // When a renderable fixture + the render build are wired into CI, replace this
  // with a skip-guarded real `engine.render(...)` artifact assertion.
  it.skip("real-engine round-trip: getTree → render Quill.fromTree → engine.render produces an artifact", () => {});
});

describe("toRenderDocument (Document-half boundary crossing)", () => {
  /**
   * Stand-in for a *render* build's `Document`, living in its own "memory".
   * Records every JSON handed to `fromJson` and tags the result so we can
   * prove the returned handle came from the injected (render) ctor — never
   * from the core doc directly.
   */
  function fakeRenderDocument() {
    const calls: string[] = [];
    const Document: DocumentCtor<{ memory: "render"; json: string }> = {
      fromJson(json) {
        calls.push(json);
        return { memory: "render", json };
      },
    };
    return { calls, Document };
  }

  it("round-trips a core doc through toJson → injected render fromJson", () => {
    const coreDoc = { toJson: () => '{"markdown":"# hi"}' };
    const render = fakeRenderDocument();

    const doc = toRenderDocument(coreDoc, render.Document);

    // The render ctor saw exactly the core doc's JSON…
    expect(render.calls).toEqual(['{"markdown":"# hi"}']);
    // …and the returned handle is the render-memory one, not the core doc.
    expect(doc).toEqual({ memory: "render", json: '{"markdown":"# hi"}' });
    expect(doc).not.toBe(coreDoc);
  });

  it("calls the core doc's toJson exactly once", () => {
    const toJson = vi.fn(() => "{}");
    const render = fakeRenderDocument();

    toRenderDocument({ toJson }, render.Document);

    expect(toJson).toHaveBeenCalledTimes(1);
  });
});
