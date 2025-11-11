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

    /// @dev The offset of a single token address (20) and pool fee (3)
    uint256 internal constant NEXT_V3_POOL_OFFSET = ADDR_SIZE + V3_FEE_SIZE;

    /// @dev The offset of an encoded pool key
    /// Token (20) + Fee (3) + Token (20) = 43
    uint256 internal constant V3_POP_OFFSET = NEXT_V3_POOL_OFFSET + ADDR_SIZE;

    /// @dev The minimum length of an encoding that contains 2 or more pools
    uint256 internal constant MULTIPLE_V3_POOLS_MIN_LENGTH = V3_POP_OFFSET + NEXT_V3_POOL_OFFSET;

    /// @dev The length of the action flag (1 byte)
    uint256 internal constant ACTION_FLAG_SIZE = 1;

    /// @dev The length of the vault address (20 bytes) - used for vault address in WRAP/UNWRAP
    uint256 internal constant VAULT_ADDRESS_SIZE = 20;

    /// @dev The offset to the action flag (after first token address)
    uint256 internal constant INTEGRAL_ACTION_FLAG_OFFSET = ADDR_SIZE;

    /// @dev The offset to the vault address (after action flag)
    uint256 internal constant INTEGRAL_VAULT_ADDRESS_OFFSET = INTEGRAL_ACTION_FLAG_OFFSET + ACTION_FLAG_SIZE;

    /// @dev The offset to the pool deployer address (after vault address)
    uint256 internal constant INTEGRAL_DEPLOYER_OFFSET = INTEGRAL_VAULT_ADDRESS_OFFSET + VAULT_ADDRESS_SIZE;

    /// @dev The offset to skip to next segment
    /// Token (20) + Flag (1) + Vault (20) + Deployer (20) = 61
    uint256 internal constant INTEGRAL_NEXT_OFFSET = ADDR_SIZE + ACTION_FLAG_SIZE + VAULT_ADDRESS_SIZE + ADDR_SIZE;

    /// @dev The offset of an encoded pool segment (includes second token)
    /// Token (20) + Flag (1) + Aux (20) + Deployer (20) + Token (20) = 81
    uint256 internal constant INTEGRAL_POP_OFFSET = INTEGRAL_NEXT_OFFSET + ADDR_SIZE;

    /// @dev The minimum length of an encoding that contains 2 or more pools
    /// First segment (81) + second segment start (61) = 142
    uint256 internal constant INTEGRAL_MULTIPLE_POOLS_MIN_LENGTH = INTEGRAL_POP_OFFSET + INTEGRAL_NEXT_OFFSET;
}
