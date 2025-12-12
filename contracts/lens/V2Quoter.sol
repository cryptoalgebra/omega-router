// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {UniswapV2Library} from '../modules/uniswap/v2/UniswapV2Library.sol';
import {UniswapImmutables} from '../modules/uniswap/UniswapImmutables.sol';

/// @title Quoter for Uniswap v2
abstract contract V2Quoter is UniswapImmutables {
    /// @notice Quotes a Uniswap v2 exact input swap
    /// @param amountIn The amount of input tokens for the trade
    /// @param path The path of the trade as an array of token addresses
    /// @return amountOut The amount of output tokens that would be received
    function v2QuoteExactInput(uint256 amountIn, address[] calldata path) internal view returns (uint256 amountOut) {
        amountOut =
            UniswapV2Library.getAmountOutMultihop(UNISWAP_V2_FACTORY, UNISWAP_V2_PAIR_INIT_CODE_HASH, amountIn, path);
    }

    /// @notice Quotes a Uniswap v2 exact output swap
    /// @param amountOut The amount of output tokens to receive for the trade
    /// @param path The path of the trade as an array of token addresses
    /// @return amountIn The amount of input tokens needed
    function v2QuoteExactOutput(uint256 amountOut, address[] calldata path) internal view returns (uint256 amountIn) {
        (amountIn,) =
            UniswapV2Library.getAmountInMultihop(UNISWAP_V2_FACTORY, UNISWAP_V2_PAIR_INIT_CODE_HASH, amountOut, path);
    }
}
