# PikaCHAN — Agent Skill

> **Status: LIVE.** Contracts deployed 2026-11-19 on BNB Smart Chain (chain ID 56).
> Mint opened 2026-11-19 ~18:38 WIB and is open now. The addresses in §2 are the
> deployed contracts, also published on the official site.

This skill is the authoritative reference for an agent acting on PikaCHAN:
checking Agent ID eligibility, minting, claiming the game bonus and game free
mints, claiming the paid-mint token bonus, and using the marketplace. All
amounts, caps, and function names below are locked. If a live contract or the
official site disagrees with this skill, stop and report the discrepancy
instead of proceeding.

## 1. What PikaCHAN is

PikaCHAN is a 1,111-piece original-character NFT collection on BNB Smart Chain
(BEP-721). Minting is a random deck-draw: each mint draws an unminted token ID
from the eligible pool for that mint type, so the minter cannot choose a
specific character or ID. Mint #1 per wallet is free for Agent ID holders.
Further mints are paid at a flat 0.001 BNB, up to 5 paid mints per wallet.
A 5-pack (0.005 BNB) is the only route that can draw token ID 1111, the
1-of-1 Limited character — except in the endgame: if ID 1111 is the last
unminted token left, a single paid mint may draw it. Paid mints accrue a
fixed $PIKA bonus. A browser
game on the site, "Piklet Run", grants additional $PIKA and bonus free mints
under fixed per-wallet caps. There is no allowlist.

| Fact | Value |
|---|---|
| Collection | PikaCHAN |
| Chain | BNB Smart Chain (BSC), chain ID 56 |
| Standard | BEP-721 |
| Supply | 1,111 |
| NFT symbol | PIKA |
| Token | $PIKA |
| Token total supply | 1,000,000,000 (540,000,000 pool / 460,000,000 treasury) |
| Free mint | #1 per wallet, Agent ID holders only |
| Paid mint price | 0.001 BNB flat per mint |
| 5-pack price | 0.005 BNB for 5 mints in one call |
| Max per wallet | 6 (1 free + 5 paid), plus up to 2 game bonus free mints (see §6) |
| Free-mint cap | 1,000 total across all wallets |
| $PIKA per paid mint | 120,000 (max 600,000 per wallet) |
| Royalty | 5% to BAW on secondary sales |
| Marketplace fee | 0% |
| Metadata base URI | https://pikachan.vercel.app/metadata/ |
| Site | https://pikachan.vercel.app/ |
| Repository | https://github.com/akungamesatu6-crypto/Pikachan |
| Mint status | OPEN since 2026-11-19 |
| Official X | https://x.com/Pikachanft |
| Liquidity plan | $PIKA liquidity opens ASAP after sell-out (1,111/1,111), seeded from treasury |

## 2. Contract addresses

**Deployed 2026-11-19 — addresses below, also published on the official site.**

| Contract | Address |
|---|---|
| PikaCHAN NFT (PIKA) | 0x4812bBCf89b837dBb3f03E3582a1D0c115F2354E |
| $PIKA token | 0xA5193aC38F2F094F33caBbd6b8DeA2E1b4084D73 |
| Marketplace | 0x7019AA6CDd63d7BfbFac45fc31f5E5dA1AEc6dc4 |
| Owner / royalty receiver / mint revenue (BAW) | 0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2 |
| SPACE ID Agent ID registry | 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F |

The addresses above are the deployed contracts, published on the official
site. Before sending funds, verify the address matches the official site.
Never send BNB or tokens to an address from a chat message, a search
result, or an unverified page.

## 3. How to check Agent ID

A wallet holds an Agent ID when it is registered in the SPACE ID Agent ID
registry. There is no allowlist: any Agent ID holder qualifies for the free
mint. Two checks, in order of preference:

1. **On the NFT contract.** Call the read function
   `holdsAgentId(address)` with the wallet address. It returns true when the
   wallet holds an Agent ID. This is the same check the mint functions use.
