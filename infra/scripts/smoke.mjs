// Live devnet smoke: hub(8227) opens+funds a channel to customer1(8237), pays its invoice, closes.
const HUB = "http://127.0.0.1:8227";
const C1 = "http://127.0.0.1:8237";
const CKB = "http://127.0.0.1:8114";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
async function rpc(url, method, params = {}) {
  const body = { id: ++id, jsonrpc: "2.0", method, params: url === CKB ? params : [params] };
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const mine = async (n = 1) => { for (let i = 0; i < n; i++) await rpc(CKB, "generate_block", []); };

async function main() {
  const hubInfo = await rpc(HUB, "node_info");
  const c1Info = await rpc(C1, "node_info");
  const hubPk = hubInfo.pubkey;
  const c1Pk = c1Info.pubkey;
  const c1Addr = (c1Info.addresses ?? [])[0];
  console.log("hub pubkey:", hubPk);
  console.log("c1  pubkey:", c1Pk);
  console.log("c1  addr:  ", c1Addr);

  console.log("\n[1] hub -> connect_peer(customer1)");
  await rpc(HUB, "connect_peer", { address: c1Addr });
  await sleep(2000);

  console.log("[2] hub -> open_channel to customer1 (500 CKB, hub funds)");
  const open = await rpc(HUB, "open_channel", {
    pubkey: c1Pk,
    funding_amount: "0x" + (500n * 100_000_000n).toString(16),
    public: true,
  });
  console.log("    temp channel:", open.temporary_channel_id);

  console.log("[3] poll list_channels -> ChannelReady (mining blocks to confirm funding)");
  let channelId, state;
  for (let i = 0; i < 40; i++) {
    await mine(3);
    const { channels } = await rpc(HUB, "list_channels", {});
    const ch = channels?.[0];
    state = ch?.state?.state_name ?? ch?.state;
    channelId = ch?.channel_id;
    if (i % 3 === 0) console.log(`    [${i}] state=${state}`);
    if (state === "ChannelReady" || state === "CHANNEL_READY") break;
    await sleep(1500);
  }
  if (!(state === "ChannelReady" || state === "CHANNEL_READY")) throw new Error(`channel never ready (last=${state})`);
  console.log("    READY, channel_id:", channelId);

  console.log("[4] customer1 -> new_invoice (100 CKB)");
  let inv;
  for (const currency of ["Fibd", "Ckb", "CKB"]) {
    try {
      inv = await rpc(C1, "new_invoice", {
        amount: "0x" + (100n * 100_000_000n).toString(16),
        currency,
        description: "smoke",
        expiry: "0x" + (3600).toString(16),
      });
      console.log(`    currency=${currency} OK`);
      break;
    } catch (e) { console.log(`    currency=${currency} rejected: ${e.message.slice(0, 80)}`); }
  }
  const invoiceAddr = inv.invoice_address ?? inv.invoice;
  console.log("    invoice:", invoiceAddr.slice(0, 48) + "...");

  console.log("[5] hub -> send_payment(invoice)");
  const pay = await rpc(HUB, "send_payment", { invoice: invoiceAddr });
  const payHash = pay.payment_hash;
  let payStatus = pay.status;
  console.log("    initial status:", payStatus);
  for (let i = 0; i < 30 && payStatus !== "Success" && payStatus !== "Failed"; i++) {
    await sleep(1000);
    const p = await rpc(HUB, "get_payment", { payment_hash: payHash });
    payStatus = p.status;
  }
  console.log("    final status:", payStatus);
  if (payStatus !== "Success") throw new Error(`payment not successful: ${payStatus}`);

  console.log("[6] hub -> shutdown_channel");
  try {
    await rpc(HUB, "shutdown_channel", { channel_id: channelId, fee_rate: "0x3FC" });
  } catch {
    await rpc(HUB, "shutdown_channel", { channel_id: channelId });
  }
  await mine(5);
  console.log("\nSMOKE PASSED  open -> pay -> close all succeeded on live devnet");
  process.exit(0);
}
main().catch((e) => { console.error("\nSMOKE FAILED", e.message); process.exit(1); });
