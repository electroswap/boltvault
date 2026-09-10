// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title BoltVaultFeeSink
/// @notice Receives the in-wallet swap fee. Nothing but
///         receive and owner sweeps: the wallet pns this address and refuses
///         to swap when the encoded PAY_PORTION recipient differs. Ownership
///         is two-step so a typo cannot orphan the sink.
contract BoltVaultFeeSink {
    address public owner;
    address public pendingOwner;

    event Swept(address indexed token, address indexed to, uint256 amount);
    event SweptETN(address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    receive() external payable {}

    /// @notice Move `amount` of an ERC-20 fee balance to `to`. Tolerates tokens that return nothing.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        emit Swept(token, to, amount);
    }

    /// @notice Move `amount` of ETN to `to`.
    function sweepETN(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit SweptETN(to, amount);
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
