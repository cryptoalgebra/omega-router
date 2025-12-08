// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {IntegralQuoter} from './IntegralQuoter.sol';
import {V3Quoter} from './V3Quoter.sol';
import {V2Quoter} from './V2Quoter.sol';
import {ERC4626Quoter} from './ERC4626Quoter.sol';
import {IntegralBytesLib} from '../modules/algebra/integral/IntegralBytesLib.sol';
import {Commands} from '../libraries/Commands.sol';
import {CalldataDecoder} from '../libraries/CalldataDecoder.sol';
import {ActionConstants} from '../libraries/ActionConstants.sol';

/// @title Decodes and Executes Quote Commands
/// @notice Provides quotes for swaps without executing them
abstract contract QuoterDispatcher is
    IntegralQuoter,
    V3Quoter,
    V2Quoter,
    ERC4626Quoter
{
    using IntegralBytesLib for bytes;
    using CalldataDecoder for bytes;

    uint256 internal amountOutCached;

    error InvalidCommandType(uint256 commandType);

    /// @notice Executes encoded commands along with provided inputs and returns quote results
    /// @param commands A set of concatenated commands, each 1 byte in length
    /// @param inputs An array of byte strings containing abi encoded inputs for each command
    /// @return outputs An array of byte strings containing abi encoded quote results for each command
    function execute(bytes calldata commands, bytes[] calldata inputs) external virtual returns (bytes[] memory outputs);

    /// @notice Decodes and executes the given command with the given inputs
    /// @param commandType The command type to execute
    /// @param inputs The inputs to execute the command with
    /// @return success True on success of the command, false on failure
    /// @return output The outputs (encoded quote data) from the command
    function dispatch(bytes1 commandType, bytes calldata inputs) internal returns (bool success, bytes memory output) {
        uint256 command = uint8(commandType & Commands.COMMAND_TYPE_MASK);

        success = true;

        if (command == Commands.INTEGRAL_SWAP_EXACT_IN) {
            // abi.decode(inputs, (uint256, bytes))
            uint256 amountIn;
            assembly {
                amountIn := calldataload(inputs.offset)
                // 0x20 offset is the path, decoded below
            }
            if (amountIn == ActionConstants.CONTRACT_BALANCE) {
                amountIn = amountOutCached;
            }
            bytes calldata path = inputs.toBytes(1);
            (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint256 gasEstimate) = 
                integralQuoteExactInput(path, amountIn);
            amountOutCached = amountOut;
            output = abi.encode(amountOut, sqrtPriceX96AfterList, gasEstimate);
            
        } else if (command == Commands.INTEGRAL_SWAP_EXACT_OUT) {
            // abi.decode(inputs, (uint256, bytes))
            uint256 amountOut;
            assembly {
                amountOut := calldataload(inputs.offset)
                // 0x20 offset is the path, decoded below
            }
            bytes calldata path = inputs.toBytes(1);
            (uint256 amountIn, uint160[] memory sqrtPriceX96AfterList, uint256 gasEstimate) = 
                integralQuoteExactOutput(path, amountOut);
            amountOutCached = amountOut;
            output = abi.encode(amountIn, sqrtPriceX96AfterList, gasEstimate);
            
        } else if (command == Commands.V2_SWAP_EXACT_IN) {
            // abi.decode(inputs, (uint256, address[]))
            uint256 amountIn;
            assembly {
                amountIn := calldataload(inputs.offset)
                // 0x20 offset is the path array, decoded below
            }
            if (amountIn == ActionConstants.CONTRACT_BALANCE) {
                amountIn = amountOutCached;
            }
            address[] calldata path = inputs.toAddressArray(1);
            uint256 amountOut = v2QuoteExactInput(amountIn, path);
            amountOutCached = amountOut;
            output = abi.encode(amountOut);
            
        } else if (command == Commands.V2_SWAP_EXACT_OUT) {
            // abi.decode(inputs, (uint256, address[]))
            uint256 amountOut;
            assembly {
                amountOut := calldataload(inputs.offset)
                // 0x20 offset is the path array, decoded below
            }
            address[] calldata path = inputs.toAddressArray(1);
            uint256 amountIn = v2QuoteExactOutput(amountOut, path);
            amountOutCached = amountOut;
            output = abi.encode(amountIn);
            
        } else if (command == Commands.UNISWAP_V3_SWAP_EXACT_IN) {
            // abi.decode(inputs, (uint256, bytes))
            uint256 amountIn;
            assembly {
                amountIn := calldataload(inputs.offset)
                // 0x20 offset is the path, decoded below
            }
            if (amountIn == ActionConstants.CONTRACT_BALANCE) {
                amountIn = amountOutCached;
            }
            bytes calldata path = inputs.toBytes(1);
            (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint256 gasEstimate) = 
                v3QuoteExactInput(path, amountIn);
            amountOutCached = amountOut;
            output = abi.encode(amountOut, sqrtPriceX96AfterList, gasEstimate);
            
        } else if (command == Commands.UNISWAP_V3_SWAP_EXACT_OUT) {
            // abi.decode(inputs, (uint256, bytes))
            uint256 amountOut;
            assembly {
                amountOut := calldataload(inputs.offset)
                // 0x20 offset is the path, decoded below
            }
            bytes calldata path = inputs.toBytes(1);
            (uint256 amountIn, uint160[] memory sqrtPriceX96AfterList, uint256 gasEstimate) = 
                v3QuoteExactOutput(path, amountOut);
            amountOutCached = amountOut;
            output = abi.encode(amountIn, sqrtPriceX96AfterList, gasEstimate);
            
        } else if (command == Commands.ERC4626_WRAP) {
            // abi.decode(inputs, (address, uint256))
            address wrapper;
            uint256 amountIn;
            assembly {
                wrapper := calldataload(inputs.offset)
                amountIn := calldataload(add(inputs.offset, 0x20))
            }
            if (amountIn == ActionConstants.CONTRACT_BALANCE) {
                amountIn = amountOutCached;
            }
            uint256 amountOut = erc4626QuoteWrap(wrapper, amountIn);
            amountOutCached = amountOut;
            output = abi.encode(amountOut);
            
        } else if (command == Commands.ERC4626_UNWRAP) {
            // abi.decode(inputs, (address, uint256))
            address wrapper;
            uint256 amountIn;
            assembly {
                wrapper := calldataload(inputs.offset)
                amountIn := calldataload(add(inputs.offset, 0x20))
            }
            if (amountIn == ActionConstants.CONTRACT_BALANCE) {
                amountIn = amountOutCached;
            }
            uint256 amountOut = erc4626QuoteUnwrap(wrapper, amountIn);
            amountOutCached = amountOut;
            output = abi.encode(amountOut);
            
        } else if (command == Commands.EXECUTE_SUB_PLAN) {
            (bytes calldata _commands, bytes[] calldata _inputs) = inputs.decodeActionsRouterParams();
            (success, output) = (address(this)).call(abi.encodeCall(QuoterDispatcher.execute, (_commands, _inputs)));
            
        } else {
            revert InvalidCommandType(command);
        }
    }
}
