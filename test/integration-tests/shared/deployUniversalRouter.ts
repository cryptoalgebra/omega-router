import hre from 'hardhat'
const { ethers } = hre
import { UniversalRouter } from '../../../typechain'
import {
  V2_FACTORY_MAINNET,
  V3_FACTORY_MAINNET,
  V2_INIT_CODE_HASH_MAINNET,
  V3_INIT_CODE_HASH_MAINNET,
  PERMIT2_ADDRESS,
  V3_NFT_POSITION_MANAGER_MAINNET,
  INTEGRAL_POOL_DEPLOYER,
  WETH
} from './constants'

export async function deployRouter(
    mockReentrantWETH?: string
): Promise<UniversalRouter> {

  const routerParameters = {
    permit2: PERMIT2_ADDRESS,
    weth: mockReentrantWETH ?? WETH,
    v2Factory: V2_FACTORY_MAINNET,
    v3Factory: V3_FACTORY_MAINNET,
    integralPoolDeployer: INTEGRAL_POOL_DEPLOYER,
    pairInitCodeHash: V2_INIT_CODE_HASH_MAINNET,
    poolInitCodeHash: V3_INIT_CODE_HASH_MAINNET,
    v3NFTPositionManager: V3_NFT_POSITION_MANAGER_MAINNET,
  }

  const routerFactory = await ethers.getContractFactory('UniversalRouter')
  const router = (await routerFactory.deploy(routerParameters)) as unknown as UniversalRouter
  return router
}

export default deployRouter
