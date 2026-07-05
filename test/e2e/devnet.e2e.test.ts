import { describe, it, expect, beforeAll } from "vitest";
import { RawFiberClient, normalizeChannelState, ChannelState } from "../../src/rpc/index.js";

/**
 * E2E — the real thing, verified against LIVE fnn v0.9.0-rc5 nodes on a local CKB devnet.
 * This is the smoke loop (open -> pay -> close) as an automated test and is the SAME flow the
 * integration suite proves against the fake. It is also the M2 version-drift tripwire: it already
 * caught the rc5 rename open_channel.peer_id -> pubkey and node_info -> pubkey (CLAUDE.md rule 1).
 *
 * Opt-in: RUN_E2E=1 with the devnet up (infra binaries + 3 fnn nodes). `npm run test:e2e`.
 * On this devnet blocks are minted on demand via the CKB IntegrationTest `generate_block` RPC,
 * so the test mines while polling the funding tx to confirmation.
 */
const RUN = process.env.RUN_E2E === "1";
const HUB = process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227";
const CUST1 = process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237";
const CKB = process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mine(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await fetch(CKB, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "generate_block", params: [] }),
    });
  }
}

describe.skipIf(!RUN)("devnet e2e: open -> pay -> close (live fnn rc5)", () => {
  const hub = new RawFiberClient("hub", HUB);
  const customer1 = new RawFiberClient("customer1", CUST1);
  let c1Pubkey: string;
  let c1Addr: string;

  beforeAll(async () => {
    const hubInfo = await hub.nodeInfo();
    const c1Info = await customer1.nodeInfo();
    expect(hubInfo.pubkey).toBeTruthy();
    c1Pubkey = c1Info.pubkey as string;
    c1Addr = (c1Info.addresses ?? [])[0]!;
    expect(c1Addr).toContain("/p2p/");
  });

  it("completes the money loop on-chain", async () => {
    // Hub (the LSP) funds a channel toward the merchant so it has outbound liquidity to pay.
    await hub.connectPeer({ address: c1Addr });
    await sleep(2000);

    await hub.openChannel({
      pubkey: c1Pubkey,
      funding_amount: `0x${(500n * 100_000_000n).toString(16)}`,
      public: true,
    });

    const nameOf = (c: { state?: { state_name?: string } | string }) =>
      typeof c.state === "string" ? c.state : c.state?.state_name;

    let channelId: string | undefined;
    let state = "";
    for (let i = 0; i < 40; i++) {
      await mine(3); // confirm the funding tx
      const { channels } = await hub.listChannels();
      // Ignore any channel left Closed by a prior run; track the one being opened here.
      const ch = (channels as { channel_id?: string; state?: { state_name?: string } | string }[]).find(
        (c) => normalizeChannelState(nameOf(c)) !== ChannelState.Closed,
      );
      state = nameOf(ch ?? {}) ?? "";
      channelId = ch?.channel_id;
      if (normalizeChannelState(state) === ChannelState.ChannelReady) break;
      await sleep(1500);
    }
    expect(normalizeChannelState(state), "channel reached ChannelReady").toBe(ChannelState.ChannelReady);

    const inv = await customer1.newInvoice({
      amount: `0x${(100n * 100_000_000n).toString(16)}`,
      currency: "Fibd",
      description: "e2e",
    });
    expect(inv.invoice_address).toBeTruthy();

    const pay = (await hub.sendPayment({ invoice: inv.invoice_address })) as {
      payment_hash: `0x${string}`;
      status: string;
    };
    let status = pay.status;
    for (let i = 0; i < 30 && status !== "Success" && status !== "Failed"; i++) {
      await sleep(1000);
      status = (await hub.getPayment({ payment_hash: pay.payment_hash })).status as string;
    }
    expect(status).toBe("Success");

    await hub.shutdownChannel({ channel_id: channelId as `0x${string}` });
    await mine(5);
  });
});
