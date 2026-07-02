/**
 * Amount conversion helpers — the ONE place shannon/CKB/hex conversions live.
 *
 * CLAUDE.md rule 3: amounts are hex strings over RPC, always. fnn-cli uses decimal
 * shannons; the JSON-RPC wire format uses 0x-prefixed hex. 1 CKB = 100,000,000 shannons.
 *
 * Everything internal to the LSP carries bigint shannons; we only stringify at the RPC
 * and DB boundaries. Never do amount math with JS `number` — 1,000,000 CKB in shannons
 * (1e14) exceeds Number.MAX_SAFE_INTEGER precision headroom for repeated arithmetic.
 */

export const SHANNONS_PER_CKB = 100_000_000n;

export type Hex = `0x${string}`;

export function isHex(v: string): v is Hex {
  return /^0x[0-9a-fA-F]*$/.test(v);
}

/** CKB (whole units, bigint) → hex shannons for the RPC wire. */
export function ckbToShannonHex(ckb: bigint): Hex {
  if (ckb < 0n) throw new RangeError(`ckbToShannonHex: negative amount ${ckb}`);
  return `0x${(ckb * SHANNONS_PER_CKB).toString(16)}`;
}

/** Shannons (bigint) → hex for the RPC wire. */
export function shannonToHex(shannons: bigint): Hex {
  if (shannons < 0n) throw new RangeError(`shannonToHex: negative amount ${shannons}`);
  return `0x${shannons.toString(16)}`;
}

/** Hex shannons (RPC wire) → whole CKB, floored. Use shannonHexToShannon for exact math. */
export function shannonHexToCkb(hex: string): bigint {
  return shannonHexToShannon(hex) / SHANNONS_PER_CKB;
}

/** Hex shannons (RPC wire) → shannons (bigint), exact. */
export function shannonHexToShannon(hex: string): bigint {
  if (!isHex(hex)) throw new TypeError(`shannonHexToShannon: not a hex string: ${hex}`);
  return BigInt(hex);
}

/** Whole CKB → shannons (bigint). */
export function ckbToShannon(ckb: bigint): bigint {
  return ckb * SHANNONS_PER_CKB;
}

/**
 * Per-side channel reserve (CLAUDE.md rule 9): 98 CKB commitment-lock occupied capacity
 * + 1 CKB shutdown fee = 99 CKB. Usable balance = funded − reserve.
 */
export const CHANNEL_RESERVE_CKB = 99n;
export const CHANNEL_RESERVE_SHANNONS = CHANNEL_RESERVE_CKB * SHANNONS_PER_CKB;

/** Funding required to give a peer `inboundCkb` of usable inbound liquidity. */
export function fundingForInbound(inboundCkb: bigint): bigint {
  return inboundCkb + CHANNEL_RESERVE_CKB;
}

/**
 * Forwarding fee on an outbound channel: ceil(amount × ppm / 1_000_000).
 * Default ppm = 1000 (0.1%). Fee is computed on the OUTBOUND channel's config.
 */
export function forwardingFee(amountShannons: bigint, ppm: bigint = 1000n): bigint {
  return (amountShannons * ppm + 999_999n) / 1_000_000n;
}
