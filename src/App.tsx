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
} from '@baking-bad/tezos-etherlink-bridge-sdk'
import { BeaconWallet } from '@taquito/beacon-wallet';
import { NetworkType } from '@airgap/beacon-types'
import Web3 from 'web3';
import { SigningType } from '@airgap/beacon-dapp';
import { Buffer } from 'buffer';
import RLP from 'rlp';
import CircularProgress from '@mui/material/CircularProgress';
(window as any).global = window;
(window as any).Buffer = Buffer;



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


function App() {

  // Function to convert a String to a NetworkType
  // NetworkType is an enum provided by beacon library
  const toNetworkType = (value: string): NetworkType | undefined =>
    Object.values(NetworkType).includes(value as NetworkType)
      ? (value as NetworkType)
      : undefined;

  // Use MetaMask
  const web3 = new Web3();

  /** SETUP VARIABLE FOR THE FRONTEND TO WORK ON THE EXPECTED NETWORK */

  // The app is parametrized by multiple argument in the .env file
  let tezosRpcUrl = 'https://rpc.tzkt.io/';
  let network = NetworkType.SHADOWNET;
  // The network is a string that can be converted to a beacon NetworkType
  // It can "mainnet" "ghostnet" "shadownet" "custom" ...
  // By default, if the env variable is not found the network will be shadownet
  const env_network = toNetworkType(import.meta.env.VITE_NETWORK);
  const env_endpoint = import.meta.env.VITE_ENDPOINT;

  if (env_network !== undefined) {
    network = env_network;
    if (network == NetworkType.SHADOWNET || network == NetworkType.MAINNET || network == NetworkType.GHOSTNET) {
      // If network is one of the three "main" network, let's use tkzt endpoint
      tezosRpcUrl += env_network;
    } else {
      // Otherwise we need to have an endpoint provided
      if (env_endpoint !== undefined) {
        tezosRpcUrl = env_endpoint;
      } else {
        console.log('No endpoint given despite a custom network, switching to shadownet')
        network = NetworkType.SHADOWNET;
        tezosRpcUrl += network;
      }
    }
  } else {
    // If we can't parse the env_network we setup the endpoint to switching to default network
    console.log('Network is unparsable, switching to default network: ' + env_network)
    tezosRpcUrl += network;
  }



  let tzkt = 'https://api.shadownet.tzkt.io';

  if (network == NetworkType.SHADOWNET || network == NetworkType.MAINNET || network == NetworkType.GHOSTNET) {
    // If the network is one of the 3 "main" network we can just pick the api of tzkt
    tzkt = `https://api.${network}.tzkt.io`;
  } else {
    // If not, we seatch for a tzkt api endpoint
    const env_tzkt = import.meta.env.VITE_TZKT;
    if (env_tzkt !== undefined) {
      tzkt = env_tzkt;
    } else {
      // If there's no tzkt api endpoint we switch back to shadownet
      console.log('No tzkt api provided despite a custom network, switching to shadownet');
      network = NetworkType.SHADOWNET;
      tezosRpcUrl = `https://rpc.tzkt.io/${network}`;
    }
  }

  // The deposit contract, by default it's the one for the Tezlink alphanet on shadownet
  let deposit_contract = 'KT1JmSDcDPyBzFCJ2uTzqKhCtpRvxARzjDrh'
  const env_deposit_contract = import.meta.env.VITE_CONTRACT;

  if (env_deposit_contract !== undefined) {
    deposit_contract = env_deposit_contract;
  }

  // The rollup address of the Tezlink network, by default it's the address of the Tezlink alphanet rollup
  let rollup = 'sr1HdigX2giB8rNK4fx3xH9p4AyybvUUG5bH';
  const env_rollup = import.meta.env.VITE_ROLLUP;
  if (env_rollup !== undefined) {
    rollup = env_rollup;
  }

  /** BUILD OBJECTS NECESSARY TO WORK WITH THE DEPOSIT LIBRARY FROM BAKING-BAD */

  const TezosToken: NativeTezosToken = {
    type: 'native',
  };

  const options = {
    name: 'Tezlink Bridge',
    iconUrl: tezlinkLogo,
    preferredNetwork: network,
    enableMetrics: true,
  };

  const wallet = new BeaconWallet(options);

  // Means that it's a deposit of Native Tezos tokens
  const tokenPairs: TokenPair[] =
    [{
      tezos: {
        type: 'native',
        ticketHelperContractAddress: deposit_contract,
      },
      etherlink: {
        type: 'native',
      }
    }];


  // I didn't know what to put here so I kept the default one
  const defaultDataProvider = new DefaultDataProvider({
    dipDup: {
      baseUrl: 'https://testnet.bridge.indexer.etherlink.com',
      webSocketApiBaseUrl: 'wss://testnet.bridge.indexer.etherlink.com'
    },
    tzKTApiBaseUrl: tzkt,
    etherlinkRpcUrl: 'https://node.ghostnet.etherlink.com',
    tokenPairs
  })

  let tezosToolkit = new TezosToolkit(tezosRpcUrl);

  const tokenBridge = new TokenBridge({
    tezosBridgeBlockchainService: new TaquitoWalletTezosBridgeBlockchainService({
      tezosToolkit: tezosToolkit,
      smartRollupAddress: rollup
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

  // The amount of the deposit
  const [am, setAmount] = useState('');
  // An error message, if the user type an incorrect amount
  const [amountMessage, setamountMessage] = useState<string>('');
  // The balance of the connected user
  const [balance, setBalance] = useState<string>('');
  // The address of the connected user, this variable is mostly
  // used to know when the user is connected
  const [address, setAddress] = useState<string>('');
  // A boolean to let the user know if the bridge is processing its deposit
  const [load, setLoad] = useState(false);


  // Verify the valididty of the amount typed by the user
  const verify_validity = (amount: string) => {
    if (address == '') {
      setamountMessage("Please connect a wallet first")
      return false;
    }
    let numAmount = Number(amount);
    let numBalance = Number(balance);
    if (Number.isNaN(numAmount)) {
      setamountMessage("Please use a valid amount")
      return false;
    } else if (numAmount > numBalance) {
      setamountMessage("You can't deposit more than your balance")
      return false;
    } else if (numAmount < 0) {
      setamountMessage("You can't deposit a negative amount")
      return false;
    } else {
      setamountMessage('')
      return true;
    }
  }


  const connectWallet = async () => {
    await wallet.requestPermissions();

    const userAddress = await wallet.getPKH();

    // When the user is not connected, he can't type anything in the
    // amount field and there's an error messag. So we clear the error
    // message when he is connected.
    setamountMessage('');

    // Set the address to trigger the fact that the user is connected
    setAddress(userAddress);
  };

  // Not much to say function to retrieve the balance of the connected user
  // To print it
  const fetchBalance = async () => {
    console.log("Fetch the balance of the address connected");
    if (address == '') {
      setBalance('');
      return;
    }

    try {
      const mutez = await tezosToolkit.tz.getBalance(address);
      const xtz = mutez.toNumber() / 1_000_000;

      setBalance(xtz.toString());
      console.log("Balance has been set");
    } catch (err) {
      console.error("Error balance", err);
      setBalance('');
    }
  };

  // Hook to trigger the fetch balance function when the address variable is changed
  useEffect(() => {
    fetchBalance();
  }, [address]);

  // Function to handle the submission of a deposit
  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!verify_validity(am)) {
      return;
    }

    // At this point the amount should be valid (below the balance and correct)
    let numAmount = Number(am);
    let addr = b58decode(address);
    const data = Buffer.from(addr, 'hex');
    let array = RLP.encode([[1, data], []]);
    const hex = Buffer.from(array).toString('hex');
    let mutez = numAmount * 1_000_000;

    // Those two provider are important, the first one is necessary to print correctly
    // the operation in umami, the second is obviously necessary to sign the operation
    tezosToolkit.setWalletProvider(wallet);
    tezosToolkit.setSignerProvider(new BeaconSigner(wallet));

    const { tokenTransfer: _, operationResult } = await tokenBridge.deposit(BigInt(mutez), TezosToken, "01" + hex);
    
    // Set the load boolean to true to notify the user that its deposit is being processed
    setLoad(true);

    // We await the confirmation and inclusion in the chain for the deposit
    let result = await operationResult.operation.confirmation(3);

    // When the operation is completed, set the load boolean to not completed (which is false if the operation is completed)
    setLoad(!result?.completed);

    // To let the user keep a track of its balance we fetch it again to reprint it
    fetchBalance()
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
                      verify_validity(amount)
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

          {load ? <CircularProgress /> : <button type="submit" style={{ padding: '10px 16px', cursor: 'pointer' }}>
            Send ꜩ
          </button>}
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
