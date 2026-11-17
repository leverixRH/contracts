// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title IndexPerpSandbox
/// @notice Educational, fully reserved test-token long/short settlement on operator-set DEMO prices.
/// @dev NOT a production perpetual exchange: no funding, licensed oracle, orderbook or real index exposure.
///      PnL is deliberately capped between -100% and +100% of initial margin. No reserve withdrawal exists.
contract IndexPerpSandbox is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PRICE_AGE = 15 minutes;
    uint256 public constant STALE_CANCEL_DELAY = 1 days;
    uint256 public constant MIN_MARGIN = 1e6;
    uint256 public constant MAX_MARGIN = 10_000 * 1e6;
    uint8 public constant MAX_LEVERAGE = 20;
    uint256 public constant MAX_MARKETS_PER_UPDATE = 64;
    uint256 public constant PRICE_SCALE = 1e8;
    uint256 public constant MAX_PRICE = 1e18;
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint16 public constant LIQUIDATION_LOSS_BPS = 9_000;

    IERC20 public immutable collateralToken;
    uint256 public freeLiquidity;
    uint256 public reservedLiquidity;
    uint256 public totalUserCollateral;
    uint256 public nextPositionId = 1;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public lockedCollateral;

    struct Market { uint128 price; uint64 updatedAt; bool enabled; }
    struct Position {
        address trader;
        bytes32 marketId;
        uint128 margin;
        uint128 entryPrice;
        uint64 openedAt;
        uint8 leverage;
        bool isLong;
        bool isOpen;
    }
    mapping(bytes32 => Market) public markets;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) private accountPositions;

    error InvalidMarket();
    error InvalidPrice();
    error StalePrice();
    error InvalidAmount();
    error InvalidLeverage();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error PositionUnavailable();
    error NotPositionOwner();
    error SlippageExceeded();
    error NotLiquidatable();
    error OracleStillLive();
    error InvalidBatch();

    event DemoPriceUpdated(bytes32 indexed marketId, uint256 price, uint256 updatedAt);
    event MarketStatusChanged(bytes32 indexed marketId, bool enabled);
    event LiquidityFunded(address indexed provider, uint256 amount);
    event Deposited(address indexed trader, uint256 amount);
    event Withdrawn(address indexed trader, uint256 amount);
    event PositionOpened(uint256 indexed id, address indexed trader, bytes32 indexed marketId,
        bool isLong, uint256 margin, uint8 leverage, uint256 entryPrice);
    event PositionClosed(uint256 indexed id, address indexed trader, int256 pnl,
        uint256 exitPrice, uint256 payout, bool liquidated);
    event StalePositionCancelled(uint256 indexed id, address indexed trader, uint256 returnedMargin);

    constructor(address token, address initialOwner) Ownable(initialOwner) {
        if (token == address(0) || token.code.length == 0) revert InvalidAmount();
        collateralToken = IERC20(token);
    }

    /// @notice Owner is a centralized DEMO-price publisher, not an independent oracle.
    function setDemoPrice(bytes32 marketId, uint128 price) external onlyOwner {
        _setDemoPrice(marketId, price);
    }

    /// @notice Atomically refresh a bounded batch of synthetic demo markets.
    function setDemoPrices(bytes32[] calldata marketIds, uint128[] calldata prices) external onlyOwner {
        uint256 count = marketIds.length;
        if (count == 0 || count != prices.length || count > MAX_MARKETS_PER_UPDATE) revert InvalidBatch();
        for (uint256 i; i < count; ++i) _setDemoPrice(marketIds[i], prices[i]);
    }

    function _setDemoPrice(bytes32 marketId, uint128 price) private {
        if (marketId == bytes32(0)) revert InvalidMarket();
        if (price == 0 || price > MAX_PRICE) revert InvalidPrice();
        Market storage market = markets[marketId];
        if (market.updatedAt == 0) market.enabled = true;
        market.price = price;
        market.updatedAt = uint64(block.timestamp);
        emit DemoPriceUpdated(marketId, price, block.timestamp);
    }

    function setMarketEnabled(bytes32 marketId, bool enabled) external onlyOwner {
        if (markets[marketId].updatedAt == 0) revert InvalidMarket();
        markets[marketId].enabled = enabled;
        emit MarketStatusChanged(marketId, enabled);
    }

    function setPaused(bool value) external onlyOwner {
        if (value) _pause(); else _unpause();
    }

    /// @notice Irrevocable test-token contribution; no LP receipt or financial return.
    function fundLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        freeLiquidity += amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit LiquidityFunded(msg.sender, amount);
    }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        balances[msg.sender] += amount;
        totalUserCollateral += amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Available collateral can always be withdrawn, including while paused.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        totalUserCollateral -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function openPosition(bytes32 marketId, bool isLong, uint256 margin, uint8 leverage,
        uint256 expectedPrice, uint16 slippageBps) external whenNotPaused returns (uint256 id) {
        Market memory market = markets[marketId];
        if (!market.enabled) revert InvalidMarket();
        _fresh(market);
        _slippage(market.price, expectedPrice, slippageBps);
        if (margin < MIN_MARGIN || margin > MAX_MARGIN) revert InvalidAmount();
        if (leverage == 0 || leverage > MAX_LEVERAGE) revert InvalidLeverage();
        if (balances[msg.sender] < margin) revert InsufficientBalance();
        if (freeLiquidity < margin) revert InsufficientLiquidity();
        balances[msg.sender] -= margin;
        lockedCollateral[msg.sender] += margin;
        freeLiquidity -= margin;
        reservedLiquidity += margin;
        id = nextPositionId++;
        positions[id] = Position(msg.sender, marketId, uint128(margin), market.price,
            uint64(block.timestamp), leverage, isLong, true);
        accountPositions[msg.sender].push(id);
        emit PositionOpened(id, msg.sender, marketId, isLong, margin, leverage, market.price);
    }

    function closePosition(uint256 id, uint256 expectedPrice, uint16 slippageBps) external {
        Position memory position = positions[id];
        if (!position.isOpen) revert PositionUnavailable();
        if (position.trader != msg.sender) revert NotPositionOwner();
        Market memory market = markets[position.marketId];
        _fresh(market);
        _slippage(market.price, expectedPrice, slippageBps);
        _settle(id, position, market.price, false);
    }

    /// @notice Anyone can settle a position after a 90% initial-margin loss; no keeper reward.
    function liquidate(uint256 id) external {
        Position memory position = positions[id];
        if (!position.isOpen) revert PositionUnavailable();
        Market memory market = markets[position.marketId];
        _fresh(market);
        int256 pnl = _pnl(position, market.price);
        if (pnl > -int256(uint256(position.margin) * LIQUIDATION_LOSS_BPS / 10_000)) revert NotLiquidatable();
        _settle(id, position, market.price, true);
    }

    /// @notice Demo-only escape: after 24h without an operator quote, return initial margin at zero PnL.
    /// @dev Provides liveness if this prototype's operator disappears. This is not a real perp settlement rule.
    function cancelStalePosition(uint256 id) external {
        Position memory position = positions[id];
        if (!position.isOpen) revert PositionUnavailable();
        if (position.trader != msg.sender) revert NotPositionOwner();
        if (block.timestamp <= uint256(markets[position.marketId].updatedAt) + STALE_CANCEL_DELAY) revert OracleStillLive();
        _settle(id, position, position.entryPrice, false);
        emit StalePositionCancelled(id, msg.sender, position.margin);
    }

    function previewPnl(uint256 id) external view returns (int256 pnl, uint256 payout, bool priceFresh) {
        Position memory position = positions[id];
        if (!position.isOpen) revert PositionUnavailable();
        Market memory market = markets[position.marketId];
        pnl = _pnl(position, market.price);
        payout = uint256(int256(uint256(position.margin)) + pnl);
        priceFresh = block.timestamp <= uint256(market.updatedAt) + MAX_PRICE_AGE;
    }

    function getPositionIds(address trader) external view returns (uint256[] memory) {
        return accountPositions[trader];
    }

    /// @notice Must be <= collateralToken.balanceOf(address(this)); excess direct donations are unaccounted.
    function accountedCollateral() external view returns (uint256) {
        return totalUserCollateral + freeLiquidity + reservedLiquidity;
    }

    function _settle(uint256 id, Position memory position, uint256 price, bool liquidated) private {
        int256 pnl = _pnl(position, price);
        uint256 margin = position.margin;
        uint256 payout = uint256(int256(margin) + pnl);
        positions[id].isOpen = false;
        lockedCollateral[position.trader] -= margin;
        balances[position.trader] += payout;
        reservedLiquidity -= margin;
        freeLiquidity += uint256(int256(margin) - pnl);
        if (pnl >= 0) totalUserCollateral += uint256(pnl);
        else totalUserCollateral -= uint256(-pnl);
        emit PositionClosed(id, position.trader, pnl, price, payout, liquidated);
    }

    function _pnl(Position memory position, uint256 price) private pure returns (int256 value) {
        int256 delta = int256(price) - int256(uint256(position.entryPrice));
        if (!position.isLong) delta = -delta;
        int256 margin = int256(uint256(position.margin));
        value = margin * int256(uint256(position.leverage)) * delta / int256(uint256(position.entryPrice));
        if (value > margin) value = margin;
        else if (value < -margin) value = -margin;
    }

    function _fresh(Market memory market) private view {
        if (market.price == 0) revert InvalidMarket();
        if (block.timestamp > uint256(market.updatedAt) + MAX_PRICE_AGE) revert StalePrice();
    }

    function _slippage(uint256 actual, uint256 expected, uint16 bps) private pure {
        if (expected == 0 || expected > MAX_PRICE || bps > MAX_SLIPPAGE_BPS) revert SlippageExceeded();
        uint256 difference = actual > expected ? actual - expected : expected - actual;
        if (difference * 10_000 > expected * bps) revert SlippageExceeded();
    }
}
