import type { Hex } from "./units.js";

/**
 * The single interface the whole codebase uses to talk to an fnn node (CLAUDE.md rule: no
 * other module talks to a node directly). Request/response shapes are intentionally loose
 * (`unknown` / index signatures) at this stage — we pin them method-by-method in Phase 2 as
 * the M2 integration suite observes the real rc5 wire format. Do NOT invent field names here;
 * fill them in from live responses.
 */
export interface FiberClient {
  readonly name: string;
  readonly rpcUrl: string;

  /** Raw escape hatch — always available, per RPC method (CLAUDE.md rule 13). */
  invoke<T = unknown>(method: string, params?: unknown): Promise<T>;

  // node / peers
  nodeInfo(): Promise<NodeInfo>;
  connectPeer(params: { address: string }): Promise<void>;
  listPeers(): Promise<unknown[]>;

  // channels
  openChannel(params: OpenChannelParams): Promise<{ temporary_channel_id: Hex }>;
  listChannels(params?: { peer_id?: string }): Promise<{ channels: RawChannel[] }>;
  shutdownChannel(params: ShutdownChannelParams): Promise<void>;
  updateChannel(params: UpdateChannelParams): Promise<void>;
  acceptChannel(params: { temporary_channel_id: Hex; funding_amount: Hex }): Promise<unknown>;

  // invoices
  newInvoice(params: NewInvoiceParams): Promise<{ invoice_address: string; payment_hash: Hex }>;
  getInvoice(params: { payment_hash: Hex }): Promise<RawInvoice>;
  parseInvoice(params: { invoice: string }): Promise<RawInvoice>;
  cancelInvoice(params: { payment_hash: Hex }): Promise<unknown>;
  settleInvoice(params: { payment_hash: Hex; payment_preimage: Hex }): Promise<unknown>;

  // payments
  sendPayment(params: SendPaymentParams): Promise<RawPayment>;
  getPayment(params: { payment_hash: Hex }): Promise<RawPayment>;
  listPayments(): Promise<{ payments: RawPayment[] }>;

  // graph / routing
  graphNodes(params?: Record<string, unknown>): Promise<unknown>;
  graphChannels(params?: Record<string, unknown>): Promise<unknown>;
  buildRouter(params: Record<string, unknown>): Promise<unknown>;
  sendPaymentWithRouter(params: Record<string, unknown>): Promise<RawPayment>;
}

export interface NodeInfo {
  node_name?: string;
  node_id?: Hex; // pubkey (v0.8.0 renamed peer_id -> pubkey)
  addresses?: string[];
  [k: string]: unknown;
}

export interface OpenChannelParams {
  peer_id: string;
  funding_amount: Hex;
  public?: boolean;
  funding_udt_type_script?: unknown;
  [k: string]: unknown;
}

export interface ShutdownChannelParams {
  channel_id: Hex;
  close_script?: unknown;
  force?: boolean;
  [k: string]: unknown;
}

export interface UpdateChannelParams {
  channel_id: Hex;
  tlc_fee_proportional_millionths?: Hex;
  enabled?: boolean;
  [k: string]: unknown;
}

export interface NewInvoiceParams {
  amount: Hex;
  description?: string;
  currency?: string; // devnet expected "Fibd" — verify against rc5
  expiry?: Hex;
  payment_hash?: Hex; // hold invoice: supply hash, omit preimage
  payment_preimage?: Hex; // normal invoice: supply preimage, omit hash
  hash_algorithm?: "ckb_hash" | "sha256";
  [k: string]: unknown;
}

export interface SendPaymentParams {
  invoice?: string;
  target_pubkey?: Hex;
  amount?: Hex;
  keysend?: boolean;
  allow_self_payment?: boolean;
  max_fee_amount?: Hex;
  [k: string]: unknown;
}

/** Raw shapes as they come off the wire — normalize via src/rpc/parse.ts before use. */
export type RawChannel = { state?: { state_name?: string } | string; [k: string]: unknown };
export type RawInvoice = { status?: string; [k: string]: unknown };
export type RawPayment = { status?: string; fee?: Hex; [k: string]: unknown };
