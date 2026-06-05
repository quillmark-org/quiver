/**
 * Minimal structural types matching @quillmark/wasm >=0.88.0.
 *
 * Shape:
 *   class Quillmark { quill(tree: Map<string, Uint8Array>): Quill }
 *   class Quill     { render(doc, opts?): RenderResult; open(doc): RenderSession;
 *                     seedDocument(): Document }
 *
 * The first arg to `render`/`open` is a `Document` instance (from
 * `Document.fromMarkdown(...)` or `quill.seedDocument()`). Quiver keeps the
 * arg typed as `unknown` so consumers (and test doubles) satisfy the contract
 * structurally without importing from @quillmark/wasm.
 *
 * These types are re-exported from `index.ts` so consumers can type their
 * own engine wrappers / test doubles against them. Quiver itself never
 * imports from @quillmark/wasm directly.
 *
 * Call-site note: Quiver never invokes `render` or `open` itself; consumers do
 * after `getQuill()`. The loose `unknown` parameter typing is intentional.
 */

export interface QuillmarkLike {
  quill(tree: Map<string, Uint8Array>): QuillLike;
}

export interface QuillLike {
  render(doc: unknown, opts?: unknown): unknown;
  open?: (doc: unknown) => unknown;
  /**
   * Auto-generated annotated Markdown blueprint for LLM/authoring consumers.
   * Carries `<must-fill>` sentinels for unendorsed fields, so it is *not*
   * directly renderable — render `seedDocument()` instead.
   */
  blueprint: string;
  /**
   * Seeds the illustrative "filled-out" reference document — always
   * renderable — and returns it as a `Document` instance ready to pass to
   * `render`. Each field commits its `example:` value (else its `default:`,
   * else a type-empty zero value), with no `<must-fill>` sentinels. Replaces
   * the string-valued `example` getter removed in @quillmark/wasm 0.88.0.
   * Used by Quiver's preview/testing helpers to render a sample artifact for
   * each quill.
   */
  seedDocument(): unknown;
}
