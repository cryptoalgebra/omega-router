import hre from 'hardhat'
const { ethers } = hre

// Router Helpers
export const MAX_UINT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
export const MAX_UINT128 = '0xffffffffffffffffffffffffffffffff'
export const MAX_UINT160 = '0xffffffffffffffffffffffffffffffffffffffff'
export const DEADLINE = 2000000000
export const CONTRACT_BALANCE = '0x8000000000000000000000000000000000000000000000000000000000000000'
export const OPEN_DELTA = 0
export const ALREADY_PAID = 0
export const ALICE_ADDRESS = '0x07aE8551Be970cB1cCa11Dd7a11F47Ae82e70E67'
export const ETH_ADDRESS = ethers.constants.AddressZero
export const ZERO_ADDRESS = ethers.constants.AddressZero
export const ONE_PERCENT_BIPS = 100
export const MSG_SENDER: string = '0x0000000000000000000000000000000000000001'
export const ADDRESS_THIS: string = '0x0000000000000000000000000000000000000002'
export const SOURCE_MSG_SENDER: boolean = true
export const SOURCE_ROUTER: boolean = false
export const DEFAULT_POOL_DEPLOYER: string = '0x0000000000000000000000000000000000000000'

// Constructor Params
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const V2_FACTORY_MAINNET = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
export const V3_FACTORY_MAINNET = '0x36077D39cdC65E1e3FB65810430E5b2c4D5fA29E'
export const INTEGRAL_POOL_DEPLOYER = '0x1595A5D101d69D2a2bAB2976839cC8eeEb13Ab94'
export const V3_INIT_CODE_HASH_MAINNET = '0xa18736c3ee97fe3c96c9428c0cc2a9116facec18e84f95f9da30543f8238a782'
export const V2_INIT_CODE_HASH_MAINNET = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
export const V3_NFT_POSITION_MANAGER_MAINNET = '0xC63E9672f8e93234C73cE954a1d1292e4103Ab86'
export const V4_POSITION_DESCRIPTOR_ADDRESS = '0x0000000000000000000000000000000000000000' // TODO, deploy this in-line and use the proper address in posm's constructor
export const WETH = '0x4200000000000000000000000000000000000006'
