import JSBI from 'jsbi'
import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { encodeSqrtRatioX96, nearestUsableTick, Pool as IntegralPool, TickMath } from '@cryptoalgebra/integral-sdk'
import { Pool as UniswapV3Pool, TICK_SPACINGS, FeeAmount } from '@uniswap/v3-sdk'
import { MAINNET_WETH, MAINNET_DAI, MAINNET_USDC, MAINNET_USDT, getV2PoolReserves } from './mainnetForkHelpers'
import { BigNumber } from 'ethers'
import { DEFAULT_POOL_DEPLOYER } from './constants'
import { Pair } from '@uniswap/v2-sdk'

/**
 * Action flags for Integral path encoding with wrap/unwrap support
 * 
 * New path format: token(20) + flag(1) + vault(20) + deployer(20) + token(20) + ... = 81 bytes per segment
 * 
 * ACTION_FLAG_SWAP (0x00): Standard swap, no wrap/unwrap
 *   - vaultAddress should be 0x0 (ignored)
 *   - Example: tokenA --[SWAP]--> tokenB
 * 
 * ACTION_FLAG_WRAP (0x01): Wrap incoming token before swap (underlying → vault)
 *   - vaultAddress = vault token address (ERC4626)
 *   - Example: USDC --[WRAP,vaultUSDC]--> vaultUSDC --swap--> ...
 * 
 * ACTION_FLAG_UNWRAP (0x02): Unwrap incoming token before swap (vault → underlying)
 *   - vaultAddress = vault token address (ERC4626)
 *   - Example: vaultWETH --[UNWRAP,vaultWETH]--> WETH --swap--> ...
 * 
 * Full example path (USDC → vaultUSDC → vaultWETH → WETH):
 *   tokens: [USDC, vaultUSDC, vaultWETH, WETH]
 *   flags: [WRAP, SWAP, UNWRAP]
 *   vaultAddresses: [vaultUSDC, 0x0, vaultWETH]
 */
export const ACTION_FLAG_SWAP = 0x00
export const ACTION_FLAG_WRAP = 0x01
export const ACTION_FLAG_UNWRAP = 0x02

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

/**
 * Encode Integral path with action flags and vault addresses
 * @param tokens Array of token addresses
 * @param flags Array of action flags (0x00=SWAP, 0x01=WRAP, 0x02=UNWRAP)
 * @param vaultAddresses Array of vault addresses (ERC4626 vaults for WRAP/UNWRAP, 0x0 for SWAP)
 * @returns Encoded path as hex string
 */
export function encodePathIntegralWithFlags(
  tokens: string[],
  flags: number[],
  vaultAddresses: string[]
): string {
  if (tokens.length < 2) throw new Error('Path must contain at least 2 tokens')
  if (flags.length !== tokens.length - 1) throw new Error('Flags length must be tokens.length - 1')
  if (vaultAddresses.length !== tokens.length - 1) throw new Error('VaultAddresses length must be tokens.length - 1')

  let encoded = '0x'
  for (let i = 0; i < tokens.length - 1; i++) {
    // token (20 bytes)
    encoded += tokens[i].slice(2)
    // action flag (1 byte)
    encoded += flags[i].toString(16).padStart(2, '0')
    // vault address (20 bytes) - vault address or 0x0
    encoded += vaultAddresses[i].slice(2)
    // deployer (20 bytes)
    encoded += DEFAULT_POOL_DEPLOYER.slice(2)
  }
  // encode the final token (20 bytes)
  encoded += tokens[tokens.length - 1].slice(2)

  return encoded.toLowerCase()
}

/**
 * Encode Integral exact input path with flags
 * Format: token0 + flag + vault + deployer + token1 + flag + vault + deployer + token2
 */
export function encodePathExactInputIntegralWithFlags(
  tokens: string[],
  flags: number[],
  vaultAddresses: string[]
): string {
  return encodePathIntegralWithFlags(tokens, flags, vaultAddresses)
}

/**
 * Encode Integral exact output path with flags (reverses tokens and inverts flags)
 * WRAP becomes UNWRAP, UNWRAP becomes WRAP, SWAP stays SWAP
 */
export function encodePathExactOutputIntegralWithFlags(
  tokens: string[],
  flags: number[],
  vaultAddresses: string[]
): string {
  const reversedTokens = tokens.slice().reverse()
  const reversedFlags = flags.slice().reverse().map(invertActionFlag)
  const reversedVaults = vaultAddresses.slice().reverse()
  return encodePathIntegralWithFlags(reversedTokens, reversedFlags, reversedVaults)
}

/**
 * Invert action flag for exact output (WRAP <-> UNWRAP, SWAP stays SWAP)
 */
function invertActionFlag(flag: number): number {
  if (flag === 0x01) return 0x02 // WRAP -> UNWRAP
  if (flag === 0x02) return 0x01 // UNWRAP -> WRAP
  return 0x00 // SWAP stays SWAP
}

export function expandTo18Decimals(n: number): BigintIsh {
  return JSBI.BigInt(BigNumber.from(n).mul(BigNumber.from(10).pow(18)).toString())
}
