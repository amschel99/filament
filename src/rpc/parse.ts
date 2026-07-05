import { createHash, randomBytes } from "node:crypto";
import type { Hex } from "./units.js";

/**
 * Normalization at the RPC boundary. CLAUDE.md rule 10: fnn has shipped both PascalCase
 * (`ChannelReady`) and SCREAMING_SNAKE (`CHANNEL_READY`) across versions — normalize to
 * one internal enum immediately, so no downstream code has to know which rc it's talking to.
 */

export enum ChannelState {
  NegotiatingFunding = "NegotiatingFunding",
  CollaboratingFundingTx = "CollaboratingFundingTx",
  SigningCommitment = "SigningCommitment",
  AwaitingTxSignatures = "AwaitingTxSignatures",
  AwaitingChannelReady = "AwaitingChannelReady",
  ChannelReady = "ChannelReady",
  ShuttingDown = "ShuttingDown",
  Closed = "Closed",
  Unknown = "Unknown",
}

const CHANNEL_STATE_ALIASES: Record<string, ChannelState> = Object.fromEntries(
  Object.values(ChannelState).flatMap((s) => {
    const snake = s.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase(); // ChannelReady -> CHANNEL_READY
    return [
      [s.toLowerCase(), s],
      [snake.toLowerCase(), s],
    ];
  }),
) as Record<string, ChannelState>;

/** Accepts `ChannelReady`, `CHANNEL_READY`, `channel_ready`, etc. → one enum value. */
export function normalizeChannelState(raw: string | undefined | null): ChannelState {
  if (!raw) return ChannelState.Unknown;
  return CHANNEL_STATE_ALIASES[raw.toLowerCase()] ?? ChannelState.Unknown;
}

export enum PaymentStatus {
  Created = "Created",
  Inflight = "Inflight",
  Success = "Success",
  Failed = "Failed",
  Unknown = "Unknown",
}

export function normalizePaymentStatus(raw: string | undefined | null): PaymentStatus {
  if (!raw) return PaymentStatus.Unknown;
  const key = raw.toLowerCase().replace(/_/g, "");
  const map: Record<string, PaymentStatus> = {
    created: PaymentStatus.Created,
    inflight: PaymentStatus.Inflight,
    success: PaymentStatus.Success,
    failed: PaymentStatus.Failed,
  };
  return map[key] ?? PaymentStatus.Unknown;
}

export enum InvoiceStatus {
  Open = "Open",
  Received = "Received",
  Paid = "Paid",
  Cancelled = "Cancelled",
  Expired = "Expired",
  Unknown = "Unknown",
}

export function normalizeInvoiceStatus(raw: string | undefined | null): InvoiceStatus {
  if (!raw) return InvoiceStatus.Unknown;
  const key = raw.toLowerCase();
  const map: Record<string, InvoiceStatus> = {
    open: InvoiceStatus.Open,
    received: InvoiceStatus.Received,
    paid: InvoiceStatus.Paid,
    cancelled: InvoiceStatus.Cancelled,
    canceled: InvoiceStatus.Cancelled,
    expired: InvoiceStatus.Expired,
  };
  return map[key] ?? InvoiceStatus.Unknown;
}

/**
 * Fresh 32-byte payment preimage (CLAUDE.md rule 12): crypto.randomBytes, 0x-prefixed hex,
 * never reused, never logged. The payment hash is ckb_hash(preimage) (blake2b-256) by
 * default; sha256 only for cross-chain, which is out of scope for devnet v0.
 */
export function generatePreimage(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * Derive a payment hash from a preimage, for HOLD invoices (where we must supply the hash up
 * front and keep the preimage locally until settle_invoice).
 *
 * TODO(real fnn): the node's default is ckb_hash = blake2b-256. This uses sha256 as a stand-in
 * that is self-consistent with the fake node; before hold invoices run against a real devnet
 * node, switch this to blake2b-256 (or pass hash_algorithm to match) so the hashes agree.
 */
export function paymentHashFromPreimage(preimage: Hex): Hex {
  const bytes = Buffer.from(preimage.slice(2), "hex");
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}
