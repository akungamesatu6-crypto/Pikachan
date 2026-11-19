// PikaCHAN test suite — proves the locked spec on-chain, locally.
// Covers: deployment constants, royalty, Agent ID gate, EOA gate,
// free/paid/game lanes, exact payment, per-wallet caps, FREE CAP 1000
// (real 1,000-wallet drain), full drain to 1,111 incl. 1111 via the
// endgame single exception (singles can never draw it while other
// tokens remain), deterministic 5-pack draw of 1111
// (JS mirror of the on-chain draw + forced block timestamp), game
// bonus caps, and the PIKA token ledger.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const BASE_URI = "https://pikachan.vercel.app/metadata/";
const PRICE = ethers.parseEther("0.001");
const PACK5 = ethers.parseEther("0.005");
const BONUS = ethers.parseEther("120000");

const MINTED_TOPIC = ethers.id("Minted(address,uint256,bool,uint256)");

function mintedIdsFromReceipt(receipt, nft) {
  const ids = [];
  for (const log of receipt.logs) {
    if (log.topics[0] !== MINTED_TOPIC) continue;
    const parsed = nft.interface.parseLog(log);
    ids.push(Number(parsed.args.id));
  }
  return ids;
}

// ---- JS mirror of PikaChanNft's draw logic (must match exactly) ----
// Seed: keccak256(blockhash(prev block), block.timestamp, sender, draws).
function makeSim() {
  return {
    freeRem: 1000,
    paidRem: 110,
    limited: false,
    freeMap: new Map(),
    paidMap: new Map(),
    draws: 0,
    valueAt(map, i, base) {
      return map.has(i) ? map.get(i) : base + i;
    },
    drawFrom(map, rem, idx, base) {
      const id = this.valueAt(map, idx, base);
      const last = this.valueAt(map, rem - 1, base);
      map.set(idx, last);
      return id;
    },
    // One 5-pack draw (5 draws, pack pool = free + paid + limited).
    drawPack(prevHash, ts, sender) {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const seed = ethers.solidityPackedKeccak256(
          ["bytes32", "uint256", "address", "uint256"],
          [prevHash, ts, sender, this.draws++]
        );
        const total = this.freeRem + this.paidRem + (this.limited ? 0 : 1);
        const r = Number(BigInt(seed) % BigInt(total));
        let id;
        if (r < this.freeRem) {
          id = this.drawFrom(this.freeMap, this.freeRem, r, 1);
          this.freeRem--;
        } else if (r < this.freeRem + this.paidRem) {
          const idx = r - this.freeRem;
          id = this.drawFrom(this.paidMap, this.paidRem, idx, 1001);
          this.paidRem--;
        } else {
          id = 1111;
          this.limited = true;
        }
        ids.push(id);
      }
      return ids;
    },
  };
}

async function deploy({ open = true, allowAll = true } = {}) {
  const [owner, ...signers] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("MockAgentIdRegistry");
  const registry = await Registry.deploy();
  await registry.setAllowAll(allowAll);
  const Token = await ethers.getContractFactory("PikaToken");
  const token = await Token.deploy(owner.address);
  const Nft = await ethers.getContractFactory("PikaChanNft");
  const nft = await Nft.deploy(BASE_URI, owner.address, await registry.getAddress(), await token.getAddress());
  await token.setMinter(await nft.getAddress());
  const Market = await ethers.getContractFactory("PikaChanMarketplace");
  const market = await Market.deploy(await nft.getAddress());
  if (open) await nft.setMintOpen(true);
  return { owner, signers, registry, token, nft, market };
}

