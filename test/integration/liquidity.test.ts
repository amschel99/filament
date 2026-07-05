import { describe, it, expect, beforeEach } from "vitest";
import { FakeFiberNetwork, shannonHexToShannon } from "../../src/rpc/index.js";
import { openDb, type Db } from "../../src/db/index.js";
import { LiquidityService } from "../../src/lsp/liquidity.js";
import { ChannelMonitor } from "../../src/lsp/monitor.js";

/**
 * M3 — liquidity provisioning, integration-tested against the fake fnn. Asserts the plan's core
 * invariants: the 99 CKB reserve is added to funding, the row stays PROVISIONING until the
 * monitor OBSERVES ChannelReady, and the temp channel-id resolves to the permanent one.
 */
describe("liquidity provisioning (M3)", () => {
  let net: FakeFiberNetwork;
  let db: Db;
  let hub: ReturnType<FakeFiberNetwork["client"]>;
  let customer: ReturnType<FakeFiberNetwork["client"]>;

  beforeEach(() => {
    net = new FakeFiberNetwork();
    db = openDb(":memory:");
    hub = net.client("hub");
    customer = net.client("customer1");
  });

  it("provision -> PROVISIONING, then monitor observes READY with resolved channel id", async () => {
    const lsp = new LiquidityService(hub, db);
    const monitor = new ChannelMonitor(hub, db);

    const { requestId } = await lsp.provision({ nodePubkey: customer.nodeId, inboundCkb: 500n });
    let row = lsp.status(requestId) as any;
    expect(row.state).toBe("PROVISIONING");
    expect(row.temp_channel_id).toMatch(/^0x/);
    expect(row.channel_id).toBeNull();

    // Before confirmations: monitor sees NegotiatingFunding -> still PROVISIONING.
    await monitor.tick();
    expect((lsp.status(requestId) as any).state).toBe("PROVISIONING");

    // Confirmations land, monitor observes ChannelReady.
    net.mine();
    expect(await monitor.tick()).toBe(1);
    row = lsp.status(requestId) as any;
    expect(row.state).toBe("READY");
    expect(row.channel_id).toMatch(/^0x/);

    // Hub funded inbound + 99 CKB reserve; usable hub-side balance == 599 - 99 = 500 CKB.
    expect(shannonHexToShannon(row.local_balance)).toBe(500n * 100_000_000n);
  });

  it("rejects provisioning outside policy bounds", async () => {
    const lsp = new LiquidityService(hub, db, { minCkb: 100n, maxCkb: 1000n });
    await expect(lsp.provision({ nodePubkey: customer.nodeId, inboundCkb: 5n })).rejects.toThrow(/policy/);
    await expect(lsp.provision({ nodePubkey: customer.nodeId, inboundCkb: 5000n })).rejects.toThrow(/policy/);
  });
});
