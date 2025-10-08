import { ERC20, ERC20__factory, IPermit2, INonfungiblePositionManager } from '../../../typechain'
import { abi as PERMIT2_ABI } from '../../../artifacts/permit2/src/interfaces/IPermit2.sol/IPermit2.json'
import { abi as INonfungiblePositionManager_ABI } from '../../../artifacts/@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json'
import { PERMIT2_ADDRESS, INTEGRAL_NFT_POSITION_MANAGER_MAINNET } from './constants'
import { Currency, Token, WETH9 } from '@uniswap/sdk-core'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, constants } from 'ethers'
import hre from 'hardhat'
const { ethers } = hre

export const MAINNET_WETH = WETH9[1]
export const MAINNET_DAI = new Token(1, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18, 'DAI', 'Dai Stablecoin')
export const MAINNET_USDC = new Token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'USDC', 'USD//C')
export const MAINNET_USDT = new Token(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'USDT', 'Tether USD')
export const MAINNET_GALA = new Token(1, '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA', 8, 'GALA', 'Gala')

export const BASE_WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH', 'Wrapped Ether')
export const BASE_USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC', 'USD//C')
export const BASE_DAI = new Token(8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18, 'DAI', 'Dai Stablecoin')

export const SWAP_ROUTER_V2 = '0x6f4bE24d7dC93b6ffcBAb3Fd0747c5817Cea3F9e'
export const USDC_WHALE = '0x0772f014009162efB833eF34d3eA3f243FC735Ba'

export interface MethodParameters {
    /**
     * The hex encoded calldata to perform the given operation
     */
    calldata: string;
    /**
     * The amount of ether (wei) to send in hex.
     */
    value: string;
}


export const approveSwapRouter02 = async (
  alice: SignerWithAddress,
  currency: Currency,
  overrideSwapRouter02Address?: string
) => {
  if (currency.isToken) {
    const aliceTokenIn: ERC20 = ERC20__factory.connect(currency.address, alice)

    if (currency.symbol == 'USDT') {
      await (await aliceTokenIn.approve(overrideSwapRouter02Address ?? SWAP_ROUTER_V2, 0)).wait()
    }

    return await (
      await aliceTokenIn.approve(overrideSwapRouter02Address ?? SWAP_ROUTER_V2, constants.MaxUint256)
    ).wait()
  }
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
    to: SWAP_ROUTER_V2,
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
    to: SWAP_ROUTER_V2,
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
