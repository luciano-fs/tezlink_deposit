import { useEffect, useState } from 'react'
import tezlinkLogo from './assets/XTZ.png'
import './App.css'
import { TezosToolkit, type Signer } from '@taquito/taquito';
import { b58cdecode, b58decode, prefix } from '@taquito/utils';
import {
  DefaultDataProvider,
  TokenBridge,
  TaquitoWalletTezosBridgeBlockchainService,
  Web3EtherlinkBridgeBlockchainService,
  type TokenPair,
  type NativeTezosToken,
  BridgeTokenTransferStatus
} from 'tezlink-bridge'
import { BeaconWallet } from '@taquito/beacon-wallet';
import { NetworkType } from '@airgap/beacon-types'
import Web3 from 'web3';
import { SigningType } from '@airgap/beacon-dapp';
import { Buffer } from 'buffer';
import RLP from 'rlp';
(window as any).global = window;
(window as any).Buffer = Buffer;

// Use MetaMask
const web3 = new Web3();

const tezosRpcUrl = 'https://rpc.tzkt.io/shadownet/';
// const tezosRpcUrl = 'http://127.0.0.1:36797';

const TezosToken: NativeTezosToken = {
  type: 'native',
};

const options = {
  name: 'Tezlink Bridge',
  iconUrl: tezlinkLogo,
  // preferredNetwork: NetworkType.CUSTOM,
  preferredNetwork: NetworkType.SHADOWNET,
  enableMetrics: true,
};

const wallet = new BeaconWallet(options);

// Native
const tokenPairs: TokenPair[] =
  [{
    tezos: {
      type: 'native',
      // ticketHelperContractAddress: 'KT1UDCJyj2ghpqYXZN7JHhueVLg2c5X5JVZo',
      ticketHelperContractAddress: 'KT1LH9e9MnRVeW8iirvQUQgCpcDYCHrHfJqy',
    },
    etherlink: {
      type: 'native',
    }
  }];

const defaultDataProvider = new DefaultDataProvider({
  dipDup: {
    baseUrl: 'https://testnet.bridge.indexer.etherlink.com',
    webSocketApiBaseUrl: 'wss://testnet.bridge.indexer.etherlink.com'
  },
  // tzKTApiBaseUrl: 'http://localhost:5000',
  tzKTApiBaseUrl: 'https://api.shadownet.tzkt.io',
  etherlinkRpcUrl: 'https://node.ghostnet.etherlink.com',
  tokenPairs
})

class BeaconSigner implements Signer {
  wallet: BeaconWallet;

  constructor(wallet: BeaconWallet) {
    this.wallet = wallet;
  }

  // Required methods of the Signer interface:
  async publicKey(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount();
    if (!account) throw new Error('No active account');
    return account.publicKey!;
  }

  async publicKeyHash(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount();
    if (!account) throw new Error('No active account');
    return account.address;
  }

  async secretKey(): Promise<string | undefined> {
    // Wallets never expose secret keys
    return undefined;
  }

  async sign(bytes: string, _magicByte?: Uint8Array): Promise<{
    bytes: string;
    sig: string;
    prefixSig: string;
    sbytes: string;
  }> {
    // Use the wallet to sign the bytes
    const signed = await this.wallet.client.requestSignPayload({
      signingType: SigningType.OPERATION,
      payload: "03" + bytes,
    });
    const sigHex = Buffer.from(b58cdecode(signed.signature, prefix.edsig)).toString('hex');
    return {
      bytes,
      sig: sigHex,
      prefixSig: signed.signature,
      sbytes: bytes + sigHex,
    };
  }
}


// let b58signature = await wallet.sign(bytes, magicByte);
// let signature = b58decode(b58signature);
// return {
//   bytes,
//   sig: signature,
//   prefixSig: signature,
//   sbytes: bytes,
// };

