// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface IOmegaQuoter {
    error LengthMismatch();
    error ExecutionFailed(uint256 commandIndex, bytes message);

    /// @notice Executes encoded commands along with provided inputs and returns quote results
    /// @param commands A set of concatenated commands, each 1 byte in length
    /// @param inputs An array of byte strings containing abi encoded inputs for each command
    /// @return outputs An array of byte strings containing abi encoded quote results for each command
    function execute(bytes calldata commands, bytes[] calldata inputs) external returns (bytes[] memory outputs);
}
