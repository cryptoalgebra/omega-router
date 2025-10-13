import hre from 'hardhat'
const { ethers } = hre
import { UniversalRouter } from '../../../typechain'
import {
  UNISWAP_V2_FACTORY_MAINNET,
  UNISWAP_V3_FACTORY_MAINNET,
  UNISWAP_V2_INIT_CODE_HASH_MAINNET,
  UNISWAP_V3_INIT_CODE_HASH_MAINNET,
  PERMIT2_ADDRESS,
  INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
  INTEGRAL_POOL_DEPLOYER,
  INTEGRAL_FACTORY_MAINNET,
  INTEGRAL_INIT_CODE_HASH_MAINNET,
} from './constants'
import { MAINNET_WETH } from './mainnetForkHelpers'

export async function deployRouter(mockReentrantWETH?: string): Promise<UniversalRouter> {
  const routerParameters = {
    permit2: PERMIT2_ADDRESS,
    weth: mockReentrantWETH ?? MAINNET_WETH.address,
    uniswapV2Factory: UNISWAP_V2_FACTORY_MAINNET,
    uniswapV3Factory: UNISWAP_V3_FACTORY_MAINNET,
    uniswapPairInitCodeHash: UNISWAP_V2_INIT_CODE_HASH_MAINNET,
    uniswapPoolInitCodeHash: UNISWAP_V3_INIT_CODE_HASH_MAINNET,
    integralFactory: INTEGRAL_FACTORY_MAINNET,
    integralPoolDeployer: INTEGRAL_POOL_DEPLOYER,
    integralPosManager: INTEGRAL_NFT_POSITION_MANAGER_MAINNET,
    integralPoolInitCodeHash: INTEGRAL_INIT_CODE_HASH_MAINNET,
  }

  const routerFactory = await ethers.getContractFactory('UniversalRouter')
  const router = (await routerFactory.deploy(routerParameters)) as unknown as UniversalRouter
  return router
}

export default deployRouter
