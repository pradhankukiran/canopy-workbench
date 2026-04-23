import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ARTIFACTS, summarizeDataSources } from "./data-sources";
import { tmpdir } from "node:os";

describe("data-sources", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "canopy-ds-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("default artifact list has the three shipped entries", () => {
    const ids = DEFAULT_ARTIFACTS.map((a) => a.id).sort();
    expect(ids).toContain("natural-earth-10m-land");
    expect(ids).toContain("slosh-meow-gulf");
    expect(ids).toContain("etopo-2022-60s");
  });

  it("reports missing for an empty cache directory", async () => {
    const s = await summarizeDataSources(DEFAULT_ARTIFACTS, tempDir);
    expect(s.cacheDir).toBe(tempDir);
    expect(s.artifacts.every((a) => a.state === "missing")).toBe(true);
  });

  it("reports ready for a cached artifact with blank sha256", async () => {
    const cached = {
      id: "synthetic",
      kind: "test",
      description: "synthetic",
      url: "file:///x",
      sha256: "",
      localFileName: "syn.bin",
      approximateMb: 1,
      license: "test"
    };
    await fs.writeFile(path.join(tempDir, cached.localFileName), "hello");
    const s = await summarizeDataSources([cached], tempDir);
    expect(s.artifacts[0].state).toBe("ready");
    expect(s.artifacts[0].sizeBytes).toBe(5);
    expect(s.artifacts[0].sha256).toBeDefined();
  });

  it("reports unavailable when sha mismatches", async () => {
    const pinned = {
      id: "pinned",
      kind: "test",
      description: "pinned",
      url: "file:///x",
      sha256: "deadbeef",
      localFileName: "pin.bin",
      approximateMb: 1,
      license: "test"
    };
    await fs.writeFile(path.join(tempDir, pinned.localFileName), "hello");
    const s = await summarizeDataSources([pinned], tempDir);
    expect(s.artifacts[0].state).toBe("unavailable");
    expect(s.artifacts[0].reason).toMatch(/sha256/i);
  });
});
