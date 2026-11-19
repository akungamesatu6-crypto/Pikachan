// SPDX-License-Identifier: MIT
// PIKA — BEP-20 bonus token for PikaCHAN paid mints + game milestones.
// Mirrors EYE (Eye Agent) exactly, renamed, with the game-bonus extension:
//   Total supply 1,000,000,000 PIKA (18 decimals), fixed at deploy —
//   NO further minting ever. Bonus pool 540,000,000 PIKA is held by this
//   token contract itself; the remaining 460,000,000 PIKA is minted to the
//   owner at deploy (treasury — owner-controlled, not part of the bonus
//   pool). Every PAID PikaCHAN mint accrues 120,000 PIKA for the minter's
//   wallet, recorded by the NFT contract via accrue() (only the NFT
//   contract — set by the owner with setMinter() after the NFT deploys —
//   can accrue). Free mints accrue 0. Max 600,000 PIKA per wallet from
//   paid mints (5 paid x 120,000); accrue() enforces both the per-wallet
//   cap and the pool cap (total accrued can never exceed 540,000,000).
//   Worst case the whole 1,111 collection could pay out
//   1,111 x 120,000 = 133,320,000 PIKA < 540,000,000 pool.
//   Claims are retroactive: claim() pays the caller's claimable balance;
//   claimFor(address) pays a beneficiary's claimable balance and can be
//   called by any wallet.
//
//   GAME BONUS (on-chain, score is SELF-REPORTED — this contract ONLY
//   enforces the cap, it does not verify any game result):
//   claimGameBonus(milestones) pays 1,000 PIKA per milestone, max 100
//   milestones (100,000 PIKA) per wallet, ever. Tracks
//   gameMilestonesClaimed(wallet) and gameBonusClaimed(wallet). The NFT
//   contract reads gameMilestonesClaimed() to gate claimGameFreeMint()
//   (1 extra free mint per 10 claimed milestones, max 2). Game payouts
//   draw from the same 540,000,000 pool: totalAccrued (paid-mint
//   accruals) + gameBonusDistributed can never exceed BONUS_POOL, so a
//   game claim can never strand an already-accrued paid-mint claim.
//   Worst case game payouts: 1,111 wallets x 100,000 = 111,100,000 PIKA;
//   combined worst case 133,320,000 + 111,100,000 = 244,420,000 < pool.
//   No staking, no tax, no pausing, no blacklist — plain ERC-20 +
//   accrual ledger + capped game bonus.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PikaCHAN token (PIKA)
contract PikaToken is ERC20, Ownable {
    uint256 public constant BONUS_POOL = 540_000_000 ether; // held by this contract
    uint256 public constant BONUS_PER_PAID_MINT = 120_000 ether;
    uint256 public constant MAX_BONUS_PER_WALLET = 600_000 ether; // 5 paid x 120,000

    uint256 public constant GAME_BONUS_PER_MILESTONE = 1_000 ether; // 1,000 PIKA per milestone
    uint256 public constant MAX_GAME_MILESTONES = 100; // 100 milestones = 100,000 PIKA max per wallet
    uint256 public constant MAX_GAME_BONUS_PER_WALLET = 100_000 ether;

    address public minter; // the PikaCHAN NFT contract; set by owner after NFT deploy
    uint256 public totalAccrued; // sum of all accrue() amounts; never exceeds BONUS_POOL
    uint256 public gameBonusDistributed; // sum of all claimGameBonus() payouts

    mapping(address => uint256) public accrued; // lifetime paid-mint bonus earned
    mapping(address => uint256) public claimed; // lifetime paid-mint bonus claimed
    mapping(address => uint256) public gameMilestonesClaimed; // lifetime game milestones claimed
    mapping(address => uint256) public gameBonusClaimed; // lifetime game bonus received

    event Accrued(address indexed wallet, uint256 amount, uint256 totalAccruedForWallet);
    event Claimed(address indexed wallet, uint256 amount);
    event MinterSet(address indexed minter);
    event GameBonusClaimed(address indexed wallet, uint256 milestones, uint256 amount);

    error NotMinter();
    error NothingToClaim();
    error OverPoolCap();
    error OverWalletCap();
    error InvalidMilestones();
    error GameCapExceeded();

    constructor(address owner_) ERC20("PikaCHAN", "PIKA") Ownable(owner_) {
        // Pool stays in this contract for claims; remainder goes to the owner.
        _mint(address(this), BONUS_POOL);
        _mint(owner_, 460_000_000 ether);
    }

    /// @notice Claimable PIKA for a wallet (accrued minus already claimed).
    function claimable(address wallet) public view returns (uint256) {
        return accrued[wallet] - claimed[wallet];
    }

    /// @notice Record a paid-mint bonus for a wallet. Only the NFT contract can call this.
    function accrue(address wallet, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (totalAccrued + gameBonusDistributed + amount > BONUS_POOL) revert OverPoolCap();
        if (accrued[wallet] + amount > MAX_BONUS_PER_WALLET) revert OverWalletCap();
        accrued[wallet] += amount;
        totalAccrued += amount;
        emit Accrued(wallet, amount, accrued[wallet]);
    }

    /// @notice Claim your own waiting PIKA (paid-mint bonus only).
    function claim() external {
        _claim(msg.sender);
    }

    /// @notice Claim a beneficiary's waiting PIKA to that beneficiary. Callable by anyone.
    function claimFor(address beneficiary) external {
        _claim(beneficiary);
    }

    function _claim(address wallet) internal {
        uint256 amount = claimable(wallet);
        if (amount == 0) revert NothingToClaim();
        claimed[wallet] += amount;
        _transfer(address(this), wallet, amount);
        emit Claimed(wallet, amount);
    }

    /// @notice Claim the game bonus: 1,000 PIKA per milestone, max 100
    /// milestones per wallet ever. The milestone count is SELF-REPORTED
    /// by the caller — this contract only enforces the cap. The payout
    /// comes straight from the bonus pool (no separate claim step).
    function claimGameBonus(uint256 milestones) external {
        if (milestones == 0) revert InvalidMilestones();
        if (gameMilestonesClaimed[msg.sender] + milestones > MAX_GAME_MILESTONES) revert GameCapExceeded();
        uint256 amount = milestones * GAME_BONUS_PER_MILESTONE;
        if (totalAccrued + gameBonusDistributed + amount > BONUS_POOL) revert OverPoolCap();
        gameMilestonesClaimed[msg.sender] += milestones;
        gameBonusClaimed[msg.sender] += amount;
        gameBonusDistributed += amount;
        _transfer(address(this), msg.sender, amount);
        emit GameBonusClaimed(msg.sender, milestones, amount);
    }

    /// @notice Point accrual at the PikaCHAN NFT contract (called once, by owner, after NFT deploy).
    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
        emit MinterSet(minter_);
    }
}
