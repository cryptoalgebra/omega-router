import type { Contract } from '@ethersproject/contracts'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import {ALGEBRA_INTEGRAL_EVENTS, parseEvents, UNISWAP_V3_EVENTS} from './parseEvents'
import { BigNumber, BigNumberish } from 'ethers'
import { UniversalRouter } from '../../../typechain'
import { DEADLINE } from './constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { RoutePlanner } from './planner'
import hre from 'hardhat'
const { ethers } = hre

type V3SwapEventArgs = {
  amount0: BigNumber
  amount1: BigNumber
}

type ExecutionParams = {
  wethBalanceBefore: BigNumber
  wethBalanceAfter: BigNumber
  daiBalanceBefore: BigNumber
  daiBalanceAfter: BigNumber
  usdcBalanceBefore: BigNumber
  usdcBalanceAfter: BigNumber
  ethBalanceBefore: BigNumber
  ethBalanceAfter: BigNumber
  v3SwapEventArgs: V3SwapEventArgs | undefined
  receipt: TransactionReceipt
  gasSpent: BigNumber
}

export enum DEX {
  UNI_V3,
  ALGEBRA_INTEGRAL
}

export async function executeRouter(
  planner: RoutePlanner,
  caller: SignerWithAddress,
  router: UniversalRouter,
  wethContract: Contract,
  daiContract: Contract,
  usdcContract: Contract,
  value?: BigNumberish,
  dex?: DEX
): Promise<ExecutionParams> {
  const ethBalanceBefore: BigNumber = await ethers.provider.getBalance(caller.address)
  const wethBalanceBefore: BigNumber = await wethContract.balanceOf(caller.address)
  const daiBalanceBefore: BigNumber = await daiContract.balanceOf(caller.address)
  const usdcBalanceBefore: BigNumber = await usdcContract.balanceOf(caller.address)

  const { commands, inputs } = planner

  const receipt = await (
    await router.connect(caller)['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE, { value })
  ).wait()
  const gasSpent = receipt.gasUsed.mul(receipt.effectiveGasPrice)

  const v3SwapEventArgs = (() => {
    switch (dex) {
      case DEX.ALGEBRA_INTEGRAL:
        return parseEvents(ALGEBRA_INTEGRAL_EVENTS, receipt)[0]?.args as unknown as V3SwapEventArgs
      default:
        return parseEvents(UNISWAP_V3_EVENTS, receipt)[0]?.args as unknown as V3SwapEventArgs
    }
  })()


  const ethBalanceAfter: BigNumber = await ethers.provider.getBalance(caller.address)
  const wethBalanceAfter: BigNumber = await wethContract.balanceOf(caller.address)
  const daiBalanceAfter: BigNumber = await daiContract.balanceOf(caller.address)
  const usdcBalanceAfter: BigNumber = await usdcContract.balanceOf(caller.address)

  return {
    wethBalanceBefore,
    wethBalanceAfter,
    daiBalanceBefore,
    daiBalanceAfter,
    usdcBalanceBefore,
    usdcBalanceAfter,
    ethBalanceBefore,
    ethBalanceAfter,
    v3SwapEventArgs,
    receipt,
    gasSpent,
  }
}
