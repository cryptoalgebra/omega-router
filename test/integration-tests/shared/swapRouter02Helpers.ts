import JSBI from 'jsbi'
import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { encodeSqrtRatioX96, nearestUsableTick, Pool as IntegralPool, TickMath } from '@cryptoalgebra/integral-sdk'
import { Pool as UniswapV3Pool, TICK_SPACINGS, FeeAmount } from '@uniswap/v3-sdk'
import { MAINNET_WETH, MAINNET_DAI, MAINNET_USDC, MAINNET_USDT, getV2PoolReserves } from './mainnetForkHelpers'
import { BigNumber } from 'ethers'
import { DEFAULT_POOL_DEPLOYER } from './constants'
import { Pair } from '@uniswap/v2-sdk'

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
  return new IntegralPool(
    token0,
    token1,
    feeTier,
    sqrtRatioX96,
    DEFAULT_POOL_DEPLOYER,
    liquidity,
    TickMath.getTickAtSqrtRatio(sqrtRatioX96),
    getTickSpacing(token0.address, token1.address),
    [
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
    ]
  )
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
  return new UniswapV3Pool(
    token0,
    token1,
    feeTier,
    sqrtRatioX96,
    liquidity,
    TickMath.getTickAtSqrtRatio(sqrtRatioX96),
    [
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
    ]
  )
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

export function encodePathIntegral(path: string[], deployer?: string): string {
  const poolDeployer = deployer || DEFAULT_POOL_DEPLOYER
  let encoded = '0x'
  for (let i = 0; i < path.length - 1; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += poolDeployer.slice(2)
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

export function encodePathExactInputIntegral(tokens: string[], deployer?: string): string {
  return encodePathIntegral(tokens, deployer)
}

export function encodePathExactOutputIntegral(tokens: string[], deployer?: string): string {
  return encodePathIntegral(tokens.slice().reverse(), deployer)
}

// WrapAction enum values
export const WrapAction = {
  NONE: 0,
  WRAP: 1,
  UNWRAP: 2,
} as const

export type WrapActionType = (typeof WrapAction)[keyof typeof WrapAction]

export interface BoostedPoolHop {
  tokenOut: string // External token user wants
  wrapOut: WrapActionType // Action for output: NONE, WRAP, UNWRAP
  poolTokenOut: string // Token pool trades (may be wrapped version)
  deployer: string // Pool deployer address
  poolTokenIn: string // Token pool accepts as input
  wrapIn: WrapActionType // Action for input: NONE, WRAP, UNWRAP
  tokenIn: string // External token user provides
}

/**
 * Encodes a boosted path for exactOut swaps with wrap/unwrap support
 *
 * Path structure per hop: tokenOut(20) | wrapOut(1) | poolTokenOut(20) | deployer(20) | poolTokenIn(20) | wrapIn(1) | tokenIn(20)
 *
 * For multihop, the tokenIn of one hop becomes the tokenOut of the next hop
 */
export function encodeBoostedPathExactOutput(hops: BoostedPoolHop[]): string {
  let encoded = '0x'

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]

    // tokenOut (20 bytes)
    encoded += hop.tokenOut.slice(2).toLowerCase()
    // wrapOut (1 byte)
    encoded += hop.wrapOut.toString(16).padStart(2, '0')
    // poolTokenOut (20 bytes)
    encoded += hop.poolTokenOut.slice(2).toLowerCase()
    // deployer (20 bytes)
    encoded += hop.deployer.slice(2).toLowerCase()
    // poolTokenIn (20 bytes)
    encoded += hop.poolTokenIn.slice(2).toLowerCase()
    // wrapIn (1 byte)
    encoded += hop.wrapIn.toString(16).padStart(2, '0')

    // tokenIn (20 bytes) - only for last hop, otherwise it's encoded as tokenOut of next hop
    if (i === hops.length - 1) {
      encoded += hop.tokenIn.slice(2).toLowerCase()
    }
  }

  return encoded
}

/**
 * Helper to create a single-hop boosted path for exactOut
 */
export function encodeSingleBoostedPoolExactOutput(
  tokenOut: string,
  wrapOut: WrapActionType,
  poolTokenOut: string,
  deployer: string,
  poolTokenIn: string,
  wrapIn: WrapActionType,
  tokenIn: string
): string {
  return encodeBoostedPathExactOutput([
    {
      tokenOut,
      wrapOut,
      poolTokenOut,
      deployer,
      poolTokenIn,
      wrapIn,
      tokenIn,
    },
  ])
}

export function expandTo18Decimals(n: number): BigintIsh {
  return JSBI.BigInt(BigNumber.from(n).mul(BigNumber.from(10).pow(18)).toString())
}

/**
 * Helper to create a simple boosted path for exactOut without any wrap/unwrap
 * tokenIn == poolTokenIn and tokenOut == poolTokenOut
 *
 * @param tokens Array of token addresses in swap order (e.g., [tokenIn, tokenOut] for single hop)
 * @param deployer Pool deployer address (defaults to ZERO_ADDRESS)
 */
export function encodeSimpleBoostedPathExactOutput(
  tokens: string[],
  deployer: string = '0x0000000000000000000000000000000000000000'
): string {
  // Reverse tokens for exactOut (path goes from output to input)
  const reversedTokens = tokens.slice().reverse()

  const hops: BoostedPoolHop[] = []

  for (let i = 0; i < reversedTokens.length - 1; i++) {
    const tokenOut = reversedTokens[i]
    const tokenIn = reversedTokens[i + 1]

    hops.push({
      tokenOut,
      wrapOut: WrapAction.NONE,
      poolTokenOut: tokenOut, // same as tokenOut (no wrap)
      deployer,
      poolTokenIn: tokenIn, // same as tokenIn (no wrap)
      wrapIn: WrapAction.NONE,
      tokenIn,
    })
  }

  return encodeBoostedPathExactOutput(hops)
}
