import { useEffect, useState, useCallback, useMemo } from 'react'
import tezlinkLogo from './assets/XTZ.png'
import './App.css'

import { TezosToolkit, type Signer } from '@taquito/taquito'
import { b58cdecode, b58decode, prefix } from '@taquito/utils'
import {
  DefaultDataProvider,
  TokenBridge,
  TaquitoWalletTezosBridgeBlockchainService,
  Web3EtherlinkBridgeBlockchainService,
  type TokenPair,
  type NativeTezosToken,
} from '@baking-bad/tezos-etherlink-bridge-sdk'
import { BeaconWallet } from '@taquito/beacon-wallet'
import { NetworkType } from '@airgap/beacon-types'
import { SigningType } from '@airgap/beacon-dapp'
import Web3 from 'web3'
import { Buffer } from 'buffer'
import RLP from 'rlp'
import CircularProgress from '@mui/material/CircularProgress'

window.global = window
window.Buffer = Buffer

class BeaconSigner implements Signer {
  wallet: BeaconWallet

  constructor(wallet: BeaconWallet) {
    this.wallet = wallet
  }

  async publicKey(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount()
    if (!account) throw new Error('No active account')
    return account.publicKey!
  }

  async publicKeyHash(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount()
    if (!account) throw new Error('No active account')
    return account.address
  }

  async secretKey(): Promise<string | undefined> {
    // Wallets never expose secret keys
    return undefined
  }

  async sign(bytes: string) {
    const signed = await this.wallet.client.requestSignPayload({
      signingType: SigningType.OPERATION,
      payload: '03' + bytes,
    })

    const sigHex = Buffer.from(
      b58cdecode(signed.signature, prefix.edsig)
    ).toString('hex')

    return {
      bytes,
      sig: sigHex,
      prefixSig: signed.signature,
      sbytes: bytes + sigHex,
    }
  }
}

