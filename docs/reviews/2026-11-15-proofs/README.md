# Proofs from the review of v0.1.0 (2026-11-15)

Scripts written by the independent reviewer to demonstrate the faults listed in
[../2026-11-15-v0.1.0.md](../2026-11-15-v0.1.0.md). They **pass while the fault exists**
(each asserts the faulty behaviour at v0.1.0), so they are raw material for regression tests,
not part of `npm test`. When a fault is fixed, turn its proof into a normal test with the
assertion reversed.

- `core-proofs.test.mjs`, `core-proofs2.test.mjs`: room core on the fake host (P1–P19).
- `client-proofs.test.mjs`, `client-proofs2.test.mjs`, `bridge.mjs`: the real client on an in-process bridge (C1–C7, S1).
- `w1.mjs` … `w4.mjs`, `wr.mjs`: against a local `wrangler dev` on port 8799 (real workerd, real hibernation).
- `find.sh`: simulation of the update template's version selection.

**They only run at the tag `v0.1.0`** (`git checkout v0.1.0`, then from the repository root e.g. `node --test docs/reviews/2026-11-15-proofs/core-proofs.test.mjs` after copying this folder there): v0.2.0 changed the API they use. The faults they show were fixed in v0.2.0, each with a regression test in `tests/unit/hardening.test.js`, `tests/unit/host-owner.test.js`, `tests/unit/client.test.js` or `tests/integration/sleep.test.mjs`.