function App() {
  const [am, setAmount] = useState('');
  const [amountMessage, setamountMessage] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [address, setAddress] = useState<string>('');

  let tezosToolkit = new TezosToolkit(tezosRpcUrl);
  const tokenBridge = new TokenBridge({
    tezosBridgeBlockchainService: new TaquitoWalletTezosBridgeBlockchainService({
      tezosToolkit: tezosToolkit,
      smartRollupAddress: 'sr1M1Gn31bcNHkyLXqpJAG4XWdJEPagiYQZx'
      // smartRollupAddress: 'sr1MHLNAz2BAVNT7m9g1dKmjQritFhw1ZikF'
    }),
    etherlinkBridgeBlockchainService: new Web3EtherlinkBridgeBlockchainService({
      web3
    }),
    bridgeDataProviders: {
      transfers: defaultDataProvider,
      balances: defaultDataProvider,
      tokens: defaultDataProvider,
    }
  });

  const connectWallet = async () => {
    await wallet.requestPermissions();


    const userAddress = await wallet.getPKH();

    setamountMessage('');
    setAddress(userAddress);
  };

  useEffect(() => {
    const fetchBalance = async () => {
      if (address == '') {
        setBalance('');
        return;
      }

      try {
        const mutez = await tezosToolkit.tz.getBalance(address);
        const xtz = mutez.toNumber() / 1_000_000;

        setBalance(xtz.toString());
      } catch (err) {
        console.error("Erreur balance", err);
        setBalance('');
      }
    };

    fetchBalance();
  }, [address]);

  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault();

    if (address == '') {
      return;
    }
    let numAmount = Number(am);
    let numBalance = Number(balance);
    if (numAmount == 0) {
      setamountMessage("You must specify an amount")
      return;
    }

    if (numAmount < 0 || numAmount > numBalance) {
      return;
    }


    let addr = b58decode(address);
    const data = Buffer.from(addr, 'hex');
    let array = RLP.encode([[1, data], []]);
    const hex = Buffer.from(array).toString('hex');
    console.log("Encoded address:" + "01" + addr);
    console.log("Test:" + "01" + hex);
    console.log("Amount:" + BigInt(numAmount * 1_000_000));
    let mutez = numAmount * 1_000_000;

    tezosToolkit.setSignerProvider(new BeaconSigner(wallet));

    const { tokenTransfer, operationResult } = await tokenBridge.deposit(BigInt(mutez), TezosToken, "01" + hex);


    // Wait until the deposit status is Finished
    const finishedBridgeTokenDeposit = await tokenBridge.waitForStatus(
      tokenTransfer,
      BridgeTokenTransferStatus.Finished
    );
    console.dir(finishedBridgeTokenDeposit, { depth: null });
    console.dir(operationResult, { depth: null });

  };

  return (
    <>
      <h1>Tezlink Bridge</h1>
      <div style={{ maxWidth: '400px', margin: '2rem auto', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleSubmit}>

          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-full max-w-md">
            {/* Header: Token + Network */}
            <div className="flex justify-between pb-3 border-b border-neutral-700">
              <div className="flex items-center gap-2">
                <img src={tezlinkLogo} alt="XTZ" className="w-6 h-6" />
                <div className="flex flex-col">
                  <span className="text-sm text-neutral-400">Token</span>
                  <span className="text-white font-medium flex items-center gap-1">
                    XTZ
                  </span>
                </div>
              </div>

              <div className="flex flex-col text-right">
                <span className="text-sm text-neutral-400">Network</span>
                <span className="text-white font-medium">Tezlink</span>
              </div>
            </div>

            {/* Amount line */}
            <div className="flex justify-between items-center mt-4">
              <button type="button"
                className="px-3 py-1 text-sm bg-neutral-800 hover:bg-neutral-700 
                     border border-neutral-600 rounded-md text-neutral-300"
                onClick={() => {
                  setAmount(balance)
                }}
              >
                Max
              </button>
              <div>
                {/* Input */}
                <input
                  type="text"
                  value={am}
                  onChange={(e) => {
                    if (address == '') {
                      setamountMessage("Please connect a wallet first")
                      return;
                    } else {
                      let amount = e.target.value;
                      let numAmount = Number(amount);
                      let numBalance = Number(balance);
                      if (Number.isNaN(numAmount)) {
                        setamountMessage("Please use a valid amount")
                      } else if (numAmount > numBalance) {
                        setamountMessage("You can't deposit more than your balance")
                      } else if (numAmount < 0) {
                        setamountMessage("You can't deposit a negative amount")
                      } else {
                        setamountMessage('')
                      }
                      setAmount(amount);
                    }
                  }}
                  placeholder="0"
                  className="flex-1 bg-transparent text-xl text-neutral-200 
                     placeholder-neutral-500 outline-none"
                />

                {amountMessage && (
                  <p className="text-red-600">{amountMessage}</p>
                )}
              </div>
              {/* Balance */}
              <div className="flex flex-col text-left">
                <span className="text-sm text-neutral-400">Balance</span>
                <span className="text-white ml-1">{balance !== '' ? balance : "-"}</span>
              </div>
            </div>
          </div>

          <button type="submit" style={{ padding: '10px 16px', cursor: 'pointer' }}>
            Send ꜩ
          </button>
        </form>
        {address !== '' ? <div className="text-neutral-500 text-sm">Connected</div> : <button onClick={connectWallet} className="bg-red-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full">
          Connect wallet
        </button>
        }
      </div>
    </>
  )
}

export default App
