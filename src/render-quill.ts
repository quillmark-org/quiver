// Render-path escape hatch: materialize a Quill in a *backend* build's WASM
// memory from a quiver's canonical file tree.
//
// `Quiver` itself is render-less — it imports `@quillmark/wasm/core`, so
// `getQuill(ref)` returns a *core*-build Quill. core and render are separate
// WASM linear memories, so a core Quill cannot be passed to a render engine
// (`engine.render` throws `expected instance of Quill`). This module does not
// import any backend build: the caller injects the `Quill` from the *same*
// build as their engine, and we re-feed the tree to it.

import type { Quiver } from "./quiver.js";

/**
 * The constructor surface every backend build's `Quill` exposes — its static
 * `fromTree`. Generic so this module never imports a backend build; the caller
 * supplies the concrete class (e.g. `import { Quill } from "@quillmark/wasm"`).
 */
export interface QuillCtor<Q> {
  fromTree(tree: Map<string, Uint8Array>): Q;
}

/**
 * Materialize a Quill in a render (backend) build's WASM memory from the
 * canonical tree for `ref`.
 *
 * Use this on every render path. Do **not** pass the result of
 * `quiver.getQuill(ref)` to `engine.render`: that is a *core*-build Quill, and
 * because core and render are separate WASM linear memories, the render engine
 * rejects it (`expected instance of Quill`). Crossing the boundary is done as
 * data — this re-feeds the file tree to the render build's `Quill.fromTree`.
 * The tree is served from Quiver's cache, so this is I/O-free once the ref has
 * been resolved (or warmed, or materialized via `getQuill`) once.
 *
 * ```ts
 * import { Quill } from "@quillmark/wasm";          // render build
 * const quill = await loadRenderQuill(quiver, ref, Quill);
 * const doc   = quill.seedDocument();               // render memory
 * engine.render(quill, doc);
 * ```
 *
 * `Quill` must come from the same build as the engine you render with.
 */
export async function loadRenderQuill<Q>(
  quiver: Quiver,
  ref: string,
  Quill: QuillCtor<Q>,
): Promise<Q> {
  return Quill.fromTree(await quiver.getTree(ref));
}
