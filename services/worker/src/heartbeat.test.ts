import { describe, expect, it } from "vitest";
import { parseHeartbeatLine, scanHeartbeats } from "./index";

describe("parseHeartbeatLine", () => {
  it("parses a well-formed heartbeat", () => {
    const r = parseHeartbeatLine('{"kind":"progress","phase":"simulating","fraction":0.37}');
    expect(r).toEqual({ fraction: 0.37, phase: "simulating", simulatorFraction: undefined });
  });

  it("extracts simulatorFraction when present", () => {
    const r = parseHeartbeatLine(
      '{"kind":"progress","phase":"simulating","fraction":0.5,"simulatorFraction":0.75}'
    );
    expect(r?.simulatorFraction).toBe(0.75);
  });

  it("returns undefined for non-progress JSON", () => {
    expect(parseHeartbeatLine('{"kind":"error","message":"bad"}')).toBeUndefined();
  });

  it("returns undefined for plain log lines", () => {
    expect(parseHeartbeatLine("[info] done compiling")).toBeUndefined();
  });

  it("returns undefined for malformed JSON that looks JSON-ish", () => {
    expect(parseHeartbeatLine("{not valid json")).toBeUndefined();
  });

  it("trims leading whitespace", () => {
    const r = parseHeartbeatLine('   {"kind":"progress","fraction":1}   ');
    expect(r?.fraction).toBe(1);
  });
});

describe("scanHeartbeats", () => {
  it("parses multiple heartbeats in one chunk", () => {
    const chunk =
      '{"kind":"progress","fraction":0.1}\n{"kind":"progress","fraction":0.2}\n{"kind":"progress","fraction":0.3}\n';
    const r = scanHeartbeats(chunk, "");
    expect(r.events).toHaveLength(3);
    expect(r.events.map((e) => e.fraction)).toEqual([0.1, 0.2, 0.3]);
    expect(r.remainder).toBe("");
  });

  it("buffers partial lines across chunks", () => {
    const first = scanHeartbeats('{"kind":"progress","fract', "");
    expect(first.events).toEqual([]);
    expect(first.remainder).toBe('{"kind":"progress","fract');

    const second = scanHeartbeats('ion":0.5}\n', first.remainder);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].fraction).toBe(0.5);
    expect(second.remainder).toBe("");
  });

  it("silently drops non-progress lines", () => {
    const chunk =
      '[info] hello\n{"kind":"progress","fraction":0.4}\n[warn] oops\n{"not":"json"}\n';
    const r = scanHeartbeats(chunk, "");
    expect(r.events).toHaveLength(1);
    expect(r.events[0].fraction).toBe(0.4);
  });

  it("preserves a trailing fragment with no newline", () => {
    const r = scanHeartbeats(
      '{"kind":"progress","fraction":0.1}\n{"kind":"progress","fraction":0.2}',
      ""
    );
    expect(r.events).toHaveLength(1);
    expect(r.remainder).toBe('{"kind":"progress","fraction":0.2}');
  });
});
