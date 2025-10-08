import { Interface, LogDescription } from '@ethersproject/abi'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import hre from 'hardhat'
const { ethers } = hre

export const UNISWAP_V3_EVENTS = new Interface([
  'event Swap( address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 price, uint128 liquidity, int24 tick)',
])

export const ALGEBRA_INTEGRAL_EVENTS = new Interface([
  'event Swap( address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 price, uint128 liquidity, int24 tick, uint24 overrideFee, uint24 pluginFee)',
])

export function parseEvents(iface: Interface, receipt: TransactionReceipt): (LogDescription | undefined)[] {
  return receipt.logs
    .map((log: { topics: Array<string>; data: string }) => {
      try {
        return iface.parseLog(log)
      } catch (e) {
        return undefined
      }
    })
    .filter((n: LogDescription | undefined) => n)
}

export function findCustomErrorSelector(iface: any, name: string): string | undefined {
  const customErrorEntry = Object.entries(iface.errors).find(([, fragment]: any) => fragment.name === name)

  if (customErrorEntry === undefined) {
    return undefined
  }

  const [customErrorSignature] = customErrorEntry
  const customErrorSelector = ethers.utils.id(customErrorSignature).slice(0, 10)

  return customErrorSelector
}
