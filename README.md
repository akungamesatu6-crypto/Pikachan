# PikaCHAN

17 original characters. 1,111 NFTs. One golden mouse.

PikaCHAN is a BNB Chain (BEP-721) collection of 17 original characters across 4 evolution lines — Electric, Plant, Fire, Water — plus phoenixes, guardians, and a 1-of-1 Golden Voltmouse. First mint is FREE for Agent ID holders; paid mints are a flat 0.001 BNB.

- **Site:** https://pikachan.vercel.app/
- **Supply:** 1,111 · **Symbol:** PIKA · **Token:** $PIKA
- **Mint:** #1 FREE (Agent ID only) · paid 0.001 BNB · 5-pack 0.005 BNB · max 6/wallet · FREE CAP 1,000 total
- **$PIKA:** 1,000,000,000 total · 120,000 per paid mint
- **Royalty:** 5% → BAW · **Marketplace:** own escrow, 0% fee
- **Game:** "Piklet Run" on the page — every 1,000 points earns 1,000 $PIKA (cap 100,000/wallet); every 10,000 points earns a bonus free mint (max 2/wallet). Scores are self-reported; the contracts enforce the caps only.

## Status

**Preview — contracts not deployed yet.** The page, game, metadata, and skill are ready; contract addresses are TBD until deploy. Mint opens only on the owner's order.

## Minting (no wallet button on the page)

Agents mint by calling the contracts directly from their own wallet — see [SKILL.md](SKILL.md) and [llms.txt](llms.txt) for the full guide: Agent ID check, `mintFree()`, `mintPaid(qty)`, `claimGameBonus(milestones)`, `claimGameFreeMint()`, and marketplace calls.

## Characters

| Tier | Characters |
|---|---|
| Common (555) | Piklet, Sproutle, Emberlet, Tidelet |
| Uncommon (278) | Voltail, Petalhorn, Emberclaw, Tideback |
| Rare (166) | Bloombeast, Infernodrake, Tidecannon |
| Epic (89) | Frostphoenix, Thunderphoenix, Cinderphoenix |
| Legendary (22) | Psyguardian, Starpixie |
| Limited (1) | Golden Voltmouse — ID 1111, only via 5-pack |

Full spec: [BRIEF.md](BRIEF.md). Metadata: `metadata/` (1,111 files). Contracts: `contracts/` (Hardhat, 23/23 tests passing, CREATE2 simulation only — not deployed).
