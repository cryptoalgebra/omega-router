// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IntegralPath} from './IntegralPath.sol';
import {IntegralBoostedPath} from './IntegralBoostedPath.sol';
import {IntegralBytesLib} from './IntegralBytesLib.sol';
import {SafeCast} from '@cryptoalgebra/integral-core/contracts/libraries/SafeCast.sol';
import {IAlgebraPool} from '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import {
    IAlgebraSwapCallback
} from '@cryptoalgebra/integral-core/contracts/interfaces/callback/IAlgebraSwapCallback.sol';
import {ActionConstants} from '../../../libraries/ActionConstants.sol';
import {WrapAction} from '../../../libraries/WrapAction.sol';
import {CalldataDecoder} from '../../../libraries/CalldataDecoder.sol';
import {Constants} from '../../../libraries/Constants.sol';
import {Permit2Payments} from '../../Permit2Payments.sol';
import {AlgebraImmutables} from '../AlgebraImmutables.sol';
import {MaxInputAmount} from '../../../libraries/MaxInputAmount.sol';
import {ERC20} from 'solmate/src/tokens/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC4626} from '@openzeppelin/contracts/interfaces/IERC4626.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

/// @title Router for Algebra Integral Swaps
abstract contract IntegralSwapRouter is AlgebraImmutables, Permit2Payments, IAlgebraSwapCallback {
    using IntegralPath for bytes;
    using IntegralBoostedPath for bytes;
    using IntegralBytesLib for bytes;
    using CalldataDecoder for bytes;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    error IntegralInvalidSwap();
    error IntegralTooLittleReceived();
    error IntegralTooMuchRequested();
    error IntegralInvalidAmountOut();
    error IntegralInvalidCaller();
    error IntegralInvalidBoostedPath();

    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (amount0Delta <= 0 && amount1Delta <= 0) revert IntegralInvalidSwap(); // swaps entirely within 0-liquidity regions are not supported
        (, address payer, bool isExactIn, address payTo) = abi.decode(data, (bytes, address, bool, address));
        bytes calldata path = data.toBytes(0);

        if (isExactIn) {
            (address tokenIn, address deployer, address tokenOut) = path.decodeFirstPool();
            if (computePoolAddress(tokenIn, deployer, tokenOut) != msg.sender) revert IntegralInvalidCaller();
            
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            payOrPermit2Transfer(tokenIn, payer, msg.sender, amountToPay);
            
        } else {
            // tokenOut | wrapOut | poolTokenOut | deployer | poolTokenIn | wrapIn | tokenIn
            (
                ,
                WrapAction wrapOut,
                address poolTokenOut,
                address deployer,
                address poolTokenIn,
                WrapAction wrapIn,
                address tokenIn
            ) = path.decodeFirstBoostedPool();

            // handle wrapOut - unwrap received vault tokens and send underlying to payTo (pool or recipient)
            if (wrapOut == WrapAction.UNWRAP) {
                uint256 vaultTokensReceived = amount0Delta < 0 ? uint256(-amount0Delta) : uint256(-amount1Delta);
                IERC4626(poolTokenOut).redeem(vaultTokensReceived, payTo, address(this));
            } else if (wrapOut == WrapAction.WRAP) {
                revert IntegralInvalidBoostedPath();
            }

            if (computePoolAddress(poolTokenOut, deployer, poolTokenIn) != msg.sender) revert IntegralInvalidCaller();

            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);

            if (path.hasMultipleBoostedPools()) {
                // Calculate how much we need for the next swap
                uint256 nextSwapAmount = amountToPay;
                if (wrapIn == WrapAction.WRAP) {
                    nextSwapAmount = IERC4626(poolTokenIn).previewMint(amountToPay);
                } else if (wrapIn == WrapAction.UNWRAP) {
                    // UNWRAP on input is invalid
                    revert IntegralInvalidBoostedPath();
                }
                
                bytes calldata nextPath = path.skipTokenInBoostedPath();
                
                // If no wrap needed, send directly to pool
                address nextRecipient = (wrapIn == WrapAction.NONE) ? msg.sender : address(this);
                _integralSwap(-nextSwapAmount.toInt256(), nextRecipient, nextPath, payer, false);
                
                // After swap completes, handle wrap if needed and pay to the pool
                if (wrapIn == WrapAction.WRAP) {
                    IERC20(tokenIn).forceApprove(poolTokenIn, nextSwapAmount);
                    IERC4626(poolTokenIn).mint(amountToPay, msg.sender);
                }
                // If wrapIn == NONE, tokens already sent directly to pool
            } else {
                // Last hop - pay from payer
                uint256 amountFromPayer = amountToPay;
                
                if (wrapIn == WrapAction.WRAP) {
                    // Wrap - payer sends underlying, router wraps and sends vault tokens to the pool
                    amountFromPayer = IERC4626(poolTokenIn).previewMint(amountToPay);
                    if (amountFromPayer > MaxInputAmount.get()) revert IntegralTooMuchRequested();
                    
                    payOrPermit2Transfer(tokenIn, payer, address(this), amountFromPayer);
                    IERC20(tokenIn).forceApprove(poolTokenIn, amountFromPayer);
                    IERC4626(poolTokenIn).mint(amountToPay, msg.sender);
                } else if (wrapIn == WrapAction.UNWRAP) {
                    // UNWRAP on input is invalid
                    revert IntegralInvalidBoostedPath();
                } else {
                    // No wrap - direct transfer
                    if (amountToPay > MaxInputAmount.get()) revert IntegralTooMuchRequested();
                    payOrPermit2Transfer(poolTokenIn, payer, msg.sender, amountToPay);
                }
            }
        }
    }

    /// @notice Performs an Algebra Integral exact input swap
    /// @param recipient The recipient of the output tokens
    /// @param amountIn The amount of input tokens for the trade
    /// @param amountOutMinimum The minimum desired amount of output tokens
    /// @param path The path of the trade as a bytes string
    /// @param payer The address that will be paying the input
    function integralSwapExactInput(
        address recipient,
        uint256 amountIn,
        uint256 amountOutMinimum,
        bytes calldata path,
        address payer
    ) internal {
        // use amountIn == ActionConstants.CONTRACT_BALANCE as a flag to swap the entire balance of the contract
        if (amountIn == ActionConstants.CONTRACT_BALANCE) {
            address tokenIn = path.decodeFirstToken();
            amountIn = ERC20(tokenIn).balanceOf(address(this));
        }

        uint256 amountOut;
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();

            // the outputs of prior swaps become the inputs to subsequent ones
            (int256 amount0Delta, int256 amount1Delta, bool zeroForOne) = _integralSwap(
                amountIn.toInt256(),
                hasMultiplePools ? address(this) : recipient, // for intermediate swaps, this contract custodies
                path.getFirstPool(), // only the first pool is needed
                payer, // for intermediate swaps, this contract custodies
                true
            );

            amountIn = uint256(-(zeroForOne ? amount1Delta : amount0Delta));

            // decide whether to continue or terminate
            if (hasMultiplePools) {
                payer = address(this);
                path = path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }

        if (amountOut < amountOutMinimum) revert IntegralTooLittleReceived();
    }

    /// @notice Performs an Algebra Integral exact output swap
    /// @param recipient The recipient of the output tokens
    /// @param amountOut The amount of output tokens to receive for the trade
    /// @param amountInMaximum The maximum desired amount of input tokens
    /// @param path The path of the trade as a bytes string
    /// @param payer The address that will be paying the input
    function integralSwapExactOutput(
        address recipient,
        uint256 amountOut,
        uint256 amountInMaximum,
        bytes calldata path,
        address payer
    ) internal {
        MaxInputAmount.set(amountInMaximum);
        (int256 amount0Delta, int256 amount1Delta, bool zeroForOne) =
            _integralSwap(-amountOut.toInt256(), recipient, path, payer, false);

        uint256 amountOutReceived = zeroForOne ? uint256(-amount1Delta) : uint256(-amount0Delta);
        
        (, WrapAction wrapOut, address poolTokenOut,,,, ) = path.decodeFirstBoostedPool();
        if (wrapOut == WrapAction.UNWRAP) {
            amountOutReceived = IERC4626(poolTokenOut).previewRedeem(amountOutReceived);
        }

        if (amountOutReceived != amountOut) revert IntegralInvalidAmountOut();
        MaxInputAmount.set(0);
    }

    /// @dev Performs a single swap for both exactIn and exactOut
    /// For exactIn, `amount` is `amountIn`. For exactOut, `amount` is `-amountOut`
    function _integralSwap(int256 amount, address recipient, bytes calldata path, address payer, bool isExactIn)
        private
        returns (int256 amount0Delta, int256 amount1Delta, bool zeroForOne)
    {
        address tokenIn;
        address tokenOut;
        address deployer;
        address payTo = recipient;

        if (isExactIn) {
            // tokenIn | deployer | tokenOut
            (tokenIn, deployer, tokenOut) = path.decodeFirstPool();
        } else {
            WrapAction wrapOut;
            uint256 amountOut = uint256(-amount);
            // tokenOut | wrapOut | poolTokenOut | deployer | poolTokenIn | wrapIn | tokenIn
            ( , wrapOut, tokenOut, deployer, tokenIn, ,) = path.decodeFirstBoostedPool();
            if (wrapOut == WrapAction.UNWRAP){
                amount = -(IERC4626(tokenOut).previewWithdraw(amountOut)).toInt256();
                recipient = address(this); 
            } else if (wrapOut == WrapAction.WRAP) {
                revert IntegralInvalidBoostedPath();
            }
        }

        zeroForOne = tokenIn < tokenOut;
        (amount0Delta, amount1Delta) = IAlgebraPool(computePoolAddress(tokenIn, deployer, tokenOut))
            .swap(
                recipient,
                zeroForOne,
                amount,
                (zeroForOne ? Constants.MIN_SQRT_RATIO + 1 : Constants.MAX_SQRT_RATIO - 1),
                abi.encode(path, payer, isExactIn, payTo)
            );
    }

    /// @notice Deterministically computes the pool address given the poolDeployer and PoolKey
    function computePoolAddress(address tokenA, address deployer, address tokenB) internal view returns (address pool) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex'ff',
                            ALGEBRA_INTEGRAL_POOL_DEPLOYER,
                            keccak256(
                                deployer == address(0)
                                    ? abi.encode(tokenA, tokenB)
                                    : abi.encode(deployer, tokenA, tokenB)
                            ),
                            ALGEBRA_INTEGRAL_POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }
}
