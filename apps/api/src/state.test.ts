import { describe, expect, it } from "vitest";
import { DEFAULT_REDIS_PREFIX, DEFAULT_RUN_QUEUE_NAME } from "./state";

describe("state exports", () => {
  it("uses the phase1 queue name contract", () => {
    expect(DEFAULT_RUN_QUEUE_NAME).toBe("canopy_phase1_runs");
  });

  it("uses the phase1 redis prefix contract", () => {
    expect(DEFAULT_REDIS_PREFIX).toBe("canopy:phase1");
  });
});
