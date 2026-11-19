// PikaChanMarketplace test suite — escrow, 0% fee, 5% royalty to the
// owner, and the hardcoded 5% fallback when the NFT has no royalty.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const BASE_URI = "https://pikachan.vercel.app/metadata/";
const PRICE = ethers.parseEther("0.001");
const BAW = "0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2";

async function deploy() {
  const [owner, seller, buyer, other] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("MockAgentIdRegistry");
  const registry = await Registry.deploy();
  await registry.setAllowAll(true);
  const Token = await ethers.getContractFactory("PikaToken");
  const token = await Token.deploy(owner.address);
  const Nft = await ethers.getContractFactory("PikaChanNft");
  const nft = await Nft.deploy(BASE_URI, owner.address, await registry.getAddress(), await token.getAddress());
  await token.setMinter(await nft.getAddress());
  await nft.setMintOpen(true);
  const Market = await ethers.getContractFactory("PikaChanMarketplace");
  const market = await Market.deploy(await nft.getAddress());
  return { owner, seller, buyer, other, registry, token, nft, market };
}

async function mintedId(nft, txPromise) {
  const receipt = await (await txPromise).wait();
  const topic = ethers.id("Minted(address,uint256,bool,uint256)");
  for (const log of receipt.logs) {
    if (log.topics[0] === topic) return Number(nft.interface.parseLog(log).args.id);
  }
  throw new Error("no Minted event");
}

describe("PikaChanMarketplace", function () {
  it("list -> buy: seller gets 95%, royalty receiver (owner) gets 5%, buyer gets the NFT", async function () {
    const { owner, seller, buyer, nft, market } = await deploy();
    const id = await mintedId(nft, nft.connect(seller).mintPaid(1, { value: PRICE }));
    await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
    const listPrice = ethers.parseEther("1");
    await expect(market.connect(seller).list(id, listPrice)).to.emit(market, "Listed");
    expect(await market.getListedIds()).to.deep.equal([BigInt(id)]);
    const [lSeller, lPrice, lActive] = await market.getListing(id);
    expect(lSeller).to.equal(seller.address);
    expect(lPrice).to.equal(listPrice);
    expect(lActive).to.equal(true);
    expect(await nft.ownerOf(id)).to.equal(await market.getAddress()); // escrowed

    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const ownerBefore = await ethers.provider.getBalance(owner.address);
    await expect(market.connect(buyer).buy(id, { value: listPrice })).to.emit(market, "Sale");
    expect(await nft.ownerOf(id)).to.equal(buyer.address);
    expect(await market.getListedIds()).to.deep.equal([]);
    expect((await ethers.provider.getBalance(seller.address)) - sellerBefore).to.equal(ethers.parseEther("0.95"));
    expect((await ethers.provider.getBalance(owner.address)) - ownerBefore).to.equal(ethers.parseEther("0.05"));
  });

  it("buy rejects wrong payment and the seller buying their own listing", async function () {
    const { seller, buyer, nft, market } = await deploy();
    const id = await mintedId(nft, nft.connect(seller).mintPaid(1, { value: PRICE }));
    await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(seller).list(id, ethers.parseEther("1"));
    await expect(market.connect(buyer).buy(id, { value: ethers.parseEther("0.9") })).to.be.revertedWith("exact price required");
    await expect(market.connect(seller).buy(id, { value: ethers.parseEther("1") })).to.be.revertedWith("seller cannot buy");
    await expect(market.connect(buyer).buy(9999, { value: ethers.parseEther("1") })).to.be.revertedWith("not listed");
  });

  it("cancel returns the NFT; updatePrice changes the price; only the seller can do either", async function () {
    const { seller, buyer, other, nft, market } = await deploy();
    const id = await mintedId(nft, nft.connect(seller).mintPaid(1, { value: PRICE }));
    await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(seller).list(id, ethers.parseEther("1"));
    await expect(market.connect(other).updatePrice(id, ethers.parseEther("2"))).to.be.revertedWith("not seller");
    await market.connect(seller).updatePrice(id, ethers.parseEther("2"));
    expect((await market.getListing(id))[1]).to.equal(ethers.parseEther("2"));
    await expect(market.connect(other).cancel(id)).to.be.revertedWith("not seller");
    await market.connect(seller).cancel(id);
    expect(await nft.ownerOf(id)).to.equal(seller.address);
    expect(await market.getListedIds()).to.deep.equal([]);
    // Relist after cancel works.
    await market.connect(seller).list(id, ethers.parseEther("1"));
    expect(await market.getListedIds()).to.deep.equal([BigInt(id)]);
  });

  it("list rejects price 0, non-owner, and double-listing", async function () {
    const { seller, buyer, nft, market } = await deploy();
    const id = await mintedId(nft, nft.connect(seller).mintPaid(1, { value: PRICE }));
    await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await expect(market.connect(seller).list(id, 0)).to.be.revertedWith("price 0");
    await expect(market.connect(buyer).list(id, ethers.parseEther("1"))).to.be.revertedWith("not owner");
    await market.connect(seller).list(id, ethers.parseEther("1"));
    await expect(market.connect(seller).list(id, ethers.parseEther("1"))).to.be.revertedWith("already listed");
  });

  it("royalty fallback: NFT without ERC-2981 pays hardcoded 5% to BAW", async function () {
    const [owner, seller, buyer] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC721NoRoyalty");
    const mockNft = await Mock.deploy();
    const Market = await ethers.getContractFactory("PikaChanMarketplace");
    const market = await Market.deploy(await mockNft.getAddress());
    await mockNft.mint(seller.address, 1);
    await mockNft.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(seller).list(1, ethers.parseEther("1"));
    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const bawBefore = await ethers.provider.getBalance(BAW);
    await market.connect(buyer).buy(1, { value: ethers.parseEther("1") });
    expect(await mockNft.ownerOf(1)).to.equal(buyer.address);
    expect((await ethers.provider.getBalance(seller.address)) - sellerBefore).to.equal(ethers.parseEther("0.95"));
    expect((await ethers.provider.getBalance(BAW)) - bawBefore).to.equal(ethers.parseEther("0.05"));
  });
});
