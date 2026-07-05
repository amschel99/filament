import { createHash, randomBytes } from "node:crypto";
import type {
  FiberClient,
  NodeInfo,
  OpenChannelParams,
  ShutdownChannelParams,
  UpdateChannelParams,
  NewInvoiceParams,
  SendPaymentParams,
  RawChannel,
  RawInvoice,
  RawPayment,
} from "./types.js";
import type { Hex } from "./units.js";
import { shannonHexToShannon, shannonToHex, forwardingFee } from "./units.js";

/**
 * Faithful-enough in-memory fnn for integration tests and local dev — NO real node required.
 *
 * It models the pieces our application logic actually depends on: peers, channels (with the
 * NegotiatingFunding -> ChannelReady transition and the 99 CKB reserve), invoices (incl. hold
 * invoices and the Received/Paid distinction), and payments (single-hop and one-hop-routed with
 * a forwarding fee). It deliberately does NOT implement real cryptography, on-chain settlement,
 * or the full Daric protocol — those live in the real fnn and are exercised by the gated e2e suite.
 *
 * Determinism: channels do not auto-ready. Tests advance state explicitly via network.mine(),
 * mirroring "poll, don't assume" (CLAUDE.md rule 4) — nothing becomes READY until observed.
 */

interface FakeChannel {
  channelId: Hex;
  tempChannelId: Hex;
  a: string; // opener node id
  b: string; // peer node id
  aBalance: bigint; // usable shannons on opener side
  bBalance: bigint; // usable shannons on peer side
  state: "NegotiatingFunding" | "ChannelReady" | "ShuttingDown" | "Closed";
  public: boolean;
  feePpm: bigint;
}

interface FakeInvoice {
  paymentHash: Hex;
  invoiceAddress: string;
  preimage?: Hex;
  isHold: boolean;
  amount: bigint;
  ownerNodeId: string; // node that issued (receives) the invoice
  status: "Open" | "Received" | "Paid" | "Cancelled" | "Expired";
}

interface FakePayment {
  paymentHash: Hex;
  status: "Created" | "Inflight" | "Success" | "Failed";
  amount: bigint;
  fee: bigint;
  error?: string;
}

const RESERVE = 99n * 100_000_000n;

export class FakeFiberNetwork {
  private nodes = new Map<string, { name: string }>();
  private channels: FakeChannel[] = [];
  private invoices = new Map<string, FakeInvoice>(); // by payment_hash
  private invoiceByAddr = new Map<string, string>(); // address -> payment_hash
  private payments = new Map<string, FakePayment>();

  /** Register a node and get a stable fake pubkey for it. */
  addNode(name: string): string {
    const id = `0x${createHash("sha256").update(name).digest("hex").slice(0, 64)}` as Hex;
    this.nodes.set(id, { name });
    return id;
  }

  client(name: string): FakeFiberClient {
    const id = this.addNode(name);
    return new FakeFiberClient(this, name, id);
  }

  /** Advance every pending channel to ChannelReady (the "confirmations landed" tick). */
  mine(): void {
    for (const ch of this.channels) {
      if (ch.state === "NegotiatingFunding") ch.state = "ChannelReady";
    }
  }

  // ── operations invoked by FakeFiberClient ──────────────────────────────

  _connect(_from: string, _address: string): void {
    /* no-op: connectivity is assumed in-memory */
  }

  _openChannel(from: string, params: OpenChannelParams): { temporary_channel_id: Hex } {
    const funding = shannonHexToShannon(params.funding_amount);
    if (funding <= RESERVE) throw new Error("funding below channel reserve");
    const tempId = `0x${randomBytes(32).toString("hex")}` as Hex;
    this.channels.push({
      channelId: `0x${randomBytes(32).toString("hex")}` as Hex,
      tempChannelId: tempId,
      a: from,
      b: params.peer_id,
      aBalance: funding - RESERVE, // opener holds the usable liquidity initially
      bBalance: 0n,
      state: "NegotiatingFunding",
      public: params.public ?? false,
      feePpm: 1000n,
    });
    return { temporary_channel_id: tempId };
  }

  _listChannels(nodeId: string): { channels: RawChannel[] } {
    const mine = this.channels.filter((c) => c.a === nodeId || c.b === nodeId);
    return {
      channels: mine.map((c) => {
        const isA = c.a === nodeId;
        return {
          channel_id: c.channelId,
          temporary_channel_id: c.tempChannelId,
          peer_id: isA ? c.b : c.a,
          state: { state_name: c.state },
          local_balance: shannonToHex(isA ? c.aBalance : c.bBalance),
          remote_balance: shannonToHex(isA ? c.bBalance : c.aBalance),
          public: c.public,
        } as RawChannel;
      }),
    };
  }

  _updateChannel(nodeId: string, params: UpdateChannelParams): void {
    const ch = this.channels.find(
      (c) => c.channelId === params.channel_id && (c.a === nodeId || c.b === nodeId),
    );
    if (ch && params.tlc_fee_proportional_millionths) {
      ch.feePpm = shannonHexToShannon(params.tlc_fee_proportional_millionths);
    }
  }

