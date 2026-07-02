import type { FiberClient } from "../rpc/index.js";
import type { Db } from "../db/index.js";

/**
 * Phase 3 — Rebalancer (v0). Detect channels where hub local_balance < threshold and issue a
 * circular self-payment to top them up:
 *   send_payment { target_pubkey: <hub own pubkey>, amount, keysend: true, allow_self_payment: true }
 * (incompatible with trampoline routing.)
 *
 * Requires >= 2 channels and a circular route — only testable once Phase 6's customer2↔hub↔customer1
 * triangle exists. CLAUDE.md rule 4 / plan note: STUB with a clear TODO, do NOT fake success.
 */
export class Rebalancer {
  constructor(
    private readonly hub: FiberClient,
    private readonly db: Db,
    private readonly thresholdShannons: bigint,
  ) {}

  async run(): Promise<void> {
    // TODO(Phase 6): un-stub against the real triangle. Until then this is intentionally inert.
    void this.hub;
    void this.db;
    void this.thresholdShannons;
    throw new Error("Rebalancer not implemented until Phase 6 (needs circular route to exist)");
  }
}
