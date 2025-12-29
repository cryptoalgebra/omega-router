// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IERC4626} from '@openzeppelin/contracts/interfaces/IERC4626.sol';

/// @title ERC4626 Quoter
/// @notice Quotes wrap/unwrap operations for ERC4626 vaults
abstract contract ERC4626Quoter {
    /// @notice Quotes wrapping underlying tokens into an ERC4626 vault
    /// @param wrapper The address of the ERC4626 vault
    /// @param amountIn The amount of underlying tokens to wrap
    /// @return amountOut The amount of vault shares that would be received
    function erc4626QuoteWrap(address wrapper, uint256 amountIn) internal view returns (uint256 amountOut) {
        amountOut = IERC4626(wrapper).previewDeposit(amountIn);
    }

    /// @notice Quotes unwrapping vault shares to underlying tokens
    /// @param wrapper The address of the ERC4626 vault
    /// @param amountIn The amount of vault shares to unwrap
    /// @return amountOut The amount of underlying tokens that would be received
    function erc4626QuoteUnwrap(address wrapper, uint256 amountIn) internal view returns (uint256 amountOut) {
        amountOut = IERC4626(wrapper).previewRedeem(amountIn);
    }
}
