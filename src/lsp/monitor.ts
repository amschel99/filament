import type { FiberClient } from "../rpc/index.js";
import { normalizeChannelState, ChannelState } from "../rpc/index.js";
import type { Db } from "../db/index.js";

/**
 * Phase 3 — Channel monitor. A ~5s poller that reconciles list_channels into the DB:
 * state transitions, local/remote balances, closed/abandoned channels.
 *
 * CLAUDE.md rule 4: the DB is source of truth for endpoints & rebalancing, but every value
 * it holds must come from THIS observed poll — never from an assumed RPC side effect.
 *
 * STATUS: skeleton. tick() is where reconciliation lands once list_channels' rc5 shape is
 * pinned by the M2 suite.
 */
export class ChannelMonitor {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly hub: FiberClient,
    private readonly db: Db,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One reconciliation pass. */
  async tick(): Promise<void> {
    const { channels } = await this.hub.listChannels();
    for (const ch of channels) {
      const rawName =
        typeof ch.state === "string" ? ch.state : ch.state?.state_name;
      const state = normalizeChannelState(rawName);
      // TODO(Phase 3): upsert channel row keyed by channel_id; map ChannelState -> DB state,
      //   copy observed local_balance/remote_balance, resolve temp_channel_id -> channel_id.
      void state;
      void ChannelState;
      void this.db;
    }
  }
}
