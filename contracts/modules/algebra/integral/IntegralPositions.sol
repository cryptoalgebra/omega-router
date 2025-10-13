// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {INonfungiblePositionManager} from
    '@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import {IERC721Permit} from '@cryptoalgebra/integral-periphery/contracts/interfaces/IERC721Permit.sol';
import {ActionConstants} from '../../../libraries/ActionConstants.sol';
import {Permit2Payments} from '../../Permit2Payments.sol';
import {AlgebraImmutables} from '../AlgebraImmutables.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

/// @title Module for actions with positions
/// @notice Unlike others, `mint` is performed explicitly via the interface
abstract contract IntegralPositions is AlgebraImmutables, Permit2Payments {
    using SafeERC20 for IERC20;

    error InvalidAction(bytes4 action);
    error NotAuthorizedForToken(uint256 tokenId);

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

    /// @dev check that a call is to the ERC721 permit function
    function _checkV3PermitCall(bytes calldata inputs) internal pure {
        bytes4 selector;
        assembly {
            selector := calldataload(inputs.offset)
        }

        if (selector != IERC721Permit.permit.selector) {
            revert InvalidAction(selector);
        }
    }

    /// @dev check that the v3 position manager call is a safe call
    function _checkV3PositionManagerCall(bytes calldata inputs, address caller) internal view {
        bytes4 selector;
        assembly {
            selector := calldataload(inputs.offset)
        }

        if (!_isValidAction(selector)) {
            revert InvalidAction(selector);
        }

        uint256 tokenId;
        assembly {
            // tokenId is always the first parameter in the valid actions
            tokenId := calldataload(add(inputs.offset, 0x04))
        }
        // If any other address that is not the owner wants to call this function, it also needs to be approved (in addition to this contract)
        // This can be done in 2 ways:
        //    1. This contract is permitted for the specific token and the caller is approved for ALL of the owner's tokens
        //    2. This contract is permitted for ALL of the owner's tokens and the caller is permitted for the specific token
        if (!_isAuthorizedForToken(caller, tokenId)) {
            revert NotAuthorizedForToken(tokenId);
        }
    }

    /// @dev validate if an action is decreaseLiquidity, collect, or burn
    function _isValidAction(bytes4 selector) private pure returns (bool) {
        return selector == INonfungiblePositionManager.decreaseLiquidity.selector
            || selector == INonfungiblePositionManager.collect.selector
            || selector == INonfungiblePositionManager.burn.selector;
    }

    /// @dev the caller is authorized for the token if its the owner, spender, or operator
    function _isAuthorizedForToken(address caller, uint256 tokenId) private view returns (bool) {
        address owner = INonfungiblePositionManager(ALGEBRA_INTEGRAL_POSITION_MANAGER).ownerOf(tokenId);
        return caller == owner
            || INonfungiblePositionManager(ALGEBRA_INTEGRAL_POSITION_MANAGER).getApproved(tokenId) == caller
            || INonfungiblePositionManager(ALGEBRA_INTEGRAL_POSITION_MANAGER).isApprovedForAll(owner, caller);
    }
}
