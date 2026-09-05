// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @dev ElectroSwap YieldFarm (packages/electroswap/abis/YieldFarm.json): the farmer tuple, in ABI order.
interface IYieldFarm {
    struct Farmer {
        address addr;
        uint256 liquidity;
        uint256 boltMultiplier;
        uint256 boltDeposited;
        uint256 durationMultiplier;
        uint256 startingBlock;
        uint256 rewards;
        uint256 rewardDebt;
        uint256 thirdPartyRewards;
        uint256 thirdPartyRewardDebt;
        uint256 fees0;
        uint256 fees0Debt;
        uint256 fees1;
        uint256 fees1Debt;
    }

    function getFarmerByFarmIdAndAddress(uint256 farmId, address farmer) external view returns (Farmer memory);
}

/// @title BoltVaultFeeSchedule
/// @notice The in-wallet swap fee by holder tier (master plan §8.18). The
///         wallet reads `feeBipsFor(account)` at quote time and again at
///         sign time; changing the schedule is an owner transaction, not a
///         wallet release. Score = BOLT balance + BOLT deposited as farm boost
///         (when counted) + DYNO balance / dynoWeight (when weighted).
contract BoltVaultFeeSchedule {
    struct Tier {
        uint256 minScore;
        uint16 bips;
    }

    uint16 public constant MAX_BIPS = 1_000; // 10 %, a hard ceiling on what any schedule may charge

    address public owner;
    address public pendingOwner;

    IERC20Balance public immutable bolt;
    IERC20Balance public immutable dyno;
    IYieldFarm public immutable farm;

    uint16 public baseBips = 50;
    /// @notice How many DYNO count as one BOLT-equivalent; 0 means DYNO does not count.
    uint256 public dynoWeight;
    bool public countFarmBolt = true;
    uint256[] public farmIds;
    Tier[] private _tiers;
    /// @notice Discount for paying the fee in BOLT (v1.1), in bips of the fee.
    uint16 public boltPayDiscountBips = 2_500;
    /// @notice Reserved: minimum holding duration in blocks (needs a balance-snapshot hook to enforce).
    uint256 public minHoldBlocks;

    event BaseBipsSet(uint16 bips);
    event TiersSet(Tier[] tiers);
    event DynoWeightSet(uint256 weight);
    event CountFarmBoltSet(bool count);
    event FarmIdsSet(uint256[] farmIds);
    event BoltPayDiscountSet(uint16 bips);
    event MinHoldBlocksSet(uint256 blocks);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error BipsTooHigh();
    error TiersNotAscending();
    error TierAboveBase();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, address boltToken, address dynoToken, address yieldFarm) {
        if (initialOwner == address(0) || boltToken == address(0)) revert ZeroAddress();
        owner = initialOwner;
        bolt = IERC20Balance(boltToken);
        dyno = IERC20Balance(dynoToken);
        farm = IYieldFarm(yieldFarm);
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ---- reads (what the wallet calls) ---------------------------------------------

    /// @notice The fee for `account`: its bips, the tier index (0 = base) and the score behind it.
    function feeBipsFor(address account) external view returns (uint16 bips, uint8 tier, uint256 score) {
        score = scoreOf(account);
        bips = baseBips;
        tier = 0;
        uint256 n = _tiers.length;
        for (uint256 i = 0; i < n; i++) {
            if (score >= _tiers[i].minScore) {
                bips = _tiers[i].bips;
                tier = uint8(i + 1);
            } else {
                break;
            }
        }
    }

    /// @notice The whole schedule for the fee sheet.
    function schedule() external view returns (uint16 base, Tier[] memory tiers, uint256 weight, bool countFarm, uint16 boltPayDiscount) {
        return (baseBips, _tiers, dynoWeight, countFarmBolt, boltPayDiscountBips);
    }

    function tiers() external view returns (Tier[] memory) {
        return _tiers;
    }

    function farmIdCount() external view returns (uint256) {
        return farmIds.length;
    }

    /// @notice BOLT-equivalent score of an account. Farm reads are best effort: a missing farm never blocks a swap.
    function scoreOf(address account) public view returns (uint256 score) {
        score = bolt.balanceOf(account);
        if (countFarmBolt && address(farm).code.length != 0) {
            uint256 n = farmIds.length;
            for (uint256 i = 0; i < n; i++) {
                try farm.getFarmerByFarmIdAndAddress(farmIds[i], account) returns (IYieldFarm.Farmer memory f) {
                    score += f.boltDeposited;
                } catch {}
            }
        }
        if (dynoWeight != 0 && address(dyno).code.length != 0) {
            score += dyno.balanceOf(account) / dynoWeight;
        }
    }

    // ---- owner ---------------------------------------------------------------------

    function setBaseBips(uint16 bips) external onlyOwner {
        if (bips > MAX_BIPS) revert BipsTooHigh();
        uint256 n = _tiers.length;
        for (uint256 i = 0; i < n; i++) {
            if (_tiers[i].bips > bips) revert TierAboveBase();
        }
        baseBips = bips;
        emit BaseBipsSet(bips);
    }

    /// @notice Replace the tier table. Must be ascending by minScore; no tier may charge more than the base. A 0-bips tier is allowed and explicit.
    function setTiers(Tier[] calldata newTiers) external onlyOwner {
        delete _tiers;
        uint256 last = 0;
        for (uint256 i = 0; i < newTiers.length; i++) {
            if (newTiers[i].bips > baseBips) revert TierAboveBase();
            if (i > 0 && newTiers[i].minScore <= last) revert TiersNotAscending();
            last = newTiers[i].minScore;
            _tiers.push(newTiers[i]);
        }
        emit TiersSet(newTiers);
    }

    function setDynoWeight(uint256 weight) external onlyOwner {
        dynoWeight = weight;
        emit DynoWeightSet(weight);
    }

    function setCountFarmBolt(bool count) external onlyOwner {
        countFarmBolt = count;
        emit CountFarmBoltSet(count);
    }

    function setFarmIds(uint256[] calldata ids) external onlyOwner {
        farmIds = ids;
        emit FarmIdsSet(ids);
    }

    function setBoltPayDiscountBips(uint16 bips) external onlyOwner {
        if (bips > 10_000) revert BipsTooHigh();
        boltPayDiscountBips = bips;
        emit BoltPayDiscountSet(bips);
    }

    function setMinHoldBlocks(uint256 blocks) external onlyOwner {
        minHoldBlocks = blocks;
        emit MinHoldBlocksSet(blocks);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
