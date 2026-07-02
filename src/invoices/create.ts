import type { FiberClient, Hex } from "../rpc/index.js";
import { generatePreimage, shannonToHex } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 4 — invoice creation on the RECEIVING node. On devnet v0 the "merchant" is customer1's
 * node; the service holds RPC handles to all three nodes. Multi-tenant routing of which node
 * receives is a later hosted-fleet concern.
 */
export interface CreateInvoiceInput {
  amountShannons: bigint;
  description?: string;
  expirySeconds?: number;
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
  webhookSecret?: string;
  /** Hold invoice: node gets payment_hash only, settlement deferred to settle_invoice. */
  hold?: boolean;
}

export interface CreateInvoiceResult {
  paymentHash: Hex;
  invoiceAddress: string;
  expiresAt: number | null;
}

export class InvoiceService {
  constructor(
    private readonly receiver: FiberClient,
    private readonly db: Db,
  ) {}

  async create(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const preimage = input.hold ? undefined : generatePreimage();
    const amount = shannonToHex(input.amountShannons);
    const expiresAt = input.expirySeconds ? now() + input.expirySeconds * 1000 : null;

    // Hold invoices are created by supplying payment_hash only (mutually exclusive with
    // payment_preimage). For a normal invoice we supply the preimage and let the node derive
    // the hash. NOTE: for hold we need the hash up front — computing ckb_hash(preimage) lands
    // in Phase 4 proper; here we pass the preimage path for normal invoices.
    const res = await this.receiver.newInvoice({
      amount,
      description: input.description ?? "",
      currency: "Fibd", // verify against rc5 (CLAUDE.md quick ref)
      ...(preimage ? { payment_preimage: preimage } : {}),
      ...(input.expirySeconds ? { expiry: shannonToHex(BigInt(input.expirySeconds)) } : {}),
    });

    this.db
      .prepare(
        `INSERT INTO invoices
           (payment_hash, invoice_address, preimage, is_hold, amount_shannons, status,
            description, metadata, webhook_url, webhook_secret, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        res.payment_hash,
        res.invoice_address,
        preimage ?? null,
        input.hold ? 1 : 0,
        amount,
        input.description ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.webhookUrl ?? null,
        input.webhookSecret ?? null,
        expiresAt,
        now(),
        now(),
      );

    return { paymentHash: res.payment_hash, invoiceAddress: res.invoice_address, expiresAt };
  }
}