describe("PikaCHAN deployment", function () {
  it("constants + ownership + royalty match the locked spec", async function () {
    const { owner, token, nft } = await deploy();
    expect(await nft.name()).to.equal("PikaCHAN");
    expect(await nft.symbol()).to.equal("PIKA");
    expect(await token.name()).to.equal("PikaCHAN");
    expect(await token.symbol()).to.equal("PIKA");
    expect(await nft.MAX_SUPPLY()).to.equal(1111);
    expect(await nft.PRICE()).to.equal(PRICE);
    expect(await nft.PRICE_PACK_5()).to.equal(PACK5);
    expect(await nft.MAX_PER_WALLET()).to.equal(6);
    expect(await nft.MAX_PAID_PER_WALLET()).to.equal(5);
    expect(await nft.FREE_CAP()).to.equal(1000);
    expect(await nft.owner()).to.equal(owner.address);
    expect(await nft.mintOpen()).to.equal(true);
    expect(await nft.totalSupply()).to.equal(0);
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(true);
    expect(await nft.limitedAvailable()).to.equal(true);
    // ERC-2981: 5% to the owner.
    const [receiver, amount] = await nft.royaltyInfo(1, ethers.parseEther("1"));
    expect(receiver).to.equal(owner.address);
    expect(amount).to.equal(ethers.parseEther("0.05"));
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
    expect(await nft.supportsInterface("0x2a55205a")).to.equal(true); // ERC2981
  });

  it("mint starts CLOSED until the owner opens it", async function () {
    const { nft, signers } = await deploy({ open: false });
    await expect(nft.connect(signers[0]).mintFree()).to.be.revertedWithCustomError(nft, "MintClosed");
    await expect(nft.connect(signers[0]).mintPaid(1, { value: PRICE })).to.be.revertedWithCustomError(nft, "MintClosed");
    await nft.setMintOpen(true);
    await expect(nft.connect(signers[0]).mintFree()).to.not.be.reverted;
  });

  it("PIKA token: 1B total, 540M pool held by the token, 460M treasury to owner", async function () {
    const { owner, token } = await deploy();
    expect(await token.totalSupply()).to.equal(ethers.parseEther("1000000000"));
    expect(await token.balanceOf(await token.getAddress())).to.equal(ethers.parseEther("540000000"));
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("460000000"));
    expect(await token.BONUS_POOL()).to.equal(ethers.parseEther("540000000"));
    expect(await token.BONUS_PER_PAID_MINT()).to.equal(BONUS);
    expect(await token.MAX_BONUS_PER_WALLET()).to.equal(ethers.parseEther("600000"));
    expect(await token.GAME_BONUS_PER_MILESTONE()).to.equal(ethers.parseEther("1000"));
    expect(await token.MAX_GAME_MILESTONES()).to.equal(100);
  });
});

describe("PikaCHAN free lane (Agent ID gate)", function () {
  it("contract caller reverts NotAgent", async function () {
    const { nft } = await deploy();
    const Caller = await ethers.getContractFactory("MockMinter");
    const caller = await Caller.deploy(await nft.getAddress());
    await expect(caller.tryMintFree()).to.be.revertedWithCustomError(nft, "NotAgent");
  });

  it("wallet without Agent ID reverts NoAgentId; with Agent ID it mints", async function () {
    const { nft, signers, registry } = await deploy({ allowAll: false });
    expect(await nft.holdsAgentId(signers[0].address)).to.equal(false);
    await expect(nft.connect(signers[0]).mintFree()).to.be.revertedWithCustomError(nft, "NoAgentId");
    await registry.setHasId(signers[0].address, true);
    expect(await nft.holdsAgentId(signers[0].address)).to.equal(true);
    await expect(nft.connect(signers[0]).mintFree()).to.not.be.reverted;
  });

  it("free mint draws id 1-1000, sets freeClaimed, second free reverts FreeClaimed", async function () {
    const { nft, signers } = await deploy();
    const tx = await nft.connect(signers[0]).mintFree();
    const ids = mintedIdsFromReceipt(await tx.wait(), nft);
    expect(ids).to.have.length(1);
    expect(ids[0]).to.be.within(1, 1000);
    expect(await nft.freeClaimed(signers[0].address)).to.equal(true);
    expect(await nft.freeMinted()).to.equal(1);
    expect(await nft.mintedOf(signers[0].address)).to.equal(1);
    expect(await nft.tokenURI(ids[0])).to.equal(BASE_URI + ids[0]);
    await expect(nft.connect(signers[0]).mintFree()).to.be.revertedWithCustomError(nft, "FreeClaimed");
  });

  it("free mint accrues 0 PIKA", async function () {
    const { nft, token, signers } = await deploy();
    await nft.connect(signers[0]).mintFree();
    expect(await token.accrued(signers[0].address)).to.equal(0);
    expect(await token.claimable(signers[0].address)).to.equal(0);
  });
});

