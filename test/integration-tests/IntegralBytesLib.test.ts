import { expect } from './shared/expect'
import { ethers } from 'hardhat'
import { IntegralBytesLibTest } from '../../typechain'

describe('IntegralBytesLib Tests', () => {
  let bytesLibTest: IntegralBytesLibTest

  beforeEach(async () => {
    const factory = await ethers.getContractFactory('IntegralBytesLibTest')
    bytesLibTest = (await factory.deploy()) as IntegralBytesLibTest
  })

  describe('toPool', () => {
    it('correctly decodes path with default deployer', async () => {
      const token0 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // BASE_USDC
      const deployer = '0x05f3bd357d47d159ac7d33f9dbaacfc65d31976d' // DEFAULT_POOL_DEPLOYER (BASE)
      const token1 = '0x4200000000000000000000000000000000000006' // BASE_WETH

      // Encode path: token0 (20 bytes) + deployer (20 bytes) + token1 (20 bytes)
      const path = token0.toLowerCase() + deployer.slice(2).toLowerCase() + token1.slice(2).toLowerCase()

      const result = await bytesLibTest.toPool(path)

      expect(result.token0.toLowerCase()).to.equal(token0.toLowerCase())
      expect(result.deployer.toLowerCase()).to.equal(deployer.toLowerCase())
      expect(result.token1.toLowerCase()).to.equal(token1.toLowerCase())
    })

    it('correctly decodes path with custom deployer', async () => {
      const token0 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // BASE_USDC
      const customDeployer = '0xf3b57fe4d5d0927c3a5e549cb6af1866687e2d62'
      const token1 = '0x4200000000000000000000000000000000000006' // BASE_WETH

      // Encode path: token0 (20 bytes) + deployer (20 bytes) + token1 (20 bytes)
      const path =
        token0.toLowerCase() + customDeployer.slice(2).toLowerCase() + token1.slice(2).toLowerCase()

      const result = await bytesLibTest.toPool(path)

      expect(result.token0.toLowerCase()).to.equal(token0.toLowerCase())
      expect(result.deployer.toLowerCase()).to.equal(customDeployer.toLowerCase())
      expect(result.token1.toLowerCase()).to.equal(token1.toLowerCase())
    })

    it('correctly decodes multihop path (first pool)', async () => {
      const token0 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // BASE_USDC
      const deployer1 = '0xf3b57fe4d5d0927c3a5e549cb6af1866687e2d62'
      const token1 = '0x4200000000000000000000000000000000000006' // BASE_WETH
      const deployer2 = '0x05f3bd357d47d159ac7d33f9dbaacfc65d31976d'
      const token2 = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' // BASE_DAI

      // Encode multihop path: token0 + deployer1 + token1 + deployer2 + token2
      const path =
        token0.toLowerCase() +
        deployer1.slice(2).toLowerCase() +
        token1.slice(2).toLowerCase() +
        deployer2.slice(2).toLowerCase() +
        token2.slice(2).toLowerCase()

      const result = await bytesLibTest.toPool(path)

      // Should return first pool only
      expect(result.token0.toLowerCase()).to.equal(token0.toLowerCase())
      expect(result.deployer.toLowerCase()).to.equal(deployer1.toLowerCase())
      expect(result.token1.toLowerCase()).to.equal(token1.toLowerCase())
    })

    it('reverts on path too short', async () => {
      // Path with only 40 bytes (token0 + deployer), missing token1
      const invalidPath = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913f3b57fe4d5d0927c3a5e549cb6af1866687e2d62'

      await expect(bytesLibTest.toPool(invalidPath)).to.be.revertedWithCustomError(
        bytesLibTest,
        'IntegralPathError'
      )
    })
  })
})
