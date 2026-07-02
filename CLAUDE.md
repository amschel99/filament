# CLAUDE.md — standing instructions for the fiber-lsp repo

Read `PLAN.md` for the full build plan. These are the non-negotiable rules while working in this repo.

1. **Pin fnn `v0.9.0-rc5`.** When any RPC response doesn't match expectations, check the pinned
   release's actual docs/source **before** "fixing" our code — shapes drift between rcs
   (v0.8.0 already broke `peer_id`→`pubkey` and enum casing).
2. **Never guess script `code_hash`es or cell-dep structures.** Always read them from
   `infra/devnet/scripts.json`, generated at deploy time.
3. **Amounts are hex strings over RPC, always.** Write and test the conversion helpers
   (`src/rpc/units.ts`) before anything that touches money.
4. **Poll, don't assume.** Channel opens and payments are asynchronous. Every state transition
   written to the DB must come from **observed node state** (`list_channels`, `get_invoice`,
   `get_payment`), never from "we issued the RPC so it happened."
5. **After any devnet reset, run `infra/scripts/smoke.sh` before touching application code.**
6. **When stuck on Phase 1 config/deployment:** the `nervosnetwork/fiber` repo's `tests/`,
   `config/`, and `docs/` dirs, and `nervosnetwork/fiber-scripts` `deployment/`, are ground truth.
   Search them; do not invent hashes, deps, or config fields.
7. **`export NO_PROXY=127.0.0.1,localhost`** in every shell/script that uses `fnn-cli`
   (documented 503 footgun).
8. **Key files:** `ckb/key` is the first line of the exported key only — 64 hex chars, no `0x`,
   no metadata — `chmod 600`. `FIBER_SECRET_KEY_PASSWORD` is required at every node start.
9. **Channel math:** 99 CKB reserved per side (98 commitment lock + 1 shutdown fee). Usable
   balance = funded − 99 CKB. Enforce this in provisioning math and in tests.
10. **Handle both channel-state casings** (`ChannelReady` / `CHANNEL_READY`) in parsing;
    normalize immediately at the RPC boundary.
11. **Never bind an fnn RPC to a non-loopback address on devnet.** If it ever becomes necessary,
    Biscuit auth (`rpc.biscuit_public_key`) is mandatory first.
12. **Preimages:** generate with `crypto.randomBytes(32)`, store securely, never reuse, never log.
13. Prefer `@ckb-ccc/fiber` methods, but keep the raw `invoke(method, params)` escape hatch per
    RPC method — the SDK is canary-tagged and may lag rc5.
14. Build strictly milestone by milestone (M1→M6). Do not scaffold later phases while an earlier
    milestone is red.

## Quick reference

- 1 CKB = 100,000,000 shannons. CLI = decimal shannons; RPC = hex strings.
- Channel reserve: 99 CKB/side. Usable = funded − 99.
- Invoice currency prefixes: `fibb` mainnet · `fibt` testnet · `fibd` devnet (verify `Fibd` vs rc5).
- Forwarding fee: `ceil(amount × tlc_fee_proportional_millionths / 1_000_000)`; default 1000 = 0.1%.
- Default max fee budget on send: 0.5% (`max_fee_rate` = 5/1000); override with `max_fee_amount`.
- RPC default: `http://127.0.0.1:8227`; params = single-element array with the params object; `[]` for no-arg.
- Ports — hub RPC 8227 / P2P 8228 · customer1 8237/8238 · customer2 8247/8248.
- Backup (stop node first): critical files `ckb/key`, `fiber/sk`, `fiber/store`, `config.yml`.
