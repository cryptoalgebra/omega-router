// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC4626} from '@openzeppelin/contracts/interfaces/IERC4626.sol';
import {ActionConstants} from '../libraries/ActionConstants.sol';

/// @title ERC4626 utility module for wrapping and unwrapping
abstract contract ERC4626WrapUnwrap {
    using SafeERC20 for IERC20;

    error ERC4626TooLittleReceived();

    /// @notice Wraps underlying tokens into an ERC4626 wrapper contract.
    /// @param wrapper The address of the ERC4626 wrapper contract.
    /// @param underlyingToken The address of the underlying token.
    /// @param receiver The address which will receive wrapped tokens.
    /// @param amountIn The amount of underlying tokens to wrap.
    /// @param minAmountOut The minimum amount of wrapped tokens to receive.
    /// @return amountOut The amount of wrapped tokens received.
    function erc4626Wrap(
        address wrapper,
        address underlyingToken,
        address receiver,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal virtual returns (uint256 amountOut) {
        // use amountIn == ActionConstants.CONTRACT_BALANCE as a flag to wrap the entire balance of the contract
        if (amountIn == ActionConstants.CONTRACT_BALANCE) {
            amountIn = IERC20(underlyingToken).balanceOf(address(this));
        }

        IERC20(underlyingToken).forceApprove(wrapper, amountIn);
        amountOut = IERC4626(wrapper).deposit(amountIn, receiver);

        if (amountOut < minAmountOut) revert ERC4626TooLittleReceived();
    }

    /// @notice Unwraps wrapped tokens from an ERC4626 wrapper contract.
    /// @param wrapper The address of the ERC4626 wrapper contract.
    /// @param receiver The address which will receive underlying tokens.
    /// @param amountIn The amount of wrapped tokens to unwrap.
    /// @param minAmountOut The minimum amount of underlying tokens to receive.
    /// @return amountOut The amount of underlying tokens received.
    function erc4626Unwrap(address wrapper, address receiver, uint256 amountIn, uint256 minAmountOut)
        internal
        virtual
        returns (uint256 amountOut)
    {
        // use amountIn == ActionConstants.CONTRACT_BALANCE as a flag to wrap the entire balance of the contract
        if (amountIn == ActionConstants.CONTRACT_BALANCE) {
            amountIn = IERC20(wrapper).balanceOf(address(this));
        }

        amountOut = IERC4626(wrapper).redeem(amountIn, receiver, address(this));
        if (amountOut < minAmountOut) revert ERC4626TooLittleReceived();
    }
}