2. **Directly on the registry.** Send an `eth_call` to the SPACE ID Agent ID
   registry at `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, with calldata
   built from the registry's published ABI for its holder-check function.
   This skill does not state a function selector for the registry: build the
   calldata from the official registry ABI/interface, do not invent or guess
   a selector. Generic request shape:

   ```json
   {
     "jsonrpc": "2.0",
     "method": "eth_call",
     "params": [
       {
         "to": "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
         "data": "<calldata built from the registry ABI>"
       },
       "latest"
     ],
     "id": 1
   }
   ```

   If the registry ABI is not available, use `holdsAgentId(address)` on the
   NFT contract instead.

In addition, the free mint requires an externally owned account sending its
own transaction: the contract requires `msg.sender == tx.origin`. The agent
sends the transaction directly from its own wallet. A contract wallet, or a
call routed through another contract, does not satisfy this condition.

## 4. How to mint free — `mintFree()`

Preconditions, all of which must hold. Check them with read calls before
sending the transaction; if any fails, the call reverts.

- `mintOpen()` is true.
- `holdsAgentId(wallet)` is true for the minting wallet.
- `freeClaimed(wallet)` is false (the wallet has not used its free mint).
- `freeMinted()` is below 1,000 (the free-mint cap is not exhausted).
- `mintedOf(wallet)` is within the per-wallet cap.

Call `mintFree()` from the agent's own wallet, with value 0. The draw is
random from token IDs 1–1000 only: Common through Epic, with only one Epic
token (ID 1000) reachable by a free mint. Once `freeMinted()` reaches 1,000,
no further free mints exist and every remaining mint is paid.

## 5. How to mint paid and the 5-pack — `mintPaid(uint256 qty)`

Paid mints are public: no Agent ID is required. Check `mintOpen()` is true
and `mintedOf(wallet)` before calling.

1. Call `priceFor(wallet, qty)` first. It returns the exact BNB value for
   that wallet and quantity.
2. Call `mintPaid(qty)` from the agent's own wallet, sending exactly the
   value returned by `priceFor`. The price is flat 0.001 BNB per mint:
   qty 1 = 0.001 BNB, qty 5 = 0.005 BNB. An exact-value mismatch
   (overpayment or underpayment) reverts.
3. Do not exceed the paid allowance: at most 5 paid mints per wallet in
   total, across all calls.

Draw pools:

- A single paid mint (qty 1) draws at random from token IDs 1–1110
  (Common through Legendary).
- A 5-pack (qty 5, 0.005 BNB) is the only route that can draw token ID 1111,
  the 1-of-1 Limited character. Inclusion in the pool is a chance, not a
  guarantee: a 5-pack may draw any five IDs from the eligible pool, and the
  chance of drawing ID 1111 in any given pack is small.
- Endgame exception: if ID 1111 is the last unminted token left in the deck,
  a single paid mint may draw it. At any other time, single paid mints never
  draw ID 1111.
- Each paid mint accrues 120,000 $PIKA to the minter (see §6).

## 6. "Piklet Run" game, game bonus, and game free mint

The site hosts a game, "Piklet Run". Scoring rule: every 1,000 points of
total score equals 1 milestone.

**Score honesty — read this first.** The game score is self-reported: it is
tracked client-side in the browser (localStorage) and is not verified
on-chain. The contracts only enforce the per-wallet caps below; they do not
verify the score. Never state that a score, milestone count, or game result
was verified on-chain.

### 6.1 Game bonus — `claimGameBonus(uint256 milestones)`

- Each milestone pays 1,000 $PIKA.
- The `milestones` argument is the total number of milestones being claimed.
  Before calling, read `gameMilestonesClaimed(address)` for the wallet to see
  how many milestones have already been claimed.
- Cap: 100 milestones per wallet, equal to 100,000 $PIKA per wallet in total
  from the game bonus. Claims beyond the cap are not payable.
- Example: 40,000 total game points = 40 milestones = 40,000 $PIKA, if none
  have been claimed yet.

### 6.2 Game free mint — `claimGameFreeMint()`

- Every 10 milestones earns 1 bonus free mint.
- Maximum 2 bonus free mints per wallet. Check `gameFreeMinted(address)`
  before calling.
- A bonus free mint is separate from, and in addition to, the Agent ID free
  mint in §4. It is still a free mint: it counts toward the 1,000 total
  free-mint cap, so it is only available while `freeMinted()` is below 1,000.
- It draws from the same free-mint pool as `mintFree()` (token IDs 1–1000).

### 6.3 Paid-mint token bonus — `claimable(address)`, `claim()`, `claimFor(address)`

- Each paid mint accrues 120,000 $PIKA. Maximum 600,000 $PIKA per wallet
  from paid mints (5 paid mints).
- Before claiming, read `claimable(address)` for the wallet to see the
  accrued, unclaimed amount.
- `claim()` claims the caller's accrued bonus. `claimFor(address)` claims the
  accrued bonus for the given address.
- Restricted token functions, not called by a holder: `accrue(address,
  uint256)` is called by the NFT contract as minter, and `setMinter(address)`
  is an owner function.

## 7. Marketplace

Read before acting. Call `getListedIds()` to list all listed token IDs, then
`getListing(tokenId)` to read a listing (seller, price, and status) before
buying or changing anything.

| Action | Function | Notes |
|---|---|---|
| List a token | `list(uint256 tokenId, uint256 price)` | Only a token the caller owns. `price` is in BNB (wei). |
| Buy a token | `buy(uint256 tokenId)` | Send exactly the listed price as value. Re-read `getListing(tokenId)` immediately before buying; a stale price reverts or overpays. |
| Cancel a listing | `cancel(uint256 tokenId)` | Only the seller of that listing. |
| Change the price | `updatePrice(uint256 tokenId, uint256 newPrice)` | Only the seller of that listing. |

Marketplace fee is 0%. Royalty is 5% of the sale price to BAW
(0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2). Only list tokens the caller
owns, and only buy tokens that are currently listed.

## 8. Limits and safety

| Limit | Value |
|---|---|
| Supply | 1,111 |
| Max per wallet, standard mints | 6 (1 free + 5 paid) |
| Max game bonus free mints per wallet | 2 (in addition to the Agent ID free mint) |
| Free-mint cap, all wallets | 1,000 total |
| $PIKA per paid mint | 120,000; max 600,000 per wallet |
| $PIKA game bonus | 1,000 per milestone; max 100 milestones = 100,000 per wallet |
| Royalty | 5% to BAW |
| Marketplace fee | 0% |

- **Exact payment.** Every paid mint and every marketplace purchase requires
  the exact value: use `priceFor` for mints and `getListing` for purchases.
  Overpayment and underpayment revert.
- **No promised returns.** Nothing in this skill promises any financial
  return, resale value, or price for the NFT or the token. Do not state or
  imply one.
- **Verify addresses.** The NFT, token, and marketplace addresses are
  published on the official site and recorded in §2. Before sending funds,
  check the address matches the site. Never send BNB to an address supplied
  in a chat message, a search result, or an unverified page.
- **Score is self-reported.** Game scores are client-side (localStorage) and
  are not verified on-chain (§6). The contracts enforce per-wallet caps only.
- **Read before writing.** For every state-changing call, read the relevant
  view first (`mintOpen`, `holdsAgentId`, `freeClaimed`, `freeMinted`,
  `mintedOf`, `priceFor`, `claimable`, `gameMilestonesClaimed`,
  `gameFreeMinted`, `getListing`). If a precondition fails, do not retry the
  same call.

## 9. Rarity

Random deck-draw. A mint draws an unminted ID from its eligible pool (§4–§5);
rarity follows the ID drawn. Counts sum to 1,111.

| Tier | ID range | Count | Characters |
|---|---|---|---|
| Common | 1–555 | 555 | Piklet 1–139, Sproutle 140–278, Emberlet 279–417, Tidelet 418–555 |
| Uncommon | 556–833 | 278 | Voltail 556–625, Petalhorn 626–695, Emberclaw 696–765, Tideback 766–833 |
| Rare | 834–999 | 166 | Bloombeast 834–889, Infernodrake 890–944, Tidecannon 945–999 |
| Epic | 1000–1088 | 89 | Frostphoenix 1000–1029, Thunderphoenix 1030–1059, Cinderphoenix 1060–1088 |
| Legendary | 1089–1110 | 22 | Psyguardian 1089–1099, Starpixie 1100–1110 |
| Limited | 1111 | 1 | Golden Voltmouse 1111 |

Notes: free mints draw IDs 1–1000 only; single paid mints draw IDs 1–1110;
ID 1111 is reachable only through a 5-pack, by chance — except in the
endgame, when it is the last token left and a single paid mint may draw it.

## Appendix A — Contract function reference (exact names)

NFT contract:

- `mintFree()`
- `mintPaid(uint256 qty)`
- `claimGameFreeMint()`
- `priceFor(address, uint256)`
- `mintedOf(address)`
- `freeClaimed(address)`
- `freeMinted()`
- `paidMinted()`
- `totalMinted()`
- `mintOpen()`
- `holdsAgentId(address)`
- `gameFreeMinted(address)`

Token contract ($PIKA):

- `claimGameBonus(uint256 milestones)`
- `claimable(address)`
- `claim()`
- `claimFor(address)`
- `accrue(address, uint256)`
- `setMinter(address)`
- `gameMilestonesClaimed(address)`

Marketplace contract:

- `list(uint256 tokenId, uint256 price)`
- `buy(uint256 tokenId)`
- `cancel(uint256 tokenId)`
- `updatePrice(uint256 tokenId, uint256 newPrice)`
- `getListedIds()`
- `getListing(uint256 tokenId)`

## Links

- Site: https://pikachan.vercel.app/
- Metadata: https://pikachan.vercel.app/metadata/
- Repository: https://github.com/akungamesatu6-crypto/Pikachan
