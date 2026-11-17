// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A permissionless faucet token with no cash value, backing or redemption.
/// @dev This is deliberately NOT USDG. Anyone may create multiple wallets to faucet.
contract DemoUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 * 1e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public nextFaucetAt;

    error FaucetCooldown(uint256 availableAt);
    event FaucetClaimed(address indexed account, uint256 amount);

    constructor() ERC20("QUIVANTA Demo USD", "dUSD") {
        _mint(msg.sender, 1_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function faucet() external {
        if (block.timestamp < nextFaucetAt[msg.sender]) revert FaucetCooldown(nextFaucetAt[msg.sender]);
        nextFaucetAt[msg.sender] = block.timestamp + FAUCET_COOLDOWN;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