describe("PikaCHAN paid lane", function () {
  it("priceFor: 1 = 0.001 BNB, 5-pack = 0.005 BNB, 0 and 6 revert OverLimit", async function () {
    const { nft, signers } = await deploy();
    expect(await nft.priceFor(signers[0].address, 1)).to.equal(PRICE);
    expect(await nft.priceFor(signers[0].address, 4)).to.equal(ethers.parseEther("0.004"));
    expect(await nft.priceFor(signers[0].address, 5)).to.equal(PACK5);
    await expect(nft.priceFor(signers[0].address, 0)).to.be.revertedWithCustomError(nft, "OverLimit");
    await expect(nft.priceFor(signers[0].address, 6)).to.be.revertedWithCustomError(nft, "OverLimit");
  });

  it("underpay and overpay both revert WrongValue (exact payment only)", async function () {
    const { nft, signers } = await deploy();
    await expect(nft.connect(signers[0]).mintPaid(1, { value: ethers.parseEther("0.0009") }))
      .to.be.revertedWithCustomError(nft, "WrongValue");
    await expect(nft.connect(signers[0]).mintPaid(1, { value: ethers.parseEther("0.0011") }))
      .to.be.revertedWithCustomError(nft, "WrongValue");
    await expect(nft.connect(signers[0]).mintPaid(5, { value: ethers.parseEther("0.0051") }))
      .to.be.revertedWithCustomError(nft, "WrongValue");
  });

  it("paid mint is PUBLIC (no Agent ID needed), accrues 120,000 PIKA, forwards BNB to owner", async function () {
    const { owner, nft, token, signers } = await deploy({ allowAll: false });
    const before = await ethers.provider.getBalance(owner.address);
    const tx = await nft.connect(signers[0]).mintPaid(1, { value: PRICE });
    const ids = mintedIdsFromReceipt(await tx.wait(), nft);
    expect(ids[0]).to.be.within(1, 1110); // single paid never draws 1111
    expect(await nft.paidMinted()).to.equal(1);
    expect(await nft.paidMintedOf(signers[0].address)).to.equal(1);
    expect(await token.accrued(signers[0].address)).to.equal(BONUS);
    expect(await token.claimable(signers[0].address)).to.equal(BONUS);
    expect(await token.totalAccrued()).to.equal(BONUS);
    expect((await ethers.provider.getBalance(owner.address)) - before).to.equal(PRICE);
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0);
  });

  it("single paid mint NEVER draws 1111 while other tokens remain", async function () {
    const { nft, signers } = await deploy();
    // 30 paid singles from fresh wallets: the single draw range is the
    // free + paid pools only, so 1111 (outside that range) cannot appear
    // while anything else is left in the deck.
    for (let w = 0; w < 6; w++) {
      const wallet = signers[w];
      for (let k = 0; k < 5; k++) {
        const tx = await nft.connect(wallet).mintPaid(1, { value: PRICE });
        const ids = mintedIdsFromReceipt(await tx.wait(), nft);
        expect(ids[0]).to.be.within(1, 1110);
      }
    }
    expect(await nft.totalMinted()).to.equal(30);
    expect(await nft.limitedAvailable()).to.equal(true);
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(true);
    await expect(nft.ownerOf(1111)).to.be.reverted;
  });

  it("paid mint caps: max 5 paid / 6 total per wallet", async function () {
    const { nft, signers } = await deploy();
    await nft.connect(signers[0]).mintPaid(5, { value: PACK5 });
    expect(await nft.mintedOf(signers[0].address)).to.equal(5);
    await expect(nft.connect(signers[0]).mintPaid(1, { value: PRICE }))
      .to.be.revertedWithCustomError(nft, "OverLimit");
    await expect(nft.priceFor(signers[0].address, 1)).to.be.revertedWithCustomError(nft, "OverLimit");
    // Free + 5 paid = 6 total is the max.
    await nft.connect(signers[1]).mintFree();
    await nft.connect(signers[1]).mintPaid(5, { value: PACK5 });
    expect(await nft.mintedOf(signers[1].address)).to.equal(6);
    await expect(nft.connect(signers[1]).mintPaid(1, { value: PRICE }))
      .to.be.revertedWithCustomError(nft, "OverLimit");
  });

  it("claim / claimFor pay the accrued PIKA; empty claim reverts", async function () {
    const { nft, token, signers } = await deploy();
    await nft.connect(signers[0]).mintPaid(2, { value: ethers.parseEther("0.002") });
    expect(await token.claimable(signers[0].address)).to.equal(BONUS * 2n);
    await token.connect(signers[1]).claimFor(signers[0].address);
    expect(await token.balanceOf(signers[0].address)).to.equal(BONUS * 2n);
    expect(await token.claimable(signers[0].address)).to.equal(0);
    await expect(token.connect(signers[0]).claim()).to.be.revertedWithCustomError(token, "NothingToClaim");
  });

  it("accrue is minter-only", async function () {
    const { token, signers } = await deploy();
    await expect(token.connect(signers[0]).accrue(signers[0].address, BONUS))
      .to.be.revertedWithCustomError(token, "NotMinter");
  });
});

