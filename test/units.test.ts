import { describe, it, expect } from "vitest";
import {
  ckbToShannonHex,
  shannonHexToCkb,
  shannonHexToShannon,
  shannonToHex,
  fundingForInbound,
  forwardingFee,
  CHANNEL_RESERVE_CKB,
} from "../src/rpc/units.js";
import {
  normalizeChannelState,
  ChannelState,
  normalizeInvoiceStatus,
  InvoiceStatus,
  generatePreimage,
} from "../src/rpc/parse.js";

describe("units", () => {
  it("converts CKB <-> hex shannons round trip", () => {
    expect(ckbToShannonHex(1n)).toBe("0x5f5e100"); // 100_000_000
    expect(shannonHexToShannon("0x5f5e100")).toBe(100_000_000n);
    expect(shannonHexToCkb("0x5f5e100")).toBe(1n);
  });

  it("500 CKB encodes as the value smoke.sh uses", () => {
    expect(ckbToShannonHex(500n)).toBe("0xba43b7400");
  });

  it("rejects negative amounts", () => {
    expect(() => shannonToHex(-1n)).toThrow();
  });

  it("funding adds the 99 CKB reserve", () => {
    expect(fundingForInbound(500n)).toBe(500n + CHANNEL_RESERVE_CKB);
  });

  it("forwarding fee is ceil(amount * ppm / 1e6)", () => {
    expect(forwardingFee(1_000_000n, 1000n)).toBe(1000n); // exact
    expect(forwardingFee(1n, 1000n)).toBe(1n); // ceil, not floor(0)
  });
});

describe("state normalization (CLAUDE.md rule 10)", () => {
  it("accepts both casings for channel state", () => {
    expect(normalizeChannelState("ChannelReady")).toBe(ChannelState.ChannelReady);
    expect(normalizeChannelState("CHANNEL_READY")).toBe(ChannelState.ChannelReady);
    expect(normalizeChannelState("bogus")).toBe(ChannelState.Unknown);
  });

  it("normalizes invoice status incl. spelling variant", () => {
    expect(normalizeInvoiceStatus("Paid")).toBe(InvoiceStatus.Paid);
    expect(normalizeInvoiceStatus("canceled")).toBe(InvoiceStatus.Cancelled);
  });
});

describe("preimage", () => {
  it("is 32 bytes of 0x hex and unique", () => {
    const a = generatePreimage();
    const b = generatePreimage();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
