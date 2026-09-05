// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BoltVaultFeeSchedule, IYieldFarm} from "../src/BoltVaultFeeSchedule.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract MockFarm {
    mapping(uint256 => mapping(address => uint256)) public deposited;

    function set(uint256 farmId, address who, uint256 amount) external {
        deposited[farmId][who] = amount;
    }

    function getFarmerByFarmIdAndAddress(uint256 farmId, address who) external view returns (IYieldFarm.Farmer memory f) {
        f.addr = who;
        f.boltDeposited = deposited[farmId][who];
    }
}

contract FeeScheduleTest is Test {
    BoltVaultFeeSchedule schedule;
    MockToken bolt;
    MockToken dyno;
    MockFarm farm;
    address owner = address(0xA11CE);
    address alice = address(0xB0B);

    function setUp() public {
        bolt = new MockToken();
        dyno = new MockToken();
        farm = new MockFarm();
        schedule = new BoltVaultFeeSchedule(owner, address(bolt), address(dyno), address(farm));
        BoltVaultFeeSchedule.Tier[] memory tiers = new BoltVaultFeeSchedule.Tier[](4);
        tiers[0] = BoltVaultFeeSchedule.Tier(1_000e18, 40);
        tiers[1] = BoltVaultFeeSchedule.Tier(10_000e18, 30);
        tiers[2] = BoltVaultFeeSchedule.Tier(50_000e18, 20);
        tiers[3] = BoltVaultFeeSchedule.Tier(100_000e18, 10);
        vm.prank(owner);
        schedule.setTiers(tiers);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 7;
        vm.prank(owner);
        schedule.setFarmIds(ids);
    }

    function test_baseForNoHoldings() public view {
        (uint16 bips, uint8 tier, uint256 score) = schedule.feeBipsFor(alice);
        assertEq(bips, 50);
        assertEq(tier, 0);
        assertEq(score, 0);
    }

    function test_tiersByBoltBalance() public {
        bolt.mint(alice, 1_000e18);
        (uint16 bips, uint8 tier, ) = schedule.feeBipsFor(alice);
        assertEq(bips, 40);
        assertEq(tier, 1);
        bolt.mint(alice, 99_000e18);
        (bips, tier, ) = schedule.feeBipsFor(alice);
        assertEq(bips, 10);
        assertEq(tier, 4);
    }

    function test_farmBoltCountsWhenEnabled() public {
        farm.set(7, alice, 10_000e18);
        (uint16 bips, , uint256 score) = schedule.feeBipsFor(alice);
        assertEq(score, 10_000e18);
        assertEq(bips, 30);
        vm.prank(owner);
        schedule.setCountFarmBolt(false);
        (bips, , score) = schedule.feeBipsFor(alice);
        assertEq(score, 0);
        assertEq(bips, 50);
    }

    function test_dynoWeightedWhenSet() public {
        dyno.mint(alice, 50_000e18);
        (, , uint256 score) = schedule.feeBipsFor(alice);
        assertEq(score, 0); // weight 0: DYNO does not count
        vm.prank(owner);
        schedule.setDynoWeight(0.2e18); // 1 DYNO = 0.2 BOLT-eq (5 DYNO per BOLT)
        (uint16 bips, , uint256 weighted) = schedule.feeBipsFor(alice);
        assertEq(weighted, 10_000e18);
        assertEq(bips, 30);
    }

    function test_dynoWorthMoreThanOneBolt() public {
        // The deployed weight: 1 DYNO = 875.68 BOLT-eq ($1.62 / $0.00185 on 2026-09-05).
        dyno.mint(alice, 2e18);
        vm.prank(owner);
        schedule.setDynoWeight(875.68e18);
        (uint16 bips, uint8 tier, uint256 score) = schedule.feeBipsFor(alice);
        assertEq(score, 1_751.36e18);
        assertEq(tier, 1);
        assertEq(bips, 40);
    }

    function test_aMissingFarmNeverBlocksTheRead() public {
        BoltVaultFeeSchedule s = new BoltVaultFeeSchedule(owner, address(bolt), address(dyno), address(0xDEAD));
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(owner);
        s.setFarmIds(ids);
        bolt.mint(alice, 5e18);
        (, , uint256 score) = s.feeBipsFor(alice);
        assertEq(score, 5e18);
    }

    function test_ownerGatingAndValidation() public {
        vm.expectRevert(BoltVaultFeeSchedule.NotOwner.selector);
        schedule.setBaseBips(10);

        vm.prank(owner);
        vm.expectRevert(BoltVaultFeeSchedule.BipsTooHigh.selector);
        schedule.setBaseBips(1_001);

        BoltVaultFeeSchedule.Tier[] memory bad = new BoltVaultFeeSchedule.Tier[](2);
        bad[0] = BoltVaultFeeSchedule.Tier(10e18, 40);
        bad[1] = BoltVaultFeeSchedule.Tier(5e18, 30);
        vm.prank(owner);
        vm.expectRevert(BoltVaultFeeSchedule.TiersNotAscending.selector);
        schedule.setTiers(bad);

        BoltVaultFeeSchedule.Tier[] memory above = new BoltVaultFeeSchedule.Tier[](1);
        above[0] = BoltVaultFeeSchedule.Tier(10e18, 60);
        vm.prank(owner);
        vm.expectRevert(BoltVaultFeeSchedule.TierAboveBase.selector);
        schedule.setTiers(above);
    }

    function test_zeroBipsTopTierIsExplicit() public {
        BoltVaultFeeSchedule.Tier[] memory tiers = new BoltVaultFeeSchedule.Tier[](1);
        tiers[0] = BoltVaultFeeSchedule.Tier(1e18, 0);
        vm.prank(owner);
        schedule.setTiers(tiers);
        bolt.mint(alice, 1e18);
        (uint16 bips, uint8 tier, ) = schedule.feeBipsFor(alice);
        assertEq(bips, 0);
        assertEq(tier, 1);
    }

    function test_scheduleView() public view {
        (uint16 base, BoltVaultFeeSchedule.Tier[] memory tiers, uint256 weight, bool countFarm, uint16 discount) = schedule.schedule();
        assertEq(base, 50);
        assertEq(tiers.length, 4);
        assertEq(weight, 0);
        assertTrue(countFarm);
        assertEq(discount, 2_500);
    }

    function test_twoStepOwnership() public {
        vm.prank(owner);
        schedule.transferOwnership(alice);
        assertEq(schedule.owner(), owner);
        vm.prank(alice);
        schedule.acceptOwnership();
        assertEq(schedule.owner(), alice);
    }
}
