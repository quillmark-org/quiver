/**
 * Convenience test harness for Quiver authors using `node:test`.
 *
 * Built into Node 18+; no extra test-runner dependency required. If you
 * prefer vitest, jest, or another runner, write a 12-line loop against
 * the main API instead — every primitive used here is public.
 *
 * Usage (place this file next to your Quiver.yaml):
 *
 *   import { Quill, Quillmark } from "@quillmark/wasm";
 *   import { runQuiverTests } from "@quillmark/quiver/testing";
 *   const engine = new Quillmark();
 *   runQuiverTests(import.meta.url, engine, Quill);
 *
 * Run with `node --test`.
 */

import { describe, it, before } from "node:test";
// Import from the Node entry: this installs the runtime patch so
// `Quiver.fromDir` is callable at runtime, and gives us the augmented
// static-method type signature.
import { Quiver } from "./node.js";
import { loadRenderQuill, type QuillCtor } from "./render-quill.js";
import type { Quillmark, Quill as RenderQuill } from "@quillmark/wasm";

/**
 * Registers a `node:test` describe block that validates every quill
 * version in the quiver at `metaUrlOrDir` against the provided engine.
 *
 * Pass `import.meta.url` when this file lives at the quiver root (next
 * to Quiver.yaml). Pass an absolute directory path for any other layout.
 *
 * Validation covers the full loading pipeline: Quiver.yaml, Quill.yaml,
 * all template files, quill construction via Quill.fromTree(tree), and a
 * full render of each quill's example document via engine.render(quill, doc).
 */
export function runQuiverTests(
  metaUrlOrDir: string,
  engine: Quillmark,
  Quill: QuillCtor<RenderQuill>,
): void {
  describe("Quiver", () => {
    let quiver!: Quiver;

    before(async () => {
      quiver = await Quiver.fromDir(metaUrlOrDir);
    });

    it("has at least one quill", () => {
      if (quiver.quillNames().length === 0) {
        throw new Error("Quiver has no quills");
      }
    });

    it("compiles and renders every quill's example without error", async () => {
      for (const name of quiver.quillNames()) {
        for (const version of quiver.versionsOf(name)) {
          const ref = `${name}@${version}`;
          // Materialize in the engine's (render) memory — a core-build Quill
          // from `quiver.getQuill` cannot cross into `engine.render`.
          const quill = await loadRenderQuill(quiver, ref, Quill);
          const doc = quill.seedDocument();
          const result = engine.render(quill, doc) as {
            artifacts?: unknown[];
          };
          if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
            throw new Error(`${ref}: example render produced no artifacts`);
          }
        }
      }
    });
  });
}
