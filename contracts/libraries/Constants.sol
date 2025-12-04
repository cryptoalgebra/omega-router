// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title Constant state
/// @notice Constant state used by the Omega Router
library Constants {
    /// @dev Used for identifying cases when a v2 pair has already received input tokens
    uint256 internal constant ALREADY_PAID = 0;

    /// @dev Used as a flag for identifying the transfer of ETH instead of a token
    address internal constant ETH = address(0);

    /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;

    /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev The length of the bytes encoded address
    uint256 internal constant ADDR_SIZE = 20;

    /// @dev The length of the bytes encoded fee
    uint256 internal constant V3_FEE_SIZE = 3;

    uint256 internal constant WRAP_FLAG = 1;

    /// @dev The offset of a single token address (20) and pool fee (3)
    uint256 internal constant NEXT_V3_POOL_OFFSET = ADDR_SIZE + V3_FEE_SIZE;

    /// @dev The offset of an encoded pool key
    /// Token (20) + Fee (3) + Token (20) = 43
    uint256 internal constant V3_POP_OFFSET = NEXT_V3_POOL_OFFSET + ADDR_SIZE;

    /// @dev The minimum length of an encoding that contains 2 or more pools
    uint256 internal constant MULTIPLE_V3_POOLS_MIN_LENGTH = V3_POP_OFFSET + NEXT_V3_POOL_OFFSET;

    /// @dev The offset of a custom pool deployer address
    uint256 internal constant INTEGRAL_DEPLOYER_OFFSET = ADDR_SIZE;

    /// @dev The offset of a single token address + deployer address
    uint256 internal constant INTEGRAL_NEXT_OFFSET = ADDR_SIZE + INTEGRAL_DEPLOYER_OFFSET;

    /// @dev The offset of an encoded pool key
    uint256 internal constant INTEGRAL_POP_OFFSET = INTEGRAL_NEXT_OFFSET + ADDR_SIZE;

    /// @dev The minimum length of an encoding that contains 2 or more pools
    uint256 internal constant INTEGRAL_MULTIPLE_POOLS_MIN_LENGTH = INTEGRAL_POP_OFFSET + INTEGRAL_NEXT_OFFSET;

    /// @dev The offset of a custom pool deployer address + pool tokens addresses + wrap flags
    uint256 internal constant INTEGRAL_BOOSTED_POOL_OFFSET = WRAP_FLAG + ADDR_SIZE + ADDR_SIZE + ADDR_SIZE + WRAP_FLAG;

    /// @dev The offset of a single token address + deployer address + pool tokens addresses + wrap flags
    uint256 internal constant INTEGRAL_BOOSTED_POOL_NEXT_OFFSET = ADDR_SIZE + INTEGRAL_BOOSTED_POOL_OFFSET;

    /// @dev The offset of an encoded pool key with boosted pools
    uint256 internal constant INTEGRAL_BOOSTED_POOL_POP_OFFSET = INTEGRAL_BOOSTED_POOL_NEXT_OFFSET + ADDR_SIZE;

    /// @dev The minimum length of an encoding that contains 2 or more pools
    uint256 internal constant INTEGRAL_MULTIPLE_BOOSTED_POOLS_MIN_LENGTH =
        INTEGRAL_BOOSTED_POOL_POP_OFFSET + INTEGRAL_BOOSTED_POOL_NEXT_OFFSET;
}
