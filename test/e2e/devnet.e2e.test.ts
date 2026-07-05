import { describe, it, expect, beforeAll } from "vitest";
import { RawFiberClient, normalizeChannelState, ChannelState, ckbToShannonHex } from "../../src/rpc/index.js";

/**
 * E2E — the real thing. This is smoke.sh as a test: open -> pay -> close against LIVE devnet fnn
 * nodes. It is the SAME flow the integration suite proves against the fake, so when virtualization
 * is enabled and the devnet is up (infra/scripts/*), this is what certifies M1/M2 for real and
 * becomes the version-drift tripwire (CLAUDE.md rule 1).
 *
 * Opt-in: RUN_E2E=1 and running nodes. `npm run test:e2e`. Skipped otherwise so CI stays green.
 */
const RUN = process.env.RUN_E2E === "1";
const HUB = process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227";
const CUST1 = process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237";
const HUB_P2P = process.env.HUB_P2P_PORT ?? "8228";

async function pollChannelReady(client: RawFiberClient, tries = 30): Promise<string | undefined> {
  for (let i = 0; i < tries; i++) {
    const { channels } = await client.listChannels();
    const ch = channels[0] as { channel_id?: string; state?: { state_name?: string } | string } | undefined;
    if (ch) {
      const raw = typeof ch.state === "string" ? ch.state : ch.state?.state_name;
      if (normalizeChannelState(raw) === ChannelState.ChannelReady) return ch.channel_id;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}

describe.skipIf(!RUN)("devnet e2e: open -> pay -> close", () => {
  const hub = new RawFiberClient("hub", HUB);
  const customer1 = new RawFiberClient("customer1", CUST1);
  let hubPubkey: string;

  beforeAll(async () => {
    const info = await hub.nodeInfo();
    hubPubkey = (info.node_id ?? (info as Record<string, unknown>).pubkey) as string;
    expect(hubPubkey).toBeTruthy();
  });

  it("completes the smoke loop", async () => {
    await customer1.connectPeer({ address: `/ip4/127.0.0.1/tcp/${HUB_P2P}/p2p/${hubPubkey}` });

    await customer1.openChannel({
      peer_id: hubPubkey as `0x${string}`,
      funding_amount: ckbToShannonHex(500n),
      public: true,
    });

    const channelId = await pollChannelReady(customer1);
    expect(channelId, "channel reached ChannelReady").toBeTruthy();

    const inv = await customer1.newInvoice({ amount: ckbToShannonHex(100n), currency: "Fibd", description: "e2e" });
    expect(inv.invoice_address).toBeTruthy();

    const pay = await hub.sendPayment({ invoice: inv.invoice_address });
    // send_payment may return Inflight first; poll get_payment to terminal.
    let status = pay.status;
    for (let i = 0; i < 15 && status !== "Success" && status !== "Failed"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      status = (await hub.getPayment({ payment_hash: (pay as { payment_hash: `0x${string}` }).payment_hash })).status;
    }
    expect(status).toBe("Success");

    await customer1.shutdownChannel({ channel_id: channelId as `0x${string}` });
  });
});
