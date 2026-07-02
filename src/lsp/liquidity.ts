import type { FiberClient } from "../rpc/index.js";
import { fundingForInbound, shannonToHex } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 3 — LiquidityService. The hub programmatically opens channels toward customers.
 *
 * STATUS: skeleton. The `provision` flow below is the intended shape; the background poll to
 * READY (handling temp→permanent channel-id transition) is stubbed until M2 confirms the exact
 * open_channel / list_channels wire shapes. CLAUDE.md rule 4: the READY transition MUST come
 * from an observed list_channels state, never from "open_channel returned".
 */
export interface ProvisionRequest {
  nodePubkey: string;
  nodeAddress?: string;
  inboundCkb: bigint;
}

export class LiquidityService {
  constructor(
    private readonly hub: FiberClient,
    private readonly db: Db,
  ) {}

  /** Kick off provisioning; returns the request id the API polls on. */
  async provision(req: ProvisionRequest): Promise<{ requestId: string }> {
    const requestId = `prov_${now().toString(36)}_${req.nodePubkey.slice(2, 10)}`;
    const funding = fundingForInbound(req.inboundCkb);

    this.db
      .prepare(
        `INSERT INTO channels
           (request_id, peer_pubkey, requested_inbound_shannons, state, created_at, updated_at)
         VALUES (?, ?, ?, 'PROVISIONING', ?, ?)`,
      )
      .run(requestId, req.nodePubkey, shannonToHex(req.inboundCkb * 100_000_000n), now(), now());

    // TODO(Phase 3): connect_peer(nodeAddress ?? resolved-from-graph) -> open_channel
    //   { peer_id: nodePubkey, funding_amount: ckbToShannonHex(funding), public: true }
    //   Persist temp_channel_id, then hand off to the channel monitor's background poll.
    void funding;
    void this.hub;

    return { requestId };
  }
}
