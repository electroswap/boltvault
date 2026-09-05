// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

/// @dev The subset of Foundry cheatcodes these contracts' tests and scripts use.
///      Vendored because the workspace has no network for `forge install`;
///      the selectors match foundry-rs/forge-std (the cheatcode address is stable).
interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function envAddress(string calldata name) external view returns (address value);
    function envOr(string calldata name, address defaultValue) external view returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
    function roll(uint256 newHeight) external;
    function warp(uint256 newTimestamp) external;
    function label(address account, string calldata newLabel) external;
}
