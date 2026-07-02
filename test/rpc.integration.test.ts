import { describe, it, expect } from "vitest";
import { RawFiberClient } from "../src/rpc/client.js";

/**
 * Phase 2 — THE version-drift detector (CLAUDE.md rule 1). Runs against the LIVE devnet hub.
 * When a future fnn upgrade breaks an RPC shape, it must break HERE first, loudly.
 *
 * Skipped unless RUN_INTEGRATION=1 and a hub node is reachable, so `npm test` stays green
 * without a running devnet.
 */
const RUN = process.env.RUN_INTEGRATION === "1";
const HUB_RPC = process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227";

describe.skipIf(!RUN)("rpc integration (live devnet hub)", () => {
  const hub = new RawFiberClient("hub", HUB_RPC);

  it("node_info returns a pubkey", async () => {
    const info = await hub.nodeInfo();
    expect(info.node_id ?? (info as Record<string, unknown>).pubkey).toBeTruthy();
  });

  it("list_channels returns a channels array", async () => {
    const res = await hub.listChannels();
    expect(Array.isArray(res.channels)).toBe(true);
  });

  // TODO(Phase 2): exercise every FiberClient method and snapshot the observed shapes.
});
