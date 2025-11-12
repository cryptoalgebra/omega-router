import { CommandType, RoutePlanner } from '../shared/planner'
import { OmegaRouter } from '../../../typechain'
import snapshotGasCost from '@uniswap/snapshot-gas-cost'
import { resetFork, MAINNET_USDC } from '../shared/mainnetForkHelpers'
import { MAINNET_ALICE_ADDRESS, DEADLINE } from '../shared/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import hre from 'hardhat'
import deployOmegaRouter from '../shared/deployOmegaRouter'
import { abi as TOKEN_ABI } from '../../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
const { ethers } = hre

describe('Check Ownership Gas', () => {
  let alice: SignerWithAddress
  let router: OmegaRouter
  let planner: RoutePlanner

  beforeEach(async () => {
    await resetFork()
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MAINNET_ALICE_ADDRESS],
    })
    alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
    router = (await deployOmegaRouter()).connect(alice) as OmegaRouter
    planner = new RoutePlanner()
  })

  it('gas: balance check ERC20', async () => {
    const usdcContract = new ethers.Contract(MAINNET_USDC.address, TOKEN_ABI, alice)
    const aliceUSDCBalance = await usdcContract.balanceOf(MAINNET_ALICE_ADDRESS)

    planner.addCommand(CommandType.BALANCE_CHECK_ERC20, [MAINNET_ALICE_ADDRESS, MAINNET_USDC.address, aliceUSDCBalance])

    const { commands, inputs } = planner
    await snapshotGasCost(router['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE))
  })
})
