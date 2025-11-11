import {
  ERC20,
  ERC20__factory,
  IPermit2,
  INonfungiblePositionManager,
  IUniswapPoolInitializer,
} from '../../../typechain'
import { abi as PERMIT2_ABI } from '../../../artifacts/permit2/src/interfaces/IPermit2.sol/IPermit2.json'
import { abi as V2_PAIR_ABI } from '../../../artifacts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json'
import { abi as INonfungiblePositionManager_ABI } from '../../../artifacts/@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json'
import { abi as IUniswapNonfungiblePositionManager_ABI } from '../../../node_modules/@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json'
import {
  PERMIT2_ADDRESS,
  INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
  UNISWAP_V3_NFT_POSITION_MANAGER_MAINNET,
} from './constants'
import { Currency, Token, WETH9 } from '@uniswap/sdk-core'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, constants } from 'ethers'
import hre from 'hardhat'
import { Pair } from '@uniswap/v2-sdk'
const { ethers } = hre

export const MAINNET_WETH = WETH9[1]
export const MAINNET_DAI = new Token(1, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18, 'DAI', 'Dai Stablecoin')
export const MAINNET_USDC = new Token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'USDC', 'USD//C')
export const MAINNET_USDT = new Token(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'USDT', 'Tether USD')
export const MAINNET_WA_USDC = new Token(
  1,
  '0xd4fa2d31b7968e448877f69a96de69f5de8cd23e',
  6,
  'waUSDC',
  'Wrapped Aave USDC'
)
export const MAINNET_WA_WETH = new Token(
  1,
  '0x0bfc9d54Fc184518A81162F8fB99c2eACa081202',
  18,
  'waWETH',
  'Wrapped Aave WETH'
)
export const MAINNET_GALA = new Token(1, '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA', 8, 'GALA', 'Gala')

export const MAINNET_USDC_WHALE = '0x0b07f64ABc342B68AEc57c0936E4B6fD4452967E'
export const MAINNET_SWAP_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

export const BASE_WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH', 'Wrapped Ether')
export const BASE_USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC', 'USD//C')
export const BASE_DAI = new Token(8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18, 'DAI', 'Dai Stablecoin')
export const BASE_WM_USDC = new Token(
  8453,
  '0x616a4E1db48e22028f6bbf20444Cd3b8e3273738',
  18,
  'smUSDC',
  'Wrapped Morpho USDC'
)
export const BASE_WA_WETH = new Token(
  8453,
  '0xe298b938631f750DD409fB18227C4a23dCdaab9b',
  18,
  'waWETH',
  'Wrapped Aave WETH'
)

// Morpho Vaults on Base
export const BASE_MORPHO_USDC_VAULT = new Token(
  8453,
  '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A',
  6,
  'mUSDC',
  'Morpho USDC Vault'
)
export const BASE_MORPHO_WETH_VAULT = new Token(
  8453,
  '0xa0E430870c4604CcfC7B38Ca7845B1FF653D0ff1',
  18,
  'mWETH',
  'Morpho WETH Vault'
)

// Whale addresses on Base
export const BASE_DAI_WHALE = '0x0772f014009162efB833eF34d3eA3f243FC735Ba'
export const BASE_USDC_WHALE = '0x4d91619a02B55a817930f22C444560933dabF7Cd' 
export const BASE_WETH_WHALE = '0xecbf6e57d9430b8F79927e6109183846fab55D25'

export interface MethodParameters {
  /**
   * The hex encoded calldata to perform the given operation
   */
  calldata: string
  /**
   * The amount of ether (wei) to send in hex.
   */
  value: string
}

export const approveSwapRouter02 = async (
  alice: SignerWithAddress,
  currency: Currency,
  overrideSwapRouter02Address?: string
) => {
  if (currency.isToken) {
    const aliceTokenIn: ERC20 = ERC20__factory.connect(currency.address, alice)

    if (currency.symbol == 'USDT') {
      await (await aliceTokenIn.approve(overrideSwapRouter02Address ?? MAINNET_SWAP_ROUTER_V2, 0)).wait()
    }

    return await (
      await aliceTokenIn.approve(overrideSwapRouter02Address ?? MAINNET_SWAP_ROUTER_V2, constants.MaxUint256)
    ).wait()
  }
}

type Reserves = {
  reserve0: BigNumber
  reserve1: BigNumber
}

export const getV2PoolReserves = async (alice: SignerWithAddress, tokenA: Token, tokenB: Token): Promise<Reserves> => {
  const contractAddress = Pair.getAddress(tokenA, tokenB)
  const contract = new ethers.Contract(contractAddress, V2_PAIR_ABI, alice)

  const { reserve0, reserve1 } = await contract.getReserves()
  return { reserve0, reserve1 }
}

export const approveAndExecuteSwapRouter02 = async (
  methodParameters: MethodParameters,
  tokenIn: Currency,
  tokenOut: Currency,
  alice: SignerWithAddress
): Promise<TransactionResponse> => {
  if (tokenIn.symbol == tokenOut.symbol) throw 'Cannot trade token for itself'
  await approveSwapRouter02(alice, tokenIn)

  const transaction = {
    data: methodParameters.calldata,
    to: MAINNET_SWAP_ROUTER_V2,
    value: BigNumber.from(methodParameters.value),
    from: alice.address,
    gasPrice: BigNumber.from(2000000000000),
    type: 1,
  }

  const transactionResponse = await alice.sendTransaction(transaction)
  return transactionResponse
}

export const executeSwapRouter02Swap = async (
  methodParameters: MethodParameters,
  alice: SignerWithAddress
): Promise<TransactionResponse> => {
  const transaction = {
    data: methodParameters.calldata,
    to: MAINNET_SWAP_ROUTER_V2,
    value: BigNumber.from(methodParameters.value),
    from: alice.address,
    gasPrice: BigNumber.from(2000000000000),
    type: 1,
  }

  const transactionResponse = await alice.sendTransaction(transaction)
  return transactionResponse
}

export const resetFork = async (
  blockNumber: number = 20010000,
  rpcUrl: string = `https://rpc.ankr.com/eth/${process.env.ANKR_API_KEY}`
) => {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: rpcUrl,
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

export const PERMIT2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI) as IPermit2

export const INTEGRAL_NFT_POSITION_MANAGER = new ethers.Contract(
  INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
  INonfungiblePositionManager_ABI
) as INonfungiblePositionManager

export const UNISWAP_NFT_POSITION_MANAGER = new ethers.Contract(
  UNISWAP_V3_NFT_POSITION_MANAGER_MAINNET,
  IUniswapNonfungiblePositionManager_ABI
) as IUniswapPoolInitializer
