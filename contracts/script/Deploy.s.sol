// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {BoltVaultFeeSink} from "../src/BoltVaultFeeSink.sol";
import {BoltVaultFeeSchedule} from "../src/BoltVaultFeeSchedule.sol";

/// @notice Deploys the sink and the schedule with the illustrative tiers (§8.18); ops sets the real numbers afterwards.
///   OWNER=0x… BOLT=0x… DYNO=0x… FARM=0x… forge script script/Deploy.s.sol --rpc-url electroneum_testnet --broadcast
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        address bolt = vm.envAddress("BOLT");
        address dyno = vm.envOr("DYNO", address(0));
        address farm = vm.envOr("FARM", address(0));

        vm.startBroadcast();
        BoltVaultFeeSink sink = new BoltVaultFeeSink(owner);
        BoltVaultFeeSchedule schedule = new BoltVaultFeeSchedule(msg.sender, bolt, dyno, farm);
        BoltVaultFeeSchedule.Tier[] memory tiers = new BoltVaultFeeSchedule.Tier[](4);
        tiers[0] = BoltVaultFeeSchedule.Tier(1_000e18, 40);
        tiers[1] = BoltVaultFeeSchedule.Tier(10_000e18, 30);
        tiers[2] = BoltVaultFeeSchedule.Tier(50_000e18, 20);
        tiers[3] = BoltVaultFeeSchedule.Tier(100_000e18, 10);
        schedule.setTiers(tiers);
        schedule.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("BoltVaultFeeSink", address(sink));
        console2.log("BoltVaultFeeSchedule", address(schedule));
        console2.log("Owner must call acceptOwnership() on the schedule.");
    }
}
