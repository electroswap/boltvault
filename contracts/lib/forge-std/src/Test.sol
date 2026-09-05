// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {Vm} from "./Vm.sol";

/// @dev Minimal Test base (vendored, see Vm.sol). Assertions revert, which Foundry reports as a failure.
abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "assertTrue failed");
    }

    function assertTrue(bool condition, string memory err) internal pure {
        require(condition, err);
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertFalse failed");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq(uint256) failed");
    }

    function assertEq(uint256 a, uint256 b, string memory err) internal pure {
        require(a == b, err);
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "assertEq(address) failed");
    }

    function assertEq(bool a, bool b) internal pure {
        require(a == b, "assertEq(bool) failed");
    }

    function assertEq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "assertEq(bytes32) failed");
    }

    function assertGt(uint256 a, uint256 b) internal pure {
        require(a > b, "assertGt failed");
    }

    function assertGe(uint256 a, uint256 b) internal pure {
        require(a >= b, "assertGe failed");
    }

    function assertLt(uint256 a, uint256 b) internal pure {
        require(a < b, "assertLt failed");
    }

    function assertLe(uint256 a, uint256 b) internal pure {
        require(a <= b, "assertLe failed");
    }

    function assertApproxEqAbs(uint256 a, uint256 b, uint256 maxDelta) internal pure {
        uint256 delta = a > b ? a - b : b - a;
        require(delta <= maxDelta, "assertApproxEqAbs failed");
    }
}
