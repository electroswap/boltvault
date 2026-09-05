// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {Vm} from "./Vm.sol";

/// @dev Foundry's console precompile (vendored subset).
library console2 {
    address internal constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;

    function _send(bytes memory payload) private view {
        address c = CONSOLE;
        assembly {
            pop(staticcall(gas(), c, add(payload, 32), mload(payload), 0, 0))
        }
    }

    function log(string memory s) internal view {
        _send(abi.encodeWithSignature("log(string)", s));
    }

    function log(string memory s, address a) internal view {
        _send(abi.encodeWithSignature("log(string,address)", s, a));
    }

    function log(string memory s, uint256 n) internal view {
        _send(abi.encodeWithSignature("log(string,uint256)", s, n));
    }
}

abstract contract Script {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bool public IS_SCRIPT = true;
}
