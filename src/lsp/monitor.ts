import type { FiberClient } from "../rpc/index.js";
import { normalizeChannelState, ChannelState } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 3 — Channel monitor. Reconciles list_channels into the DB: resolves the temp -> permanent
 * channel-id transition, updates state, and copies OBSERVED local/remote balances. The DB is the
 * source of truth for the balance/liquidity endpoints and rebalancing, but every value here comes
 * from this poll, never from an assumed side effect (CLAUDE.md rule 4).
 */
const STATE_MAP: Record<ChannelState, string> = {
  [ChannelState.NegotiatingFunding]: "PROVISIONING",
  [ChannelState.CollaboratingFundingTx]: "PROVISIONING",
  [ChannelState.SigningCommitment]: "PROVISIONING",
  [ChannelState.AwaitingTxSignatures]: "PROVISIONING",
  [ChannelState.AwaitingChannelReady]: "PROVISIONING",
  [ChannelState.ChannelReady]: "READY",
  [ChannelState.ShuttingDown]: "CLOSING",
  [ChannelState.Closed]: "CLOSED",
  [ChannelState.Unknown]: "PROVISIONING",
};

interface ObservedChannel {
  channel_id?: string;
  pubkey?: string; // peer pubkey (rc5: list_channels exposes `pubkey`, and NO temporary id)
  state?: { state_name?: string } | string;
  local_balance?: string;
  remote_balance?: string;
}

export class ChannelMonitor {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly hub: FiberClient,
    private readonly db: Db,
    private readonly intervalMs = 5000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One reconciliation pass. Returns the number of DB rows updated. */
  async tick(): Promise<number> {
    const { channels } = (await this.hub.listChannels()) as { channels: ObservedChannel[] };
    let updated = 0;

    for (const ch of channels) {
      const rawName = typeof ch.state === "string" ? ch.state : ch.state?.state_name;
      const dbState = STATE_MAP[normalizeChannelState(rawName)];

      // Match a tracked row. list_channels has the permanent channel_id from the start (no temp
      // id), so bind by channel_id once known, else adopt the first still-provisioning row for
      // this peer pubkey.
      const row = this.db
        .prepare(
          `SELECT id FROM channels
             WHERE channel_id = ?
                OR (channel_id IS NULL AND state = 'PROVISIONING' AND peer_pubkey = ?)
             LIMIT 1`,
        )
        .get(ch.channel_id ?? "", ch.pubkey ?? "") as { id: number } | undefined;
      if (!row) continue; // a channel we didn't provision (e.g. inbound) — ignored in v0

      const res = this.db
        .prepare(
          `UPDATE channels
             SET channel_id = COALESCE(?, channel_id),
                 state = ?, local_balance = ?, remote_balance = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          ch.channel_id ?? null,
          dbState,
          ch.local_balance ?? null,
          ch.remote_balance ?? null,
          now(),
          row.id,
        );
      if (res.changes > 0) updated++;
    }
    return updated;
  }
}
