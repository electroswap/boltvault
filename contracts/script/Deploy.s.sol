// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {BoltVaultFeeSink} from "../src/BoltVaultFeeSink.sol";
import {BoltVaultFeeSchedule} from "../src/BoltVaultFeeSchedule.sol";

/// @notice Deploys the sink and the schedule with the owner's defaults (§8.18, decided 2026-09-05 on USD prices:
///         1 BOLT = $0.00185, 1 DYNO = $1.62). Tiers keep the 1 : 10 : 50 : 100 ladder and the top tier needs
///         $2,500+ of BOLT and DYNO combined: $25 / $250 / $1,250 / $2,500 → 13,600 / 136,000 / 680,000 / 1,360,000
///         BOLT-eq (rounded up to clean figures). 1 DYNO counts as 875.68 BOLT-eq. Ops re-tunes with setTiers /
///         setDynoWeight as prices move; no wallet release is needed.
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
        tiers[0] = BoltVaultFeeSchedule.Tier(13_600e18, 40); // ≈ $25
        tiers[1] = BoltVaultFeeSchedule.Tier(136_000e18, 30); // ≈ $250
        tiers[2] = BoltVaultFeeSchedule.Tier(680_000e18, 20); // ≈ $1,250
        tiers[3] = BoltVaultFeeSchedule.Tier(1_360_000e18, 10); // ≈ $2,500
        schedule.setTiers(tiers);
        if (dyno != address(0)) schedule.setDynoWeight(875.68e18); // $1.62 / $0.00185 BOLT-eq per DYNO
        schedule.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("BoltVaultFeeSink", address(sink));
        console2.log("BoltVaultFeeSchedule", address(schedule));
        console2.log("Owner must call acceptOwnership() on the schedule.");
    }
}