describe("PikaCHAN draw mirror (deterministic check)", function () {
  it("JS mirror predicts the exact ids of a real 5-pack", async function () {
    const { nft, signers } = await deploy();
    const sim = makeSim();
    const before = await ethers.provider.getBlock("latest");
    const tx = await nft.connect(signers[0]).mintPaid(5, { value: PACK5 });
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const predicted = sim.drawPack(before.hash, block.timestamp, signers[0].address);
    const actual = mintedIdsFromReceipt(receipt, nft);
    expect(actual).to.deep.equal(predicted);
  });
});

describe("PikaCHAN 5-pack can reach Limited 1111", function () {
  it("fivePackPoolIncludesLimited() is true, and a forced-timestamp pack draws 1111", async function () {
    const { nft, signers } = await deploy();
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(true);
    const sender = signers[7];
    const latest = await ethers.provider.getBlock("latest");
    // Brute-force a next-block timestamp whose simulated pack contains 1111.
    let ts = Number(latest.timestamp) + 1;
    let found = null;
    for (let tries = 0; tries < 20000 && !found; tries++, ts++) {
      const trial = makeSim();
      const ids = trial.drawPack(latest.hash, ts, sender.address);
      if (ids.includes(1111)) found = { ts, ids };
    }
    expect(found, "no timestamp in 20000 tries yields 1111").to.not.be.null;
    await ethers.provider.send("evm_setNextBlockTimestamp", [found.ts]);
    const tx = await nft.connect(sender).mintPaid(5, { value: PACK5 });
    const actual = mintedIdsFromReceipt(await tx.wait(), nft);
    expect(actual).to.deep.equal(found.ids);
    expect(actual).to.include(1111);
    expect(await nft.ownerOf(1111)).to.equal(sender.address);
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(false);
    expect(await nft.limitedAvailable()).to.equal(false);
  });
});

describe("PikaCHAN game bonus", function () {
  it("claimGameBonus: 1,000 PIKA per milestone, max 100, 101st reverts", async function () {
    const { token, signers } = await deploy();
    await expect(token.connect(signers[0]).claimGameBonus(0))
      .to.be.revertedWithCustomError(token, "InvalidMilestones");
    await token.connect(signers[0]).claimGameBonus(40);
    expect(await token.gameMilestonesClaimed(signers[0].address)).to.equal(40);
    expect(await token.gameBonusClaimed(signers[0].address)).to.equal(ethers.parseEther("40000"));
    expect(await token.balanceOf(signers[0].address)).to.equal(ethers.parseEther("40000"));
    await token.connect(signers[0]).claimGameBonus(60);
    expect(await token.gameMilestonesClaimed(signers[0].address)).to.equal(100);
    expect(await token.gameBonusClaimed(signers[0].address)).to.equal(ethers.parseEther("100000"));
    await expect(token.connect(signers[0]).claimGameBonus(1))
      .to.be.revertedWithCustomError(token, "GameCapExceeded");
    // Another wallet is unaffected by the first wallet's cap.
    await token.connect(signers[1]).claimGameBonus(100);
    expect(await token.balanceOf(signers[1].address)).to.equal(ethers.parseEther("100000"));
  });

  it("claimGameFreeMint: needs 10 milestones per mint, max 2, draws from free pool, counts to FREE CAP", async function () {
    const { nft, token, signers } = await deploy();
    const w = signers[0];
    await expect(nft.connect(w).claimGameFreeMint())
      .to.be.revertedWithCustomError(nft, "InsufficientMilestones");
    await token.connect(w).claimGameBonus(9);
    await expect(nft.connect(w).claimGameFreeMint())
      .to.be.revertedWithCustomError(nft, "InsufficientMilestones");
    await token.connect(w).claimGameBonus(1); // 10 milestones
    const tx1 = await nft.connect(w).claimGameFreeMint();
    const ids1 = mintedIdsFromReceipt(await tx1.wait(), nft);
    expect(ids1[0]).to.be.within(1, 1000);
    expect(await nft.gameFreeMinted(w.address)).to.equal(1);
    expect(await nft.freeMinted()).to.equal(1);
    // Game free mints are EXTRA: they do not consume the 6-per-wallet regular cap.
    expect(await nft.mintedOf(w.address)).to.equal(0);
    await expect(nft.connect(w).claimGameFreeMint())
      .to.be.revertedWithCustomError(nft, "InsufficientMilestones"); // needs 20
    await token.connect(w).claimGameBonus(10); // 20 milestones
    await expect(nft.connect(w).claimGameFreeMint()).to.not.be.reverted;
    expect(await nft.gameFreeMinted(w.address)).to.equal(2);
    expect(await nft.freeMinted()).to.equal(2);
    await token.connect(w).claimGameBonus(10); // 30 milestones
    await expect(nft.connect(w).claimGameFreeMint())
      .to.be.revertedWithCustomError(nft, "OverLimit"); // max 2 game free mints
  });
});

