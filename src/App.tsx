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

  const TezosToken: NativeTezosToken = useMemo(() => ({ type: 'native' }), [])

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

  const networkLabel = useMemo(() => {
    const n = String(config.network).toLowerCase()
    return n.charAt(0).toUpperCase() + n.slice(1)
  }, [config.network])

  const onMax = useCallback(() => {
    if (!address) {
      setAmountMessage('Please connect a wallet first')
      return
    }
    setAmount(balance || '')
    if (balance) verifyAmount(balance)
  }, [address, balance, verifyAmount])

  return (
    <div style={{ minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h1 style={{ marginBottom: '1rem' }}>Tezlink Bridge</h1>

        {/* Main card */}
        <div
          style={{
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(20,20,20,0.9)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
            padding: 16,
          }}
        >
          {/* Header row: token + network */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              paddingBottom: 12,
              borderBottom: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src={tezlinkLogo}
                alt="XTZ"
                style={{ width: 26, height: 26, borderRadius: 6 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Token</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>XTZ</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Network</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{networkLabel}</span>
            </div>
          </div>

          {/* Amount row */}
          <form onSubmit={handleSubmit} style={{ marginTop: 14 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {/* Max */}
              <button
                type="button"
                onClick={onMax}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.85)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Max
              </button>

              {/* Input */}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={e => {
                    verifyAmount(e.target.value)
                    setAmount(e.target.value)
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.25)',
                    color: 'rgba(255,255,255,0.92)',
                    outline: 'none',
                    fontSize: 18,
                    fontWeight: 600,
                  }}
                />
                {amountMessage && (
                  <div style={{ marginTop: 8, color: '#ff6b6b', fontSize: 13 }}>
                    {amountMessage}
                  </div>
                )}
              </div>

              {/* Balance */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Balance</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {balance !== '' ? balance : '-'}
                </div>
              </div>
            </div>

            {/* Action row */}
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                gap: 12,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {address ? (
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Connected
                  <span style={{ marginLeft: 8, opacity: 0.8 }}>
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.7 }}>Not connected</div>
              )}

              {address ? (
                loading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CircularProgress size={22} />
                    <span style={{ fontSize: 13, opacity: 0.8 }}>Processing…</span>
                  </div>
                ) : (
                  <button
                    type="submit"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: 'rgba(255,255,255,0.10)',
                      color: 'rgba(255,255,255,0.92)',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 700,
                      minWidth: 120,
                    }}
                  >
                    Send ꜩ
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={connectWallet}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255, 59, 48, 0.75)',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                    minWidth: 140,
                  }}
                >
                  Connect wallet
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Small footer hint */}
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.55 }}>
          Deposit XTZ from Tezos to Tezlink.
        </div>
      </div>
    </div>
  )
}
