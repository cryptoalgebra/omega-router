import JSBI from 'jsbi'
import { BigintIsh, Token } from '@uniswap/sdk-core'
import { encodeSqrtRatioX96, nearestUsableTick, Pool, TickMath } from '@cryptoalgebra/integral-sdk'
import { WETH, DAI, USDC, USDT } from './mainnetForkHelpers'
import { BigNumber } from 'ethers'
import { DEFAULT_POOL_DEPLOYER } from "./constants";

const sqrtRatioX96 = encodeSqrtRatioX96(1, 1)
const liquidity = 1_000_000

// v3
export const makePool = (token0: Token, token1: Token, liquidity: number) => {
  const feeTier = getFeeTier(token0.address, token1.address)
  return new Pool(token0, token1, feeTier, sqrtRatioX96, DEFAULT_POOL_DEPLOYER, liquidity, TickMath.getTickAtSqrtRatio(sqrtRatioX96), getTickSpacing(token0.address, token1.address), [
    {
      index: nearestUsableTick(TickMath.MIN_TICK, getTickSpacing(token0.address, token1.address)),
      liquidityNet: liquidity,
      liquidityGross: liquidity,
    },
    {
      index: nearestUsableTick(TickMath.MAX_TICK, getTickSpacing(token0.address, token1.address)),
      liquidityNet: -liquidity,
      liquidityGross: liquidity,
    },
  ])
}

export function getFeeTier(tokenA: string, tokenB: string): number {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]

  if (token0 == DAI.address && token1 == WETH.address) return 3000
  if (token0 == USDC.address && token1 == WETH.address) return 500
  if (token0 == WETH.address && token1 == USDT.address) return 500
  if (token0 == DAI.address && token1 == USDC.address) return 100
  if (token0 == DAI.address && token1 == USDT.address) return 100
  if (token0 == USDC.address && token1 == USDT.address) return 100
  else return 3000
}

export function getTickSpacing(tokenA: string, tokenB: string): number {
    const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]

    if (token0 == DAI.address && token1 == WETH.address) return 60
    if (token0 == USDC.address && token1 == WETH.address) return 30
    if (token0 == WETH.address && token1 == USDT.address) return 30
    if (token0 == DAI.address && token1 == USDC.address) return 1
    if (token0 == DAI.address && token1 == USDT.address) return 1
    if (token0 == USDC.address && token1 == USDT.address) return 1
    else return 60
}

export const pool_DAI_WETH = makePool(DAI, WETH, liquidity)
export const pool_DAI_USDC = makePool(USDC, DAI, liquidity)
export const pool_USDC_WETH = makePool(USDC, WETH, liquidity)
export const pool_USDC_USDT = makePool(USDC, USDT, liquidity)
export const pool_DAI_USDT = makePool(DAI, USDT, liquidity)
export const pool_WETH_USDT = makePool(USDT, WETH, liquidity)

// v3
export function encodePath(path: string[]): string {
  let encoded = '0x'
  for (let i = 0; i < path.length - 1; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += DEFAULT_POOL_DEPLOYER.slice(2)
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

export function encodePathExactInput(tokens: string[]): string {
  return encodePath(tokens)
}

export function encodePathExactOutput(tokens: string[]): string {
  return encodePath(tokens.slice().reverse())
}

export function expandTo18Decimals(n: number): BigintIsh {
  return JSBI.BigInt(BigNumber.from(n).mul(BigNumber.from(10).pow(18)).toString())
}
