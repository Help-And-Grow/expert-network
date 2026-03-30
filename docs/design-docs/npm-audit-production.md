# npm audit — production dependency posture

**Scope:** Help & Grow — Expert Network (root `package.json`)  
**Date:** 2026-03  
**Status:** Accepted — **triage complete** for current tree; re-run on dependency bumps

## What we did

- **`npm audit fix`** applied where safe.
- **`overrides.serialize-javascript`** → `^7.0.5` in root `package.json` to address **mocha → serialize-javascript** advisories without waiting on Hardhat’s pinned tree.
- **CI** still runs `npm run audit:triage` and uploads **`audit-production.json`** ([`.github/workflows/npm-audit.yml`](../../.github/workflows/npm-audit.yml)).

## Remaining advisories (accepted risk)

`npm audit --omit=dev` may still report issues that **all trace through**:

`@ethereum-attestation-service/eas-sdk` → `@ethereum-attestation-service/eas-contracts` → **Hardhat** → *@sentry/node / cookie, elliptic / ethers@5, solc / tmp, undici@6, …*

**Why this is acceptable for now**

- That stack is used for **contract tooling / attestation** (build-time or specialized scripts), not the **Next.js serverless request path** for typical web traffic.
- **No upstream fix** without upgrading EAS packages / Hardhat major lines; doing so is a **separate migration** (test Foundry/EAS flows).

**Follow-up**

- When `@ethereum-attestation-service/eas-sdk` (or Foundry-only workflows) removes the Hardhat-heavy tree, re-run `npm audit --omit=dev` and drop overrides if no longer needed.
- WeChat Mini Program (`wechat/`) has its own tree — run `cd wechat && npm audit` separately.

**Commands**

| Action | Command |
|--------|---------|
| Production deps audit | `npm run audit:triage` or `npm audit --omit=dev` |
| Attempt automatic fixes | `npm run audit:fix` |
