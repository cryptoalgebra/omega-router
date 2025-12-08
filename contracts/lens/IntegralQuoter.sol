// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IntegralPath} from '../modules/algebra/integral/IntegralPath.sol';
import {SafeCast} from '@cryptoalgebra/integral-core/contracts/libraries/SafeCast.sol';
import {CalldataDecoder} from '../libraries/CalldataDecoder.sol';
import {IAlgebraPool} from '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import {IAlgebraSwapCallback} from '@cryptoalgebra/integral-core/contracts/interfaces/callback/IAlgebraSwapCallback.sol';
import {Constants} from '../libraries/Constants.sol';
import {AlgebraImmutables} from '../modules/algebra/AlgebraImmutables.sol';

/// @title Quoter for Algebra Integral swaps
/// @notice Allows getting the expected amount out or amount in for a given swap without executing the swap
/// @dev These functions are not gas efficient and should _not_ be called on chain. Instead, optimistically execute
/// the swap and check the amounts in the callback.
abstract contract IntegralQuoter is AlgebraImmutables, IAlgebraSwapCallback {
    using IntegralPath for bytes;
    using CalldataDecoder for bytes;
    using SafeCast for uint256;
    using SafeCast for int256;

    /// @dev Transient storage variable used to check a safety condition in exact output swaps.
    uint256 private amountOutCached;

    /// @inheritdoc IAlgebraSwapCallback
    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external view override {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        
        bytes calldata path = data.toBytes(0);
        (address tokenIn, address deployer, address tokenOut) = path.decodeFirstPool();
        
        // Verify callback is from pool
        require(msg.sender == _computePoolAddress(tokenIn, deployer, tokenOut), 'Invalid pool');

        (bool isExactInput, uint256 amountToPay, uint256 amountReceived) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta), uint256(-amount1Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta), uint256(-amount0Delta));

        IAlgebraPool pool = IAlgebraPool(msg.sender);
        (uint160 sqrtPriceX96After,,,,, ) = pool.globalState();

        if (isExactInput) {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountReceived)
                mstore(add(ptr, 0x20), sqrtPriceX96After)
                revert(ptr, 64)
            }
        } else {
            // Check that the pool's price hasn't moved unexpectedly due to a lack of liquidity
            if (amountOutCached != 0) require(amountReceived == amountOutCached);
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountToPay)
                mstore(add(ptr, 0x20), sqrtPriceX96After)
                revert(ptr, 64)
            }
        }
    }

    /// @notice Returns the amount out received for a given exact input swap without executing the swap
    /// @param path The path of the swap, i.e. each token pair and the deployer
    /// @param amountIn The amount of the first token to swap
    /// @return amountOut The amount of the last token that would be received
    /// @return sqrtPriceX96AfterList List of the sqrt price after the swap for each pool in the path
    /// @return gasEstimate The estimate of the gas that the swap consumes
    function integralQuoteExactInput(bytes calldata path, uint256 amountIn)
        internal
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint256 gasEstimate
        )
    {
        sqrtPriceX96AfterList = new uint160[](path.numPools());

        uint256 i = 0;
        while (true) {
            (address tokenIn, address deployer, address tokenOut) = path.decodeFirstPool();
            bool hasMultiplePools = path.hasMultiplePools();

            uint256 gasBefore = gasleft();
            (uint256 amountOut_, uint160 sqrtPriceX96After) =
                _quoteExactInputSingle(tokenIn, deployer, tokenOut, amountIn, 0);
            gasEstimate += gasBefore - gasleft();
            
            sqrtPriceX96AfterList[i] = sqrtPriceX96After;
            amountIn = amountOut_;
            i++;

            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }

    /// @notice Returns the amount in required for a given exact output swap without executing the swap
    /// @param path The path of the swap, i.e. each token pair and the deployer. Path must be provided in reverse order
    /// @param amountOut The amount of the last token to receive
    /// @return amountIn The amount of first token required to be paid
    /// @return sqrtPriceX96AfterList List of the sqrt price after the swap for each pool in the path
    /// @return gasEstimate The estimate of the gas that the swap consumes
    function integralQuoteExactOutput(bytes calldata path, uint256 amountOut)
        internal
        returns (
            uint256 amountIn,
            uint160[] memory sqrtPriceX96AfterList,
            uint256 gasEstimate
        )
    {
        sqrtPriceX96AfterList = new uint160[](path.numPools());

        uint256 i = 0;
        while (true) {
            (address tokenOut, address deployer, address tokenIn) = path.decodeFirstPool();
            bool hasMultiplePools = path.hasMultiplePools();

            uint256 gasBefore = gasleft();
            (uint256 amountIn_, uint160 sqrtPriceX96After) =
                _quoteExactOutputSingle(tokenIn, deployer, tokenOut, amountOut, 0);
            gasEstimate += gasBefore - gasleft();

            sqrtPriceX96AfterList[i] = sqrtPriceX96After;
            amountOut = amountIn_;
            i++;

            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                amountIn = amountOut;
                break;
            }
        }
    }

    /// @dev Quotes an exact input swap on a pool
    function _quoteExactInputSingle(
        address tokenIn,
        address deployer,
        address tokenOut,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) private returns (uint256 amountOut, uint160 sqrtPriceX96After) {
        bool zeroForOne = tokenIn < tokenOut;

        try IAlgebraPool(_computePoolAddress(tokenIn, deployer, tokenOut)).swap(
            address(this), // recipient
            zeroForOne,
            amountIn.toInt256(),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? Constants.MIN_SQRT_RATIO + 1 : Constants.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(tokenIn, deployer, tokenOut)
        ) {} catch (bytes memory reason) {
            return _integralParseRevertReason(reason);
        }
    }

    /// @dev Quotes an exact output swap on a pool
    function _quoteExactOutputSingle(
        address tokenIn,
        address deployer,
        address tokenOut,
        uint256 amountOut,
        uint160 sqrtPriceLimitX96
    ) private returns (uint256 amountIn, uint160 sqrtPriceX96After) {
        bool zeroForOne = tokenIn < tokenOut;

        // if no price limit has been specified, cache the output amount for comparison in the swap callback
        if (sqrtPriceLimitX96 == 0) amountOutCached = amountOut;
        
        try IAlgebraPool(_computePoolAddress(tokenIn, deployer, tokenOut)).swap(
            address(this), // recipient
            zeroForOne,
            -amountOut.toInt256(),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? Constants.MIN_SQRT_RATIO + 1 : Constants.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(tokenOut, deployer, tokenIn)
        ) {} catch (bytes memory reason) {
            if (sqrtPriceLimitX96 == 0) delete amountOutCached;
            return _integralParseRevertReason(reason);
        }
    }

    /// @dev Parses the quote from the revert reason
    /// @param reason The revert reason from the failed quote
    /// @return amount The amount from the quote
    /// @return sqrtPriceX96After The sqrt price after the swap
    function _integralParseRevertReason(bytes memory reason)
        private
        pure
        returns (uint256 amount, uint160 sqrtPriceX96After)
    {
        if (reason.length != 64) {
            if (reason.length < 68) revert('Unexpected error');
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        return abi.decode(reason, (uint256, uint160));
    }

    /// @notice Computes the pool address for a given token pair, deployer
    function _computePoolAddress(address tokenA, address deployer, address tokenB) private view returns (address pool) {
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
