// Render-path escape hatch: cross the core→render WASM-memory boundary as DATA.
//
// `Quiver` itself is render-less — it imports `@quillmark/wasm/core`, so
// `getQuill(ref)` returns a *core*-build Quill (and a `Document` seeded from it
// lives in core memory). core and render are separate WASM linear memories, so
// a core handle cannot be passed to a render engine (`engine.render` throws
// `expected instance of Quill` / `expected instance of Document`). This module
// does not import any backend build: the caller injects the `Quill`/`Document`
// from the *same* build as their engine, and we re-feed the data to them —
// a Quill via its file tree (`fromTree`), a Document via its JSON (`fromJson`).
//
// Every render path should cross the boundary through these helpers; do not
// open-code `Quill.fromTree(...)` / `Document.fromJson(coreDoc.toJson())`.

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
 * const doc   = quill.seedDocument();               // already render memory
 * engine.render(quill, doc);
 * ```
 *
 * If your `Document` instead originated in the *core* build (e.g. seeded from
 * `quiver.getQuill(ref)`), cross it with {@link toRenderDocument} before
 * rendering.
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

/**
 * The constructor surface every backend build's `Document` exposes — its static
 * `fromJson`. Generic so this module never imports a backend build; the caller
 * supplies the concrete class (e.g. `import { Document } from "@quillmark/wasm"`).
 */
export interface DocumentCtor<D> {
  fromJson(json: string): D;
}

/**
 * Bridge a *core*-build `Document` into a render (backend) build's WASM memory
 * as data.
 *
 * A `Document` seeded from `quiver.getQuill(ref)` (or otherwise produced by the
 * `@quillmark/wasm/core` build) lives in the core build's WASM linear memory.
 * Passing it to a render engine fails the same way a core Quill does, because
 * core and render are separate memories — `engine.render` rejects it
 * (`expected instance of Document`). Crossing the boundary is done as data:
 * this serializes the core doc to JSON and re-hydrates it with the render
 * build's `Document.fromJson`. No backend build is imported here; the caller
 * injects the `Document` class.
 *
 * ```ts
 * import { Document } from "@quillmark/wasm";        // render build
 * const coreDoc = (await quiver.getQuill(ref)).seedDocument(); // core memory
 * const doc     = toRenderDocument(coreDoc, Document);         // render memory
 * engine.render(quill, doc);
 * ```
 *
 * `Document` must come from the same build as the engine you render with — the
 * same build whose `Quill` you passed to {@link loadRenderQuill}.
 */
export function toRenderDocument<D>(
  coreDoc: { toJson(): string },
  Document: DocumentCtor<D>,
): D {
  return Document.fromJson(coreDoc.toJson());
}
