import type { FiberClient, Hex, UdtScript } from "../rpc/index.js";
import { generatePreimage, paymentHashFromPreimage, shannonToHex } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 4 — invoice creation/settlement on the RECEIVING node. On devnet v0 the "merchant" is
 * customer1's node; the service holds RPC handles to all three nodes. Multi-tenant routing of
 * which node receives is a later hosted-fleet concern.
 */
export interface CreateInvoiceInput {
  amountShannons: bigint;
  description?: string;
  expirySeconds?: number;
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
  webhookSecret?: string;
  /** Hold invoice: node gets payment_hash only; settlement deferred to settle_invoice. */
  hold?: boolean;
  /**
   * Denominate the invoice in a UDT stablecoin (e.g. fUSD on devnet, RUSD on mainnet) instead of
   * CKB. `amountShannons` is then the raw UDT amount (integer units), not shannons.
   */
  udtTypeScript?: UdtScript;
}

export interface CreateInvoiceResult {
  paymentHash: Hex;
  invoiceAddress: string;
  expiresAt: number | null;
}

export interface InvoiceRow {
  payment_hash: string;
  invoice_address: string;
  preimage: string | null;
  is_hold: number;
  amount_shannons: string;
  status: string;
  description: string | null;
  metadata: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  expires_at: number | null;
}

export class InvoiceService {
  constructor(
    private readonly receiver: FiberClient,
    private readonly db: Db,
  ) {}

  async create(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const amount = shannonToHex(input.amountShannons);
    const expiresAt = input.expirySeconds ? now() + input.expirySeconds * 1000 : null;

    // Hold invoices: generate the preimage locally, supply the HASH to the node (mutually
    // exclusive with payment_preimage), and keep the preimage until settle. Normal invoices:
    // supply the preimage and let the node derive the hash.
    const preimage = generatePreimage();
    const holdHash = input.hold ? paymentHashFromPreimage(preimage) : undefined;

    const res = await this.receiver.newInvoice({
      amount,
      description: input.description ?? "",
      currency: "Fibd", // verify against rc5 (CLAUDE.md quick ref)
      ...(input.hold ? { payment_hash: holdHash } : { payment_preimage: preimage }),
      ...(input.expirySeconds ? { expiry: shannonToHex(BigInt(input.expirySeconds)) } : {}),
      ...(input.udtTypeScript ? { udt_type_script: input.udtTypeScript } : {}),
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
        preimage, // stored for both; for hold it is the settlement secret, never logged
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

  /** Settle a hold invoice that has reached Received, revealing the stored preimage. */
  async settle(paymentHash: Hex, preimage?: Hex): Promise<void> {
    const row = this.get(paymentHash);
    if (!row) throw new Error(`unknown invoice ${paymentHash}`);
    const secret = preimage ?? (row.preimage as Hex | null);
    if (!secret) throw new Error(`no preimage available to settle ${paymentHash}`);
    await this.receiver.settleInvoice({ payment_hash: paymentHash, payment_preimage: secret });
    // Status flips to PAID via the observed watcher poll (CLAUDE.md rule 4) — not assumed here.
  }

  /** Cancel an open/received invoice. */
  async cancel(paymentHash: Hex): Promise<void> {
    await this.receiver.cancelInvoice({ payment_hash: paymentHash });
    // Terminal status recorded by the watcher from observed node state.
  }

  get(paymentHash: string): InvoiceRow | undefined {
    return this.db
      .prepare(`SELECT * FROM invoices WHERE payment_hash = ?`)
      .get(paymentHash) as InvoiceRow | undefined;
  }
}
