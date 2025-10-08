import JSBI from 'jsbi'
import {BigintIsh, CurrencyAmount, Token} from '@uniswap/sdk-core'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { encodeSqrtRatioX96, nearestUsableTick, Pool as IntegralPool, TickMath } from '@cryptoalgebra/integral-sdk'
import { Pool as UniswapV3Pool, TICK_SPACINGS, FeeAmount } from '@uniswap/v3-sdk'
import {MAINNET_WETH, MAINNET_DAI, MAINNET_USDC, MAINNET_USDT, getV2PoolReserves} from './mainnetForkHelpers'
import { BigNumber } from 'ethers'
import { DEFAULT_POOL_DEPLOYER } from "./constants";
import {Pair} from "@uniswap/v2-sdk";

const sqrtRatioX96 = encodeSqrtRatioX96(1, 1)
const liquidity = 1_000_000

// v2
export const makePair = async (alice: SignerWithAddress, token0: Token, token1: Token) => {
  const reserves = await getV2PoolReserves(alice, token0, token1)
  let reserve0: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(reserves.reserve0))
  let reserve1: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(reserves.reserve1))

  return new Pair(reserve0, reserve1)
}

// Algebra integral
export const integralMakePool = (token0: Token, token1: Token, liquidity: number) => {
  const feeTier = integralGetFeeTier(token0.address, token1.address)
  return new IntegralPool(token0, token1, feeTier, sqrtRatioX96, DEFAULT_POOL_DEPLOYER, liquidity, TickMath.getTickAtSqrtRatio(sqrtRatioX96), getTickSpacing(token0.address, token1.address), [
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

export function integralGetFeeTier(tokenA: string, tokenB: string): number {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]

  if (token0 == MAINNET_DAI.address && token1 == MAINNET_WETH.address) return 3000
  if (token0 == MAINNET_USDC.address && token1 == MAINNET_WETH.address) return 500
  if (token0 == MAINNET_WETH.address && token1 == MAINNET_USDT.address) return 500
  if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDC.address) return 100
  if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDT.address) return 100
  if (token0 == MAINNET_USDC.address && token1 == MAINNET_USDT.address) return 100
  else return 3000
}

export function getTickSpacing(tokenA: string, tokenB: string): number {
    const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]

    if (token0 == MAINNET_DAI.address && token1 == MAINNET_WETH.address) return 60
    if (token0 == MAINNET_USDC.address && token1 == MAINNET_WETH.address) return 30
    if (token0 == MAINNET_WETH.address && token1 == MAINNET_USDT.address) return 30
    if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDC.address) return 1
    if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDT.address) return 1
    if (token0 == MAINNET_USDC.address && token1 == MAINNET_USDT.address) return 1
    else return 60
}

// Uniswap V3
export const makePool = (token0: Token, token1: Token, liquidity: number) => {
  const feeTier = uniswapGetFeeTier(token0.address, token1.address)
  return new UniswapV3Pool(token0, token1, feeTier, sqrtRatioX96, liquidity, TickMath.getTickAtSqrtRatio(sqrtRatioX96), [
    {
      index: nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[feeTier]),
      liquidityNet: liquidity,
      liquidityGross: liquidity,
    },
    {
      index: nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[feeTier]),
      liquidityNet: -liquidity,
      liquidityGross: liquidity,
    },
  ])
}

export function uniswapGetFeeTier(tokenA: string, tokenB: string): FeeAmount {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]

  if (token0 == MAINNET_DAI.address && token1 == MAINNET_WETH.address) return FeeAmount.MEDIUM
  if (token0 == MAINNET_USDC.address && token1 == MAINNET_WETH.address) return FeeAmount.LOW
  if (token0 == MAINNET_WETH.address && token1 == MAINNET_USDT.address) return FeeAmount.LOW
  if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDC.address) return FeeAmount.LOWEST
  if (token0 == MAINNET_DAI.address && token1 == MAINNET_USDT.address) return FeeAmount.LOWEST
  if (token0 == MAINNET_USDC.address && token1 == MAINNET_USDT.address) return FeeAmount.LOWEST
  else return FeeAmount.MEDIUM
}

export const pool_DAI_WETH = makePool(MAINNET_DAI, MAINNET_WETH, liquidity)
export const pool_DAI_USDC = makePool(MAINNET_USDC, MAINNET_DAI, liquidity)
export const pool_USDC_WETH = makePool(MAINNET_USDC, MAINNET_WETH, liquidity)
export const pool_USDC_USDT = makePool(MAINNET_USDC, MAINNET_USDT, liquidity)
export const pool_DAI_USDT = makePool(MAINNET_DAI, MAINNET_USDT, liquidity)
export const pool_WETH_USDT = makePool(MAINNET_USDT, MAINNET_WETH, liquidity)

export const integral_pool_DAI_WETH = integralMakePool(MAINNET_DAI, MAINNET_WETH, liquidity)
export const integral_pool_DAI_USDC = integralMakePool(MAINNET_USDC, MAINNET_DAI, liquidity)
export const integral_pool_USDC_WETH = integralMakePool(MAINNET_USDC, MAINNET_WETH, liquidity)
export const integral_pool_USDC_USDT = integralMakePool(MAINNET_USDC, MAINNET_USDT, liquidity)
export const integral_pool_DAI_USDT = integralMakePool(MAINNET_DAI, MAINNET_USDT, liquidity)
export const integral_pool_WETH_USDT = integralMakePool(MAINNET_USDT, MAINNET_WETH, liquidity)

// v3 Uniswap

const FEE_SIZE = 3

export function encodePath(path: string[]): string {
  let encoded = '0x'
  for (let i = 0; i < path.length - 1; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += uniswapGetFeeTier(path[i], path[i + 1])
      .toString(16)
      .padStart(2 * FEE_SIZE, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

export function encodePathIntegral(path: string[]): string {
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

export function encodePathExactInputIntegral(tokens: string[]): string {
  return encodePathIntegral(tokens)
}

export function encodePathExactOutputIntegral(tokens: string[]): string {
  return encodePathIntegral(tokens.slice().reverse())
}

export function expandTo18Decimals(n: number): BigintIsh {
  return JSBI.BigInt(BigNumber.from(n).mul(BigNumber.from(10).pow(18)).toString())
}
