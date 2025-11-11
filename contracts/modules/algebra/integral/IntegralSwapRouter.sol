// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IntegralPath} from './IntegralPath.sol';
import {IntegralBytesLib} from './IntegralBytesLib.sol';
import {ActionFlags} from '../../../libraries/ActionFlags.sol';
import {SafeCast} from '@cryptoalgebra/integral-core/contracts/libraries/SafeCast.sol';
import {IAlgebraPool} from '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import {IAlgebraSwapCallback} from '@cryptoalgebra/integral-core/contracts/interfaces/callback/IAlgebraSwapCallback.sol';
import {IERC4626} from '@openzeppelin/contracts/interfaces/IERC4626.sol';
import {ActionConstants} from '../../../libraries/ActionConstants.sol';
import {CalldataDecoder} from '../../../libraries/CalldataDecoder.sol';
import {Constants} from '../../../libraries/Constants.sol';
import {Permit2Payments} from '../../Permit2Payments.sol';
import {AlgebraImmutables} from '../AlgebraImmutables.sol';
import {MaxInputAmount} from '../../../libraries/MaxInputAmount.sol';
import {ERC20} from 'solmate/src/tokens/ERC20.sol';

/// @title Router for Algebra Integral Swaps
abstract contract IntegralSwapRouter is AlgebraImmutables, Permit2Payments, IAlgebraSwapCallback {
    using IntegralPath for bytes;
    using IntegralBytesLib for bytes;
    using CalldataDecoder for bytes;
    using SafeCast for uint256;

    error IntegralInvalidSwap();
    error IntegralTooLittleReceived();
    error IntegralTooMuchRequested();
    error IntegralInvalidAmountOut();
    error IntegralInvalidCaller();

    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (amount0Delta <= 0 && amount1Delta <= 0) revert IntegralInvalidSwap(); // swaps entirely within 0-liquidity regions are not supported
        (, address payer) = abi.decode(data, (bytes, address));
        bytes calldata path = data.toBytes(0);

        // Decode with new format (vaultAddress not used in callback, handled before swap)
        (address tokenIn,,, address deployer, address tokenOut) = path.decodeFirstPoolWithVault();

        // For pool address computation, use actual tokens that will be swapped
        // (not the wrapped/unwrapped versions - those are handled before swap call)
        if (computePoolAddress(tokenIn, deployer, tokenOut) != msg.sender) revert IntegralInvalidCaller();

        (bool isExactInput, uint256 amountToPay) =
            amount0Delta > 0 ? (tokenIn < tokenOut, uint256(amount0Delta)) : (tokenOut < tokenIn, uint256(amount1Delta));

        if (isExactInput) {
            // Pay the pool (msg.sender)
            payOrPermit2Transfer(tokenIn, payer, msg.sender, amountToPay);
        } else {
            // either initiate the next swap or pay
            if (path.hasMultiplePools()) {
                // this is an intermediate step so the payer is actually this contract
                path = path.skipToken();
                _integralSwap(-amountToPay.toInt256(), msg.sender, path, payer, false);
            } else {
                if (amountToPay > MaxInputAmount.get()) revert IntegralTooMuchRequested();
                // note that because exact output swaps are executed in reverse order, tokenOut is actually tokenIn
                payOrPermit2Transfer(tokenOut, payer, msg.sender, amountToPay);
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

            // Decode segment with action flag and vault address
            (address tokenIn, uint8 flag, address vaultAddress,,) = path.decodeFirstPoolWithVault();

            address actualTokenIn = tokenIn;
            uint256 actualAmountIn = amountIn;

            // Handle WRAP: convert underlying to vault shares before swap
            if (ActionFlags.isWrap(flag)) {
                // vaultAddress is the vault address
                // Transfer underlying token to this contract if needed
                if (payer != address(this)) {
                    payOrPermit2Transfer(tokenIn, payer, address(this), amountIn);
                    payer = address(this);
                }

                // Approve vault to spend underlying
                ERC20(tokenIn).approve(vaultAddress, amountIn);

                // Deposit underlying and get vault shares
                actualAmountIn = IERC4626(vaultAddress).deposit(amountIn, address(this));
                actualTokenIn = vaultAddress; // vault token becomes input for pool
            } else if (ActionFlags.isUnwrap(flag)) {
                // Handle UNWRAP: convert vault shares to underlying before swap
                // Transfer vault tokens to this contract if needed
                if (payer != address(this)) {
                    payOrPermit2Transfer(tokenIn, payer, address(this), amountIn);
                    payer = address(this);
                }

                // Redeem vault shares for underlying
                actualAmountIn = IERC4626(vaultAddress).redeem(amountIn, address(this), address(this));
                actualTokenIn = IERC4626(vaultAddress).asset(); // underlying token becomes input for pool
            }

            // the outputs of prior swaps become the inputs to subsequent ones
            (int256 amount0Delta, int256 amount1Delta, bool zeroForOne) = _integralSwap(
                actualAmountIn.toInt256(),
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

        if (amountOutReceived != amountOut) revert IntegralInvalidAmountOut();

        MaxInputAmount.set(0);
    }

    /// @dev Performs a single swap for both exactIn and exactOut
    /// For exactIn, `amount` is `amountIn`. For exactOut, `amount` is `-amountOut`
    function _integralSwap(int256 amount, address recipient, bytes calldata path, address payer, bool isExactIn)
        private
        returns (int256 amount0Delta, int256 amount1Delta, bool zeroForOne)
    {
        (address tokenIn, uint8 flag, address vaultAddress, address deployer, address tokenOut) =
            path.decodeFirstPoolWithVault();

        // Determine actual pool tokens based on action flag
        address actualTokenIn = tokenIn;
        address actualTokenOut = tokenOut;

        if (ActionFlags.isWrap(flag)) {
            // When wrapping, pool input is vault token (vaultAddress)
            actualTokenIn = vaultAddress;
        } else if (ActionFlags.isUnwrap(flag)) {
            // When unwrapping, actualTokenIn is underlying (from vault.asset())
            actualTokenIn = IERC4626(vaultAddress).asset();
        }

        zeroForOne = isExactIn ? actualTokenIn < actualTokenOut : actualTokenOut < actualTokenIn;

        (amount0Delta, amount1Delta) = IAlgebraPool(computePoolAddress(actualTokenIn, deployer, actualTokenOut)).swap(
            recipient,
            zeroForOne,
            amount,
            (zeroForOne ? Constants.MIN_SQRT_RATIO + 1 : Constants.MAX_SQRT_RATIO - 1),
            abi.encode(path, payer)
        );
    }

    /// @notice Deterministically computes the pool address given the poolDeployer and PoolKey
    function computePoolAddress(address tokenA, address deployer, address tokenB)
        internal
        view
        returns (address pool)
    {
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
