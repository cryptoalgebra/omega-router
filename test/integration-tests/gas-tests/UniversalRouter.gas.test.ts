import { UniversalRouter } from '../../../typechain'
import { expect } from '../shared/expect'
import { MAINNET_ALICE_ADDRESS } from '../shared/constants'
import { resetFork, } from '../shared/mainnetForkHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import hre from 'hardhat'
import deployUniversalRouter from '../shared/deployUniversalRouter'

const { ethers } = hre

describe('UniversalRouter Gas Tests', () => {
  let alice: SignerWithAddress
  let router: UniversalRouter

  beforeEach(async () => {
    await resetFork()
    alice = await ethers.getSigner(MAINNET_ALICE_ADDRESS)
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MAINNET_ALICE_ADDRESS],
    })
    router = (await deployUniversalRouter()).connect(alice) as UniversalRouter
  })

  it('gas: bytecode size', async () => {
    expect(((await router.provider.getCode(router.address)).length - 2) / 2).to.matchSnapshot()
  })
})
