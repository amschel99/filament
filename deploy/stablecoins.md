# Stablecoins on CKB (for Fiber / Filament)

Fiber routes **UDTs** (User-Defined Tokens — CKB's token standard) natively: channels and invoices
can be denominated in a token, not just CKB. So "accept USD stablecoin payments over Fiber" is a
core-protocol capability, not a workaround. The LSP denominates in whatever type script you set in
`deploy/networks/<network>.env`.

## devnet — fUSD (what this repo mints)

A `SIMPLE_UDT` issued locally by the fiber harness's `udt-init`, used as a stand-in dollar. Real,
minted, and **proven paid over Fiber** (see the merchant demo + `udtsmoke`).

| field | value |
|---|---|
| code_hash | `0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419` |
| hash_type | `data2` |
| args | `0x32e555f3ff8e135cece1351a6a2971518392c1e30375c1e006ad0ce8eac07947` (issuer lock hash) |
| cell dep | genesis tx#0, index `0x8`, dep_type `code` |
| decimals | 8 (`$1.00` = `100_000_000` raw units) |

## testnet / mainnet — RUSD

`RUSD` is a real USD stablecoin on CKB (issued by Stables Labs) as an **xUDT**, and Fiber was
explicitly designed to carry stablecoins like it. That's the production target: the *same* LSP code
path that pays fUSD on devnet pays RUSD on mainnet — only the type script in the env file changes.

> **Do not hardcode RUSD's type script from memory.** Look up and **verify** the current
> `code_hash` / `hash_type` / `args` and its cell dep from the official RUSD deployment before
> putting real invoices behind it (CLAUDE.md rule 2). Testnet and mainnet values differ. The env
> templates ship with `__FILL_...__` placeholders and `launch.sh` refuses to start until they're set.

Other CKB assets worth denominating in later: `ccBTC` / wrapped BTC, and any xUDT — the mechanism is
identical.