  _shutdown(nodeId: string, params: ShutdownChannelParams): void {
    const ch = this.channels.find(
      (c) => c.channelId === params.channel_id && (c.a === nodeId || c.b === nodeId),
    );
    if (ch) ch.state = "Closed";
  }

  _newInvoice(ownerNodeId: string, params: NewInvoiceParams): { invoice_address: string; payment_hash: Hex } {
    const preimage = params.payment_preimage;
    const paymentHash =
      params.payment_hash ??
      (`0x${createHash("sha256")
        .update(preimage ?? randomBytes(32).toString("hex"))
        .digest("hex")}` as Hex);
    const address = `fibd${createHash("sha256").update(paymentHash).digest("hex").slice(0, 40)}`;
    const inv: FakeInvoice = {
      paymentHash,
      invoiceAddress: address,
      preimage,
      isHold: !!params.payment_hash && !preimage,
      amount: shannonHexToShannon(params.amount),
      ownerNodeId,
      status: "Open",
    };
    this.invoices.set(paymentHash, inv);
    this.invoiceByAddr.set(address, paymentHash);
    return { invoice_address: address, payment_hash: paymentHash };
  }

  _getInvoice(paymentHash: string): RawInvoice {
    const inv = this.invoices.get(paymentHash);
    if (!inv) throw new Error("invoice not found");
    return { payment_hash: inv.paymentHash, status: inv.status, amount: shannonToHex(inv.amount) };
  }

  _cancelInvoice(paymentHash: string): void {
    const inv = this.invoices.get(paymentHash);
    if (inv && (inv.status === "Open" || inv.status === "Received")) inv.status = "Cancelled";
  }

  _settleInvoice(paymentHash: string, preimage: Hex): void {
    const inv = this.invoices.get(paymentHash);
    if (!inv) throw new Error("invoice not found");
    if (inv.status !== "Received") throw new Error("only Received invoices can be settled");
    inv.preimage = preimage;
    inv.status = "Paid";
  }

  _sendPayment(from: string, params: SendPaymentParams): RawPayment {
    // Resolve target invoice (invoice string) or keysend (target_pubkey + amount).
    let inv: FakeInvoice | undefined;
    let amount: bigint;
    if (params.invoice) {
      const hash = this.invoiceByAddr.get(params.invoice);
      inv = hash ? this.invoices.get(hash) : undefined;
      if (!inv) return this.failedPayment(`0x${randomBytes(32).toString("hex")}` as Hex, "invoice not found");
      amount = inv.amount;
    } else if (params.target_pubkey && params.amount) {
      amount = shannonHexToShannon(params.amount);
    } else {
      throw new Error("send_payment needs an invoice or (target_pubkey, amount)");
    }

    const targetNode = inv ? inv.ownerNodeId : (params.target_pubkey as string);
    const route = this.findRoute(from, targetNode, amount);
    if (!route) {
      const hash = inv?.paymentHash ?? (`0x${randomBytes(32).toString("hex")}` as Hex);
      return this.failedPayment(hash, "no route / insufficient liquidity");
    }

    // Move balances along the route; hub (middle) keeps a forwarding fee on multi-hop.
    let fee = 0n;
    for (const hop of route) {
      hop.chan.state; // read for clarity
      if (hop.fromSide === "a") {
        hop.chan.aBalance -= hop.amount;
        hop.chan.bBalance += hop.amount;
      } else {
        hop.chan.bBalance -= hop.amount;
        hop.chan.aBalance += hop.amount;
      }
    }
    if (route.length > 1) fee = forwardingFee(amount, route[0]!.chan.feePpm);

    const paymentHash = inv?.paymentHash ?? (`0x${randomBytes(32).toString("hex")}` as Hex);
    if (inv) inv.status = inv.isHold ? "Received" : "Paid";
    const pay: FakePayment = { paymentHash, status: "Success", amount, fee };
    this.payments.set(paymentHash, pay);
    return this.toRawPayment(pay);
  }

  _getPayment(paymentHash: string): RawPayment {
    const pay = this.payments.get(paymentHash);
    if (!pay) throw new Error("payment not found");
    return this.toRawPayment(pay);
  }

  _listPayments(): { payments: RawPayment[] } {
    return { payments: [...this.payments.values()].map((p) => this.toRawPayment(p)) };
  }

  // ── routing helpers ────────────────────────────────────────────────────

