import { describe, expect, it } from "vitest";
import { DEFAULT_REDIS_PREFIX, DEFAULT_RUN_QUEUE_NAME } from "./state";

describe("worker state exports", () => {
  it("agrees with the API on the queue name", () => {
    expect(DEFAULT_RUN_QUEUE_NAME).toBe("canopy_phase1_runs");
  });

  it("agrees with the API on the redis prefix", () => {
    expect(DEFAULT_REDIS_PREFIX).toBe("canopy:phase1");
  });
});
