// SPDX-License-Identifier: GPL-3.0-or-later

/// @title Library for Bytes Manipulation
pragma solidity ^0.8.0;

import {Constants} from '../../../libraries/Constants.sol';

library IntegralBytesLib {
    error IntegralPathError();

    /// @notice Returns the pool details with action flag and vault address starting at byte 0
    /// @dev New format: token0(20) + flag(1) + vault(20) + deployer(20) + token1(20) = 81 bytes
    /// @param _bytes The input bytes string to slice
    /// @return token0 The address at byte 0
    /// @return flag The action flag at byte 20
    /// @return vaultAddress The vault address at byte 21 (ERC4626 vault for WRAP/UNWRAP)
    /// @return deployer The pool deployer address at byte 41
    /// @return token1 The address at byte 61
    function toPoolWithVault(bytes calldata _bytes)
        internal
        pure
        returns (address token0, uint8 flag, address vaultAddress, address deployer, address token1)
    {
        if (_bytes.length < Constants.INTEGRAL_POP_OFFSET) revert IntegralPathError();
        assembly {
            let firstWord := calldataload(_bytes.offset)
            // token0 is first 20 bytes (160 bits)
            token0 := shr(96, firstWord)
            // flag is byte 20 (8 bits) - shift to get the byte after token0
            flag := shr(88, shl(160, firstWord))
            // vaultAddress is bytes 21-40 (160 bits)
            vaultAddress := shr(96, calldataload(add(_bytes.offset, 21)))
            // deployer is bytes 41-60 (160 bits)
            deployer := shr(96, calldataload(add(_bytes.offset, 41)))
            // token1 is bytes 61-80 (160 bits)
            token1 := shr(96, calldataload(add(_bytes.offset, 61)))
        }
    }

    /// @notice Legacy function for backward compatibility - reads old format without flag/aux
    /// @dev Old format: token0(20) + deployer(20) + token1(20) = 60 bytes
    /// @param _bytes The input bytes string to slice
    /// @return token0 The address at byte 0
    /// @return deployer The address of a pool deployer at byte 20
    /// @return token1 The address at byte 40
    function toPool(bytes calldata _bytes) internal pure returns (address token0, address deployer, address token1) {
        // Old format validation (60 bytes minimum)
        if (_bytes.length < 60) revert IntegralPathError();
        assembly {
            let firstWord := calldataload(_bytes.offset)
            token0 := shr(96, firstWord)
            deployer := shr(96, calldataload(add(_bytes.offset, 20)))
            token1 := shr(96, calldataload(add(_bytes.offset, 40)))
        }
    }

    /// @notice Decode action flag at specific offset
    /// @param _bytes The input bytes string
    /// @param offset The offset to read from
    /// @return flag The action flag byte
    function toActionFlag(bytes calldata _bytes, uint256 offset) internal pure returns (uint8 flag) {
        assembly {
            flag := shr(248, calldataload(add(_bytes.offset, offset)))
        }
    }

    /// @notice Decode address at specific offset
    /// @param _bytes The input bytes string
    /// @param offset The offset to read from
    /// @return addr The address
    function toAddressAt(bytes calldata _bytes, uint256 offset) internal pure returns (address addr) {
        assembly {
            addr := shr(96, calldataload(add(_bytes.offset, offset)))
        }
    }
}
