// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {V2SwapRouter} from '../modules/uniswap/v2/V2SwapRouter.sol';
import {V3SwapRouter} from '../modules/uniswap/v3/V3SwapRouter.sol';
import {IntegralSwapRouter} from '../modules/algebra/integral/IntegralSwapRouter.sol';
import {IntegralPositions} from '../modules/algebra/integral/IntegralPositions.sol';
import {IntegralBytesLib} from '../modules/algebra/integral/IntegralBytesLib.sol';
import {PaymentsImmutables} from '../modules/PaymentsImmutables.sol';
import {ERC4626WrapUnwrap} from '../modules/ERC4626WrapUnwrap.sol';
import {Payments} from '../modules/Payments.sol';
import {PaymentsImmutables} from '../modules/PaymentsImmutables.sol';
import {Commands} from '../libraries/Commands.sol';
import {Lock} from './Lock.sol';
import {ERC20} from 'solmate/src/tokens/ERC20.sol';
import {IAllowanceTransfer} from 'permit2/src/interfaces/IAllowanceTransfer.sol';
import {INonfungiblePositionManager} from
    '@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import {ActionConstants} from '../libraries/ActionConstants.sol';
import {CalldataDecoder} from '../libraries/CalldataDecoder.sol';

/// @title Decodes and Executes Commands
/// @notice Called by the OmegaRouter contract to efficiently decode and execute a singular command
abstract contract Dispatcher is
    Payments,
    Lock,
    IntegralSwapRouter,
    IntegralPositions,
    V3SwapRouter,
    V2SwapRouter,
    ERC4626WrapUnwrap
{
    using IntegralBytesLib for bytes;
    using CalldataDecoder for bytes;

    error InvalidCommandType(uint256 commandType);
    error BalanceTooLow();

    /// @notice Executes encoded commands along with provided inputs.
    /// @param commands A set of concatenated commands, each 1 byte in length
    /// @param inputs An array of byte strings containing abi encoded inputs for each command
    function execute(bytes calldata commands, bytes[] calldata inputs) external payable virtual;

    /// @notice Public view function to be used instead of msg.sender, as the contract performs self-reentrancy and at
    /// times msg.sender == address(this). Instead msgSender() returns the initiator of the lock
    /// @dev overrides BaseActionsRouter.msgSender in V4Router
    function msgSender() public view returns (address) {
        return _getLocker();
    }

    /// @notice Decodes and executes the given command with the given inputs
    /// @param commandType The command type to execute
    /// @param inputs The inputs to execute the command with
    /// @dev 2 masks are used to enable use of a nested-if statement in execution for efficiency reasons
    /// @return success True on success of the command, false on failure
    /// @return output The outputs or error messages, if any, from the command
    function dispatch(bytes1 commandType, bytes calldata inputs) internal returns (bool success, bytes memory output) {
        uint256 command = uint8(commandType & Commands.COMMAND_TYPE_MASK);

        success = true;

        // 0x00 <= command < 0x21
        if (command < Commands.EXECUTE_SUB_PLAN) {
            // 0x00 <= command < 0x10
            if (command < Commands.UNISWAP_V3_SWAP_EXACT_IN) {
                // 0x00 <= command < 0x08
                if (command < Commands.V2_SWAP_EXACT_IN) {
                    if (command == Commands.INTEGRAL_SWAP_EXACT_IN) {
                        // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                        address recipient;
                        uint256 amountIn;
                        uint256 amountOutMin;
                        bool payerIsUser;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amountIn := calldataload(add(inputs.offset, 0x20))
                            amountOutMin := calldataload(add(inputs.offset, 0x40))
                            // 0x60 offset is the path, decoded below
                            payerIsUser := calldataload(add(inputs.offset, 0x80))
                        }
                        bytes calldata path = inputs.toBytes(3);
                        address payer = payerIsUser ? msgSender() : address(this);
                        integralSwapExactInput(map(recipient), amountIn, amountOutMin, path, payer);
                    } else if (command == Commands.INTEGRAL_SWAP_EXACT_OUT) {
                        // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                        address recipient;
                        uint256 amountOut;
                        uint256 amountInMax;
                        bool payerIsUser;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amountOut := calldataload(add(inputs.offset, 0x20))
                            amountInMax := calldataload(add(inputs.offset, 0x40))
                            // 0x60 offset is the path, decoded below
                            payerIsUser := calldataload(add(inputs.offset, 0x80))
                        }
                        bytes calldata path = inputs.toBytes(3);
                        address payer = payerIsUser ? msgSender() : address(this);
                        integralSwapExactOutput(map(recipient), amountOut, amountInMax, path, payer);
                    } else if (command == Commands.PERMIT2_TRANSFER_FROM) {
                        // equivalent: abi.decode(inputs, (address, address, uint160))
                        address token;
                        address recipient;
                        uint160 amount;
                        assembly {
                            token := calldataload(inputs.offset)
                            recipient := calldataload(add(inputs.offset, 0x20))
                            amount := calldataload(add(inputs.offset, 0x40))
                        }
                        permit2TransferFrom(token, msgSender(), map(recipient), amount);
                    } else if (command == Commands.PERMIT2_PERMIT_BATCH) {
                        IAllowanceTransfer.PermitBatch calldata permitBatch;
                        assembly {
                            // this is a variable length struct, so calldataload(inputs.offset) contains the
                            // offset from inputs.offset at which the struct begins
                            permitBatch := add(inputs.offset, calldataload(inputs.offset))
                        }
                        bytes calldata data = inputs.toBytes(1);
                        (success, output) = address(PERMIT2).call(
                            abi.encodeWithSignature(
                                'permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)',
                                msgSender(),
                                permitBatch,
                                data
                            )
                        );
                    } else if (command == Commands.SWEEP) {
                        // equivalent:  abi.decode(inputs, (address, address, uint256))
                        address token;
                        address recipient;
                        uint160 amountMin;
                        assembly {
                            token := calldataload(inputs.offset)
                            recipient := calldataload(add(inputs.offset, 0x20))
                            amountMin := calldataload(add(inputs.offset, 0x40))
                        }
                        Payments.sweep(token, map(recipient), amountMin);
                    } else if (command == Commands.TRANSFER) {
                        // equivalent:  abi.decode(inputs, (address, address, uint256))
                        address token;
                        address recipient;
                        uint256 value;
                        assembly {
                            token := calldataload(inputs.offset)
                            recipient := calldataload(add(inputs.offset, 0x20))
                            value := calldataload(add(inputs.offset, 0x40))
                        }
                        Payments.pay(token, map(recipient), value);
                    } else if (command == Commands.PAY_PORTION) {
                        // equivalent:  abi.decode(inputs, (address, address, uint256))
                        address token;
                        address recipient;
                        uint256 bips;
                        assembly {
                            token := calldataload(inputs.offset)
                            recipient := calldataload(add(inputs.offset, 0x20))
                            bips := calldataload(add(inputs.offset, 0x40))
                        }
                        Payments.payPortion(token, map(recipient), bips);
                    } else {
                        // the only way to be here is command 0x07 == ERC4626_WRAP
                        // equivalent:  abi.decode(inputs, (address, address, address, uint256, uint256))
                        address wrapper;
                        address underlyingToken;
                        address receiver;
                        uint256 amountIn;
                        uint256 amountOutMin;
                        assembly {
                            wrapper := calldataload(inputs.offset)
                            underlyingToken := calldataload(add(inputs.offset, 0x20))
                            receiver := calldataload(add(inputs.offset, 0x40))
                            amountIn := calldataload(add(inputs.offset, 0x60))
                            amountOutMin := calldataload(add(inputs.offset, 0x80))
                        }
                        erc4626Wrap(wrapper, underlyingToken, map(receiver), amountIn, amountOutMin);
                    }
                } else {
                    if (command == Commands.V2_SWAP_EXACT_IN) {
                        // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                        address recipient;
                        uint256 amountIn;
                        uint256 amountOutMin;
                        bool payerIsUser;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amountIn := calldataload(add(inputs.offset, 0x20))
                            amountOutMin := calldataload(add(inputs.offset, 0x40))
                            // 0x60 offset is the path, decoded below
                            payerIsUser := calldataload(add(inputs.offset, 0x80))
                        }
                        address[] calldata path = inputs.toAddressArray(3);
                        address payer = payerIsUser ? msgSender() : address(this);
                        v2SwapExactInput(map(recipient), amountIn, amountOutMin, path, payer);
                    } else if (command == Commands.V2_SWAP_EXACT_OUT) {
                        // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                        address recipient;
                        uint256 amountOut;
                        uint256 amountInMax;
                        bool payerIsUser;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amountOut := calldataload(add(inputs.offset, 0x20))
                            amountInMax := calldataload(add(inputs.offset, 0x40))
                            // 0x60 offset is the path, decoded below
                            payerIsUser := calldataload(add(inputs.offset, 0x80))
                        }
                        address[] calldata path = inputs.toAddressArray(3);
                        address payer = payerIsUser ? msgSender() : address(this);
                        v2SwapExactOutput(map(recipient), amountOut, amountInMax, path, payer);
                    } else if (command == Commands.PERMIT2_PERMIT) {
                        // equivalent: abi.decode(inputs, (IAllowanceTransfer.PermitSingle, bytes))
                        IAllowanceTransfer.PermitSingle calldata permitSingle;
                        assembly {
                            permitSingle := inputs.offset
                        }
                        bytes calldata data = inputs.toBytes(6); // PermitSingle takes first 6 slots (0..5)
                        (success, output) = address(PERMIT2).call(
                            abi.encodeWithSignature(
                                'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
                                msgSender(),
                                permitSingle,
                                data
                            )
                        );
                    } else if (command == Commands.WRAP_ETH) {
                        // equivalent: abi.decode(inputs, (address, uint256))
                        address recipient;
                        uint256 amount;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amount := calldataload(add(inputs.offset, 0x20))
                        }
                        Payments.wrapETH(map(recipient), amount);
                    } else if (command == Commands.UNWRAP_WETH) {
                        // equivalent: abi.decode(inputs, (address, uint256))
                        address recipient;
                        uint256 amountMin;
                        assembly {
                            recipient := calldataload(inputs.offset)
                            amountMin := calldataload(add(inputs.offset, 0x20))
                        }
                        Payments.unwrapWETH(map(recipient), amountMin);
                    } else if (command == Commands.PERMIT2_TRANSFER_FROM_BATCH) {
                        IAllowanceTransfer.AllowanceTransferDetails[] calldata batchDetails;
                        (uint256 length, uint256 offset) = inputs.toLengthOffset(0);
                        assembly {
                            batchDetails.length := length
                            batchDetails.offset := offset
                        }
                        permit2TransferFrom(batchDetails, msgSender());
                    } else if (command == Commands.BALANCE_CHECK_ERC20) {
                        // equivalent: abi.decode(inputs, (address, address, uint256))
                        address owner;
                        address token;
                        uint256 minBalance;
                        assembly {
                            owner := calldataload(inputs.offset)
                            token := calldataload(add(inputs.offset, 0x20))
                            minBalance := calldataload(add(inputs.offset, 0x40))
                        }
                        success = (ERC20(token).balanceOf(owner) >= minBalance);
                        if (!success) output = abi.encodePacked(BalanceTooLow.selector);
                    } else {
                        // the only way to be here is command 0x0f == ERC4626_UNWRAP
                        // equivalent:  abi.decode(inputs, (address, address, uint256, uint256))
                        address wrapper;
                        address receiver;
                        uint256 amountIn;
                        uint256 amountOutMin;
                        assembly {
                            wrapper := calldataload(inputs.offset)
                            receiver := calldataload(add(inputs.offset, 0x20))
                            amountIn := calldataload(add(inputs.offset, 0x40))
                            amountOutMin := calldataload(add(inputs.offset, 0x60))
                        }
                        erc4626Unwrap(wrapper, map(receiver), amountIn, amountOutMin);
                    }
                }
            } else {
                // 0x10 <= command < 0x21
                if (command == Commands.UNISWAP_V3_SWAP_EXACT_IN) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                    address recipient;
                    uint256 amountIn;
                    uint256 amountOutMin;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountIn := calldataload(add(inputs.offset, 0x20))
                        amountOutMin := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    bytes calldata path = inputs.toBytes(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v3SwapExactInput(map(recipient), amountIn, amountOutMin, path, payer);
                } else if (command == Commands.UNISWAP_V3_SWAP_EXACT_OUT) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                    address recipient;
                    uint256 amountOut;
                    uint256 amountInMax;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountOut := calldataload(add(inputs.offset, 0x20))
                        amountInMax := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    bytes calldata path = inputs.toBytes(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v3SwapExactOutput(map(recipient), amountOut, amountInMax, path, payer);
                } else if (command == Commands.INTEGRAL_POSITION_MANAGER_CALL) {
                    _checkV3PositionManagerCall(inputs, msgSender());
                    (success, output) = address(ALGEBRA_INTEGRAL_POSITION_MANAGER).call(inputs);
                } else if (command == Commands.INTEGRAL_MINT) {
                    // equivalent: abi.decode(inputs, ((address, address, address, int24, int24, uint256, uint256, uint256, uint256, address, uint256)))
                    INonfungiblePositionManager.MintParams memory params;

                    assembly {
                        mstore(params, calldataload(inputs.offset)) // token0
                        mstore(add(params, 0x20), calldataload(add(inputs.offset, 0x20))) // token1
                        mstore(add(params, 0x40), calldataload(add(inputs.offset, 0x40))) // deployer
                        mstore(add(params, 0x60), calldataload(add(inputs.offset, 0x60))) // tickLower
                        mstore(add(params, 0x80), calldataload(add(inputs.offset, 0x80))) // tickUpper
                        mstore(add(params, 0xa0), calldataload(add(inputs.offset, 0xa0))) // amount0Desired
                        mstore(add(params, 0xc0), calldataload(add(inputs.offset, 0xc0))) // amount1Desired
                        mstore(add(params, 0xe0), calldataload(add(inputs.offset, 0xe0))) // amount0Min
                        mstore(add(params, 0x100), calldataload(add(inputs.offset, 0x100))) // amount1Min
                        mstore(add(params, 0x120), calldataload(add(inputs.offset, 0x120))) // recipient
                        mstore(add(params, 0x140), calldataload(add(inputs.offset, 0x140))) // deadline
                    }

                    params.recipient = map(params.recipient);

                    integralMint(params);
                } else if (command == Commands.INTEGRAL_INCREASE_LIQUIDITY) {
                    // equivalent: abi.decode(inputs, (uint256, uint256, uint256, uint256, uint256, uint256)) -> IncreaseLiquidityParams
                    INonfungiblePositionManager.IncreaseLiquidityParams memory incParams;

                    assembly {
                        mstore(incParams, calldataload(inputs.offset)) // tokenId
                        mstore(add(incParams, 0x20), calldataload(add(inputs.offset, 0x20))) // amount0Desired
                        mstore(add(incParams, 0x40), calldataload(add(inputs.offset, 0x40))) // amount1Desired
                        mstore(add(incParams, 0x60), calldataload(add(inputs.offset, 0x60))) // amount0Min
                        mstore(add(incParams, 0x80), calldataload(add(inputs.offset, 0x80))) // amount1Min
                        mstore(add(incParams, 0xa0), calldataload(add(inputs.offset, 0xa0))) // deadline
                    }

                    integralIncreaseLiquidity(incParams);
                } else if (command == Commands.INTEGRAL_POSITION_MANAGER_PERMIT) {
                    _checkV3PermitCall(inputs);
                    (success, output) = address(ALGEBRA_INTEGRAL_POSITION_MANAGER).call(inputs);
                } else {
                    // placeholder area for commands 0x16-0x20
                    revert InvalidCommandType(command);
                }
            }
        } else {
            // 0x21 <= command
            if (command == Commands.EXECUTE_SUB_PLAN) {
                (bytes calldata _commands, bytes[] calldata _inputs) = inputs.decodeActionsRouterParams();
                (success, output) = (address(this)).call(abi.encodeCall(Dispatcher.execute, (_commands, _inputs)));
            } else {
                // placeholder area for commands 0x22-0x3f
                revert InvalidCommandType(command);
            }
        }
    }

    /// @notice Calculates the recipient address for a command
    /// @param recipient The recipient or recipient-flag for the command
    /// @return output The resultant recipient for the command
    function map(address recipient) internal view returns (address) {
        if (recipient == ActionConstants.MSG_SENDER) {
            return msgSender();
        } else if (recipient == ActionConstants.ADDRESS_THIS) {
            return address(this);
        } else {
            return recipient;
        }
    }
}
