import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renderQuiverSamples } from "../preview.js";
import { Quill, type Quillmark } from "@quillmark/wasm";

// Fixture: `memo` and `plain` both render via their example documents.
const PREVIEW_FIXTURE = fileURLToPath(
  new URL("./fixtures/preview-quiver", import.meta.url),
);

const tempDirs: string[] = [];
function makeOutDir(): string {
  const dir = join(tmpdir(), `quiver-preview-${randomUUID()}`);
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const MOCK_EXAMPLE = "---\nQUILL: mock\n---\n\n# Mock example";

/**
 * Stub `Quill.fromTree` (now the engine-free construction path `getQuill`
 * uses) so each preview quill seeds the mock markdown without the real WASM
 * validator. Returns a fresh fake `Quill` whose `seedDocument` carries the
 * markdown the engine echoes back.
 */
function stubQuillFromTree(
  seed: () => unknown = () => ({ md: MOCK_EXAMPLE }),
): void {
  vi.spyOn(Quill, "fromTree").mockImplementation(
    () => ({ seedDocument: seed }) as unknown as Quill,
  );
}

/** Mock engine whose render echoes the seeded document markdown as artifact bytes. */
function makeEngine(): Quillmark {
  return {
    render(_quill: unknown, doc: unknown, opts: unknown) {
      const md = (doc as { md: string }).md;
      const format = (opts as { format?: string } | undefined)?.format ?? "pdf";
      return {
        artifacts: [{ format, bytes: new TextEncoder().encode(md) }],
        warnings: [{ severity: "warning", message: "mock warning" }],
      };
    },
  } as unknown as Quillmark;
}

describe("renderQuiverSamples", () => {
  it("renders every quill using its example", async () => {
    stubQuillFromTree();
    const outDir = makeOutDir();
    const results = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir,
      quiet: true,
    });

    expect(results).toHaveLength(2);

    const memo = results.find((r) => r.ref === "memo@1.0.0")!;
    expect(memo.status).toBe("rendered");
    expect(memo.files).toEqual(["memo@1.0.0.pdf"]);
    expect(memo.warnings).toEqual(["warning: mock warning"]);

    const plain = results.find((r) => r.ref === "plain@1.0.0")!;
    expect(plain.status).toBe("rendered");
    expect(plain.files).toEqual(["plain@1.0.0.pdf"]);
  });

  it("writes the rendered artifact bytes to disk", async () => {
    stubQuillFromTree();
    const outDir = makeOutDir();
    await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir,
      quiet: true,
    });

    const artifact = await readFile(join(outDir, "memo@1.0.0.pdf"), "utf8");
    expect(artifact).toContain("# Mock example");
  });

  it("writes an index.html gallery", async () => {
    stubQuillFromTree();
    const outDir = makeOutDir();
    await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir,
      quiet: true,
    });

    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).toContain("Quiver preview — preview");
    expect(html).toContain("memo@1.0.0.pdf");
    expect(html).not.toContain('class="card skipped"');
  });

  it("honors a forced output format", async () => {
    stubQuillFromTree();
    const outDir = makeOutDir();
    const results = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir,
      format: "svg",
      quiet: true,
    });

    const memo = results.find((r) => r.ref === "memo@1.0.0")!;
    expect(memo.files).toEqual(["memo@1.0.0.svg"]);
    const files = await readdir(outDir);
    expect(files).toContain("memo@1.0.0.svg");
  });

  it("records a render failure without aborting the run", async () => {
    stubQuillFromTree(() => ({}));
    const outDir = makeOutDir();
    const explodingEngine = {
      render() {
        throw new Error("boom");
      },
    } as unknown as Quillmark;

    const results = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: explodingEngine,
      outDir,
      quiet: true,
    });

    expect(results.every((r) => r.status === "failed")).toBe(true);
    expect(results.find((r) => r.ref === "memo@1.0.0")!.reasons).toEqual([
      "boom",
    ]);
    expect(results.find((r) => r.ref === "plain@1.0.0")!.reasons).toEqual([
      "boom",
    ]);
  });

  it("surfaces every diagnostic from a failed render", async () => {
    stubQuillFromTree(() => ({}));
    const outDir = makeOutDir();
    const explodingEngine = {
      render() {
        const err = new Error("2 error(s): first") as Error & {
          diagnostics: { severity: string; message: string }[];
        };
        err.diagnostics = [
          { severity: "error", message: "first" },
          { severity: "error", message: "second" },
        ];
        throw err;
      },
    } as unknown as Quillmark;

    const results = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: explodingEngine,
      outDir,
      quiet: true,
    });

    const memo = results.find((r) => r.ref === "memo@1.0.0")!;
    expect(memo.status).toBe("failed");
    expect(memo.reasons).toEqual(["error: first", "error: second"]);

    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).toContain("error: first");
    expect(html).toContain("error: second");
  });

  it("filters quills with include and exclude", async () => {
    stubQuillFromTree();
    const includeOnly = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir: makeOutDir(),
      quiet: true,
      include: ["memo"],
    });
    expect(includeOnly.map((r) => r.ref)).toEqual(["memo@1.0.0"]);

    const excluded = await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir: makeOutDir(),
      quiet: true,
      exclude: ["memo@1.0.0"],
    });
    expect(excluded.map((r) => r.ref)).toEqual(["plain@1.0.0"]);
  });

  it("writes a .gitignore into the output directory", async () => {
    stubQuillFromTree();
    const outDir = makeOutDir();
    await renderQuiverSamples(PREVIEW_FIXTURE, {
      engine: makeEngine(),
      outDir,
      quiet: true,
    });

    const gitignore = await readFile(join(outDir, ".gitignore"), "utf8");
    expect(gitignore.trim()).toBe("*");
  });
});
