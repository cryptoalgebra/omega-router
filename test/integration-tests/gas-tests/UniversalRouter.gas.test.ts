import { UniversalRouter, IWETH, ERC20 } from '../../../typechain'
import { expect } from '../shared/expect'
import { ALICE_ADDRESS } from '../shared/constants'
import { abi as TOKEN_ABI } from '../../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as WETH_ABI } from '../../../artifacts/@uniswap/v4-periphery/src/interfaces/external/IWETH.sol/IWETH.json'
import { resetFork, WETH, DAI } from '../shared/mainnetForkHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import hre from 'hardhat'
import deployUniversalRouter from '../shared/deployUniversalRouter'
import { RoutePlanner } from '../shared/planner'

const { ethers } = hre

describe('UniversalRouter Gas Tests', () => {
  let alice: SignerWithAddress
  let planner: RoutePlanner
  let router: UniversalRouter
  let daiContract: ERC20
  let wethContract: IWETH

  beforeEach(async () => {
    await resetFork()
    alice = await ethers.getSigner(ALICE_ADDRESS)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [ALICE_ADDRESS],
    })
    daiContract = new ethers.Contract(DAI.address, TOKEN_ABI, alice) as ERC20
    wethContract = new ethers.Contract(WETH.address, WETH_ABI, alice) as IWETH
    router = (await deployUniversalRouter(alice.address)).connect(alice) as UniversalRouter
    planner = new RoutePlanner()
  })

  it('gas: bytecode size', async () => {
    expect(((await router.provider.getCode(router.address)).length - 2) / 2).to.matchSnapshot()
  })
})
