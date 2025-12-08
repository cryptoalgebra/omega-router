// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title WrapAction
/// @notice Enum for wrap/unwrap actions in boosted pool paths
enum WrapAction {
    NONE, // 0 - no wrap/unwrap needed
    WRAP, // 1 - deposit underlying token into ERC4626 vault
    UNWRAP // 2 - redeem wrapped token from ERC4626 vault
}