export default function App() {
  const toNetworkType = (value: string): NetworkType | undefined =>
    Object.values(NetworkType).includes(value as NetworkType)
      ? (value as NetworkType)
      : undefined

  const config = useMemo(() => {
    let network = NetworkType.SHADOWNET
    let tezosRpcUrl = 'https://rpc.tzkt.io/'

    const envNetwork = toNetworkType(import.meta.env.VITE_NETWORK)
    const envEndpoint = import.meta.env.VITE_ENDPOINT

    if (envNetwork) {
      network = envNetwork
      if (
        network === NetworkType.SHADOWNET ||
        network === NetworkType.MAINNET ||
        network === NetworkType.GHOSTNET
      ) {
        tezosRpcUrl += network
      } else if (envEndpoint) {
        tezosRpcUrl = envEndpoint
      }
    } else {
      tezosRpcUrl += network
    }

    const tzkt =
      network === NetworkType.SHADOWNET ||
        network === NetworkType.MAINNET ||
        network === NetworkType.GHOSTNET
        ? `https://api.${network}.tzkt.io`
        : import.meta.env.VITE_TZKT ?? `https://api.shadownet.tzkt.io`

    return {
      network,
      tezosRpcUrl,
      tzkt,
      depositContract:
        import.meta.env.VITE_CONTRACT ??
        'KT1JmSDcDPyBzFCJ2uTzqKhCtpRvxARzjDrh',
      rollup:
        import.meta.env.VITE_ROLLUP ??
        'sr1HdigX2giB8rNK4fx3xH9p4AyybvUUG5bH',
    }
  }, [])

  const web3 = useMemo(() => new Web3(), [])

  const tezosToolkit = useMemo(
    () => new TezosToolkit(config.tezosRpcUrl),
    [config.tezosRpcUrl]
  )

  const wallet = useMemo(
    () =>
      new BeaconWallet({
        name: 'Tezlink Bridge',
        iconUrl: tezlinkLogo,
        preferredNetwork: config.network,
        enableMetrics: true,
      }),
    [config.network]
  )

  const signer = useMemo(() => new BeaconSigner(wallet), [wallet])

  const tokenPairs: TokenPair[] = useMemo(
    () => [
      {
        tezos: {
          type: 'native',
          ticketHelperContractAddress: config.depositContract,
        },
        etherlink: { type: 'native' },
      },
    ],
    [config.depositContract]
  )

  const dataProvider = useMemo(
    () =>
      new DefaultDataProvider({
        dipDup: {
          baseUrl: 'https://testnet.bridge.indexer.etherlink.com',
          webSocketApiBaseUrl: 'wss://testnet.bridge.indexer.etherlink.com',
        },
        tzKTApiBaseUrl: config.tzkt,
        etherlinkRpcUrl: 'https://node.ghostnet.etherlink.com',
        tokenPairs,
      }),
    [config.tzkt, tokenPairs]
  )

  const tokenBridge = useMemo(
    () =>
      new TokenBridge({
        tezosBridgeBlockchainService:
          new TaquitoWalletTezosBridgeBlockchainService({
            tezosToolkit,
            smartRollupAddress: config.rollup,
          }),
        etherlinkBridgeBlockchainService:
          new Web3EtherlinkBridgeBlockchainService({ web3 }),
        bridgeDataProviders: {
          transfers: dataProvider,
          balances: dataProvider,
          tokens: dataProvider,
        },
      }),
    [tezosToolkit, web3, dataProvider, config.rollup]
  )

  const TezosToken: NativeTezosToken = useMemo(
    () => ({ type: 'native' }),
    []
  )

  const [amount, setAmount] = useState('')
  const [amountMessage, setAmountMessage] = useState('')
  const [balance, setBalance] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchBalance = useCallback(
    async (addr: string) => {
      const mutez = await tezosToolkit.tz.getBalance(addr)
      return String(mutez.toNumber() / 1_000_000)
    },
    [tezosToolkit]
  )

  const connectWallet = useCallback(async () => {
    await wallet.requestPermissions()
    setAddress(await wallet.getPKH())
    setAmountMessage('')
  }, [wallet])

  const verifyAmount = useCallback(
    (value: string) => {
      if (!address) {
        setAmountMessage('Please connect a wallet first')
        return false
      }
      const n = Number(value)
      if (Number.isNaN(n)) return setAmountMessage('Invalid amount'), false
      if (n < 0) return setAmountMessage('Negative amount'), false
      if (n > Number(balance))
        return setAmountMessage('Insufficient balance'), false
      setAmountMessage('')
      return true
    },
    [address, balance]
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!verifyAmount(amount)) return

      const mutez = BigInt(Number(amount) * 1_000_000)
      const addr = b58decode(address)
      const data = Buffer.from(addr, 'hex')
      const payload =
        '01' + Buffer.from(RLP.encode([[1, data], []])).toString('hex')

      tezosToolkit.setWalletProvider(wallet)
      tezosToolkit.setSignerProvider(signer)

      setLoading(true)
      const { operationResult } = await tokenBridge.deposit(
        mutez,
        TezosToken,
        payload
      )

      await operationResult.operation.confirmation(3)
      setLoading(false)
      setBalance(await fetchBalance(address))
    },
    [
      amount,
      address,
      verifyAmount,
      wallet,
      signer,
      tokenBridge,
      tezosToolkit,
      fetchBalance,
      TezosToken,
    ]
  )

  useEffect(() => {
    if (!address) return
    fetchBalance(address).then(setBalance).catch(() => setBalance(''))
  }, [address, fetchBalance])

  return (
    <>
      <h1>Tezlink Bridge</h1>

      <form onSubmit={handleSubmit}>
        <input
          value={amount}
          onChange={e => {
            verifyAmount(e.target.value)
            setAmount(e.target.value)
          }}
        />

        {amountMessage && <p style={{ color: 'red' }}>{amountMessage}</p>}

        {loading ? (
          <CircularProgress />
        ) : (
          <button type="submit">Send ꜩ</button>
        )}
      </form>

      {address ? (
        <div>Connected</div>
      ) : (
        <button onClick={connectWallet}>Connect wallet</button>
      )}
    </>
  )
}