describe("PikaCHAN FREE CAP 1000 + full drain (slow)", function () {
  it("1000 free mints from 1000 wallets, then 110 paid singles -> 1110, endgame single takes 1111 -> 1111 minted", async function () {
    const { nft, token, signers } = await deploy(); // allowAll = true
    const allIds = new Set();
    // 1,000 free mints, in batches of 100 concurrent txs.
    for (let start = 0; start < 1000; start += 100) {
      const batch = signers.slice(start, start + 100).map((s) => nft.connect(s).mintFree());
      const txs = await Promise.all(batch);
      const receipts = await Promise.all(txs.map((t) => t.wait()));
      for (const rc of receipts) {
        for (const id of mintedIdsFromReceipt(rc, nft)) {
          expect(id).to.be.within(1, 1000);
          expect(allIds.has(id), `duplicate id ${id}`).to.equal(false);
          allIds.add(id);
        }
      }
    }
    expect(allIds.size).to.equal(1000);
    expect(await nft.freeMinted()).to.equal(1000);
    expect(await nft.freeRemaining()).to.equal(0);
    expect(await nft.totalMinted()).to.equal(1000);
    // The 1,001st free claim (fresh wallet, never claimed) hits the cap.
    await expect(nft.connect(signers[1000]).mintFree())
      .to.be.revertedWithCustomError(nft, "FreeCapReached");
    // Game free mint also hits the cap (it shares the freeMinted counter).
    await token.connect(signers[1001]).claimGameBonus(10);
    await expect(nft.connect(signers[1001]).claimGameFreeMint())
      .to.be.revertedWithCustomError(nft, "FreeCapReached");
    // 110 paid singles (22 wallets x 5) drain ids 1001-1110.
    for (let w = 0; w < 22; w++) {
      const wallet = signers[1000 + w];
      for (let k = 0; k < 5; k++) {
        const tx = await nft.connect(wallet).mintPaid(1, { value: PRICE });
        for (const id of mintedIdsFromReceipt(await tx.wait(), nft)) {
          expect(id).to.be.within(1001, 1110);
          expect(allIds.has(id), `duplicate id ${id}`).to.equal(false);
          allIds.add(id);
        }
      }
    }
    expect(allIds.size).to.equal(1110);
    expect(await nft.totalMinted()).to.equal(1110);
    expect(await nft.paidMinted()).to.equal(110);
    // Limited 1111 was NEVER drawn by a single paid mint while other
    // tokens remained in the deck.
    await expect(nft.ownerOf(1111)).to.be.reverted;
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(true);
    // Endgame: only 1111 remains. A 5-pack still cannot help (it draws
    // exactly 5, pool is 1) and qty 2+ has nothing to draw.
    await expect(nft.connect(signers[1100]).mintPaid(5, { value: PACK5 }))
      .to.be.revertedWithCustomError(nft, "SoldOut");
    await expect(nft.priceFor(signers[1100].address, 2))
      .to.be.revertedWithCustomError(nft, "SoldOut");
    // ENDGAME EXCEPTION: a single paid mint may take the last token.
    expect(await nft.priceFor(signers[1100].address, 1)).to.equal(PRICE);
    const endTx = await nft.connect(signers[1100]).mintPaid(1, { value: PRICE });
    const endIds = mintedIdsFromReceipt(await endTx.wait(), nft);
    expect(endIds).to.deep.equal([1111]);
    expect(await nft.ownerOf(1111)).to.equal(signers[1100].address);
    expect(allIds.has(1111)).to.equal(false);
    allIds.add(1111);
    expect(allIds.size).to.equal(1111);
    expect(await nft.totalMinted()).to.equal(1111);
    expect(await nft.limitedAvailable()).to.equal(false);
    expect(await nft.fivePackPoolIncludesLimited()).to.equal(false);
    // Collection fully drained: nothing left to mint, single or pack.
    await expect(nft.connect(signers[1101]).mintPaid(1, { value: PRICE }))
      .to.be.revertedWithCustomError(nft, "SoldOut");
    await expect(nft.connect(signers[1101]).mintPaid(5, { value: PACK5 }))
      .to.be.revertedWithCustomError(nft, "SoldOut");
    expect(await nft.totalMinted()).to.equal(1111);
  });
});