  private findRoute(
    from: string,
    to: string,
    amount: bigint,
  ): { chan: FakeChannel; fromSide: "a" | "b"; amount: bigint }[] | null {
    // Direct channel?
    const direct = this.readyChannelBetween(from, to);
    if (direct) {
      const side = direct.a === from ? "a" : "b";
      const bal = side === "a" ? direct.aBalance : direct.bBalance;
      if (bal >= amount) return [{ chan: direct, fromSide: side, amount }];
    }
    // One-hop route through a shared neighbor (the hub triangle).
    for (const mid of this.neighbors(from)) {
      const first = this.readyChannelBetween(from, mid);
      const second = this.readyChannelBetween(mid, to);
      if (!first || !second) continue;
      const fSide = first.a === from ? "a" : "b";
      const sSide = second.a === mid ? "a" : "b";
      const fBal = fSide === "a" ? first.aBalance : first.bBalance;
      const sBal = sSide === "a" ? second.aBalance : second.bBalance;
      if (fBal >= amount && sBal >= amount) {
        return [
          { chan: first, fromSide: fSide, amount },
          { chan: second, fromSide: sSide, amount },
        ];
      }
    }
    return null;
  }

  private neighbors(nodeId: string): string[] {
    const out = new Set<string>();
    for (const c of this.channels) {
      if (c.state !== "ChannelReady") continue;
      if (c.a === nodeId) out.add(c.b);
      if (c.b === nodeId) out.add(c.a);
    }
    return [...out];
  }

  private readyChannelBetween(x: string, y: string): FakeChannel | undefined {
    return this.channels.find(
      (c) => c.state === "ChannelReady" && ((c.a === x && c.b === y) || (c.a === y && c.b === x)),
    );
  }

  private failedPayment(hash: Hex, error: string): RawPayment {
    const pay: FakePayment = { paymentHash: hash, status: "Failed", amount: 0n, fee: 0n, error };
    this.payments.set(hash, pay);
    return this.toRawPayment(pay);
  }

  private toRawPayment(p: FakePayment): RawPayment {
    return {
      payment_hash: p.paymentHash,
      status: p.status,
      fee: shannonToHex(p.fee),
      ...(p.error ? { failed_error: p.error } : {}),
    } as RawPayment;
  }
}

/** A FiberClient bound to one node in a FakeFiberNetwork. Drop-in for RawFiberClient in tests. */
export class FakeFiberClient implements FiberClient {
  constructor(
    private readonly net: FakeFiberNetwork,
    readonly name: string,
    readonly nodeId: string,
  ) {}
  readonly rpcUrl = "fake://memory";

  async invoke<T = unknown>(method: string): Promise<T> {
    throw new Error(`FakeFiberClient: raw invoke(${method}) not supported — use typed methods`);
  }

  async nodeInfo(): Promise<NodeInfo> {
    return { node_id: this.nodeId as Hex, node_name: this.name, addresses: ["/ip4/127.0.0.1/tcp/0"] };
  }
  async connectPeer(params: { address: string }): Promise<void> {
    this.net._connect(this.nodeId, params.address);
  }
  async listPeers(): Promise<unknown[]> {
    return [];
  }

  async openChannel(params: OpenChannelParams): Promise<{ temporary_channel_id: Hex }> {
    return this.net._openChannel(this.nodeId, params);
  }
  async listChannels(): Promise<{ channels: RawChannel[] }> {
    return this.net._listChannels(this.nodeId);
  }
  async shutdownChannel(params: ShutdownChannelParams): Promise<void> {
    this.net._shutdown(this.nodeId, params);
  }
  async updateChannel(params: UpdateChannelParams): Promise<void> {
    this.net._updateChannel(this.nodeId, params);
  }
  async acceptChannel(): Promise<unknown> {
    return {};
  }

  async newInvoice(params: NewInvoiceParams) {
    return this.net._newInvoice(this.nodeId, params);
  }
  async getInvoice(params: { payment_hash: Hex }): Promise<RawInvoice> {
    return this.net._getInvoice(params.payment_hash);
  }
  async parseInvoice(params: { invoice: string }): Promise<RawInvoice> {
    return { invoice_address: params.invoice } as RawInvoice;
  }
  async cancelInvoice(params: { payment_hash: Hex }): Promise<unknown> {
    this.net._cancelInvoice(params.payment_hash);
    return {};
  }
  async settleInvoice(params: { payment_hash: Hex; payment_preimage: Hex }): Promise<unknown> {
    this.net._settleInvoice(params.payment_hash, params.payment_preimage);
    return {};
  }

  async sendPayment(params: SendPaymentParams): Promise<RawPayment> {
    return this.net._sendPayment(this.nodeId, params);
  }
  async getPayment(params: { payment_hash: Hex }): Promise<RawPayment> {
    return this.net._getPayment(params.payment_hash);
  }
  async listPayments(): Promise<{ payments: RawPayment[] }> {
    return this.net._listPayments();
  }

  async graphNodes(): Promise<unknown> {
    return { nodes: [] };
  }
  async graphChannels(): Promise<unknown> {
    return { channels: [] };
  }
  async buildRouter(): Promise<unknown> {
    return { router_hops: [] };
  }
  async sendPaymentWithRouter(params: Record<string, unknown>): Promise<RawPayment> {
    return this.net._sendPayment(this.nodeId, params as SendPaymentParams);
  }
}
