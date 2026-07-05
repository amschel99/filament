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

let requestId = 0;

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`RPC ${method} failed [${code}]: ${message}`);
    this.name = "RpcError";
  }
}

/**
 * Raw JSON-RPC implementation of FiberClient (CLAUDE.md rule 13). Every typed method is a
 * one-line wrapper over `invoke`, so swapping any single method to `@ckb-ccc/fiber`'s FiberSDK
 * — once we confirm its coverage against rc5 — is a one-line change and nothing else moves.
 *
 * fnn RPC convention: params is a single-element array wrapping the params object; `[]` for
 * no-arg methods (CLAUDE.md quick reference).
 */
export class RawFiberClient implements FiberClient {
  constructor(
    readonly name: string,
    readonly rpcUrl: string,
  ) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
    const body = {
      id: ++requestId,
      jsonrpc: "2.0",
      method,
      params: params === undefined ? [] : [params],
    };

    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // 503 here is usually the documented proxy footgun — see CLAUDE.md rule 7
      // (export NO_PROXY=127.0.0.1,localhost).
      throw new RpcError(method, res.status, `HTTP ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };
    if (json.error) {
      throw new RpcError(method, json.error.code, json.error.message, json.error.data);
    }
    return json.result as T;
  }

  nodeInfo(): Promise<NodeInfo> {
    return this.invoke<NodeInfo>("node_info");
  }
  connectPeer(params: { address: string }): Promise<void> {
    return this.invoke("connect_peer", params);
  }
  listPeers(): Promise<unknown[]> {
    return this.invoke("list_peers");
  }

  openChannel(params: OpenChannelParams): Promise<{ temporary_channel_id: Hex }> {
    return this.invoke("open_channel", params);
  }
  listChannels(params?: { peer_id?: string }): Promise<{ channels: RawChannel[] }> {
    return this.invoke("list_channels", params ?? {});
  }
  shutdownChannel(params: ShutdownChannelParams): Promise<void> {
    return this.invoke("shutdown_channel", params);
  }
  updateChannel(params: UpdateChannelParams): Promise<void> {
    return this.invoke("update_channel", params);
  }
  acceptChannel(params: { temporary_channel_id: Hex; funding_amount: Hex }): Promise<unknown> {
    return this.invoke("accept_channel", params);
  }

  async newInvoice(params: NewInvoiceParams): Promise<{ invoice_address: string; payment_hash: Hex }> {
    // rc5 shape: new_invoice returns { invoice_address, invoice: { data: { payment_hash } } }.
    // Normalize to a flat { invoice_address, payment_hash } at the boundary (CLAUDE.md rule 10).
    const res = await this.invoke<{
      invoice_address: string;
      payment_hash?: Hex;
      invoice?: { data?: { payment_hash?: Hex } };
    }>("new_invoice", params);
    const payment_hash = res.payment_hash ?? res.invoice?.data?.payment_hash;
    if (!payment_hash) throw new RpcError("new_invoice", 0, "response had no payment_hash", res);
    return { invoice_address: res.invoice_address, payment_hash };
  }
  getInvoice(params: { payment_hash: Hex }): Promise<RawInvoice> {
    return this.invoke("get_invoice", params);
  }
  parseInvoice(params: { invoice: string }): Promise<RawInvoice> {
    return this.invoke("parse_invoice", params);
  }
  cancelInvoice(params: { payment_hash: Hex }): Promise<unknown> {
    return this.invoke("cancel_invoice", params);
  }
  settleInvoice(params: { payment_hash: Hex; payment_preimage: Hex }): Promise<unknown> {
    return this.invoke("settle_invoice", params);
  }

  sendPayment(params: SendPaymentParams): Promise<RawPayment> {
    return this.invoke("send_payment", params);
  }
  getPayment(params: { payment_hash: Hex }): Promise<RawPayment> {
    return this.invoke("get_payment", params);
  }
  listPayments(): Promise<{ payments: RawPayment[] }> {
    return this.invoke("list_payments");
  }

  graphNodes(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.invoke("graph_nodes", params);
  }
  graphChannels(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.invoke("graph_channels", params);
  }
  buildRouter(params: Record<string, unknown>): Promise<unknown> {
    return this.invoke("build_router", params);
  }
  sendPaymentWithRouter(params: Record<string, unknown>): Promise<RawPayment> {
    return this.invoke("send_payment_with_router", params);
  }
}

export interface NodeConfig {
  name: string;
  rpcUrl: string;
}

/** Construct the three devnet clients from env. One instance per node. */
export function makeClients(): { hub: FiberClient; customer1: FiberClient; customer2: FiberClient } {
  const mk = (name: string, envVar: string, fallback: string) =>
    new RawFiberClient(name, process.env[envVar] ?? fallback);
  return {
    hub: mk("hub", "HUB_RPC_URL", "http://127.0.0.1:8227"),
    customer1: mk("customer1", "CUSTOMER1_RPC_URL", "http://127.0.0.1:8237"),
    customer2: mk("customer2", "CUSTOMER2_RPC_URL", "http://127.0.0.1:8247"),
  };
}
