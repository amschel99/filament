import type { FiberClient } from "../rpc/index.js";
import { ckbToShannonHex, fundingForInbound } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 3 — LiquidityService. The hub programmatically opens channels toward customers so they
 * can receive payments. provision() kicks off the open and persists PROVISIONING; the
 * ChannelMonitor is what flips the row to READY, and ONLY from observed list_channels state
 * (CLAUDE.md rule 4) — provision never assumes success just because open_channel returned.
 */
export interface ProvisionRequest {
  nodePubkey: string;
  nodeAddress?: string;
  inboundCkb: bigint;
}

export interface ProvisionPolicy {
  minCkb: bigint;
  maxCkb: bigint;
}

export class LiquidityService {
  constructor(
    private readonly hub: FiberClient,
    private readonly db: Db,
    private readonly policy: ProvisionPolicy = { minCkb: 100n, maxCkb: 100_000n },
  ) {}

  async provision(req: ProvisionRequest): Promise<{ requestId: string }> {
    if (req.inboundCkb < this.policy.minCkb || req.inboundCkb > this.policy.maxCkb) {
      throw new Error(
        `inbound ${req.inboundCkb} CKB outside policy [${this.policy.minCkb}, ${this.policy.maxCkb}]`,
      );
    }

    const requestId = `prov_${now().toString(36)}_${req.nodePubkey.slice(2, 10)}`;
    const fundingCkb = fundingForInbound(req.inboundCkb); // +99 CKB reserve
    const requestedInbound = ckbToShannonHex(req.inboundCkb);

    this.db
      .prepare(
        `INSERT INTO channels
           (request_id, peer_pubkey, requested_inbound_shannons, state, created_at, updated_at)
         VALUES (?, ?, ?, 'PROVISIONING', ?, ?)`,
      )
      .run(requestId, req.nodePubkey, requestedInbound, now(), now());

    try {
      if (req.nodeAddress) await this.hub.connectPeer({ address: req.nodeAddress });
      const opened = await this.hub.openChannel({
        peer_id: req.nodePubkey,
        funding_amount: ckbToShannonHex(fundingCkb),
        public: true,
      });
      this.db
        .prepare(`UPDATE channels SET temp_channel_id = ?, updated_at = ? WHERE request_id = ?`)
        .run(opened.temporary_channel_id, now(), requestId);
    } catch (err) {
      this.db
        .prepare(`UPDATE channels SET state = 'FAILED', fail_reason = ?, updated_at = ? WHERE request_id = ?`)
        .run(String(err instanceof Error ? err.message : err), now(), requestId);
    }

    return { requestId };
  }

  status(requestId: string) {
    return this.db.prepare(`SELECT * FROM channels WHERE request_id = ?`).get(requestId);
  }
}
