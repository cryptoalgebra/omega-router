// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {INonfungiblePositionManager} from
    '@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import {ActionConstants} from '../../../libraries/ActionConstants.sol';
import {Permit2Payments} from '../../Permit2Payments.sol';
import {AlgebraImmutables} from '../AlgebraImmutables.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

/// @title Module for actions with positions
/// @notice Unlike others, `mint` is performed explicitly via the interface
abstract contract IntegralPositions is AlgebraImmutables, Permit2Payments {
    using SafeERC20 for IERC20;

    /// @notice Performs an Algebra Integral mint operation via Nonfungible Position Manager
    /// @param params The params necessary to mint a position, encoded as `MintParams`
    function integralMint(INonfungiblePositionManager.MintParams memory params) internal {
        // use amountDesired == ActionConstants.CONTRACT_BALANCE as a flag to add liquidity using the entire balance of the contract
        if (params.amount0Desired == ActionConstants.CONTRACT_BALANCE) {
            params.amount0Desired = IERC20(params.token0).balanceOf(address(this));
        }
        if (params.amount1Desired == ActionConstants.CONTRACT_BALANCE) {
            params.amount1Desired = IERC20(params.token1).balanceOf(address(this));
        }

        if (params.amount0Desired > 0) {
            IERC20(params.token0).forceApprove(ALGEBRA_INTEGRAL_POSITION_MANAGER, params.amount0Desired);
        }
        if (params.amount1Desired > 0) {
            IERC20(params.token1).forceApprove(ALGEBRA_INTEGRAL_POSITION_MANAGER, params.amount1Desired);
        }

        INonfungiblePositionManager(ALGEBRA_INTEGRAL_POSITION_MANAGER).mint(params);
    }
}
