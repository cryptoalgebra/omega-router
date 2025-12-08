// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {QuoterDispatcher} from './QuoterDispatcher.sol';
import {RouterParameters} from '../types/RouterParameters.sol';
import {AlgebraImmutables, AlgebraParameters} from '../modules/algebra/AlgebraImmutables.sol';
import {UniswapImmutables, UniswapParameters} from '../modules/uniswap/UniswapImmutables.sol';
import {Commands} from '../libraries/Commands.sol';

contract OmegaQuoter is QuoterDispatcher {
    error LengthMismatch();
    error ExecutionFailed(uint256 commandIndex, bytes message);
    constructor(RouterParameters memory params)
        AlgebraImmutables(AlgebraParameters(
                params.integralFactory,
                params.integralPoolDeployer,
                params.integralPosManager,
                params.integralPoolInitCodeHash
            ))
        UniswapImmutables(UniswapParameters(
                params.uniswapV2Factory,
                params.uniswapV3Factory,
                params.uniswapPairInitCodeHash,
                params.uniswapPoolInitCodeHash
            ))
    {}

    /// @inheritdoc QuoterDispatcher
    function execute(bytes calldata commands, bytes[] calldata inputs) external override returns (bytes[] memory outputs) {
        outputs = new bytes[](commands.length);
        uint256 numCommands = commands.length;
        if (inputs.length != numCommands) revert LengthMismatch();

        for (uint256 commandIndex = 0; commandIndex < numCommands; commandIndex++) {
            bytes1 command = commands[commandIndex];
            bytes calldata input = inputs[commandIndex];

            (bool success, bytes memory output) = dispatch(command, input);

            if (!success && successRequired(command)) {
                revert ExecutionFailed({commandIndex: commandIndex, message: output});
            }
            
            outputs[commandIndex] = output;
        }
    }

    function successRequired(bytes1 command) internal pure returns (bool) {
        return command & Commands.FLAG_ALLOW_REVERT == 0;
    }
}
