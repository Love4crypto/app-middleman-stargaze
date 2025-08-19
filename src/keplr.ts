import { SigningCosmWasmClient, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';

interface KeplrLike {
  enable: (chainId: string) => Promise<void>;
  experimentalSuggestChain?: (config: any) => Promise<void>;
}

declare global {
  interface Window { keplr?: KeplrLike; getOfflineSigner?: (chainId: string) => any; }
}

export async function suggestStargazeIfNeeded(rpc: string, chainId: string) {
  if (!window.keplr) throw new Error('Keplr extension not found');
  if (window.keplr.experimentalSuggestChain) {
    try {
      await window.keplr.experimentalSuggestChain({
        chainId,
        chainName: 'Stargaze',
        rpc,
        rest: 'https://rest.stargaze-apis.com',
        bip44: { coinType: 118 },
        bech32Config: {
          bech32PrefixAccAddr: 'stars',
          bech32PrefixAccPub: 'starspub',
          bech32PrefixValAddr: 'starsvaloper',
          bech32PrefixValPub: 'starsvaloperpub',
          bech32PrefixConsAddr: 'starsvalcons',
          bech32PrefixConsPub: 'starsvalconspub'
        },
        currencies: [ { coinDenom: 'STARS', coinMinimalDenom: 'ustars', coinDecimals: 6 } ],
        feeCurrencies: [ { coinDenom: 'STARS', coinMinimalDenom: 'ustars', coinDecimals: 6, gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 } } ],
        stakeCurrency: { coinDenom: 'STARS', coinMinimalDenom: 'ustars', coinDecimals: 6 },
        features: ['cosmwasm','ibc-transfer']
      });
    } catch {/* ignore */}
  }
}

export async function connectKeplr(rpc: string, chainId: string, gasPrice = '0.025ustars') {
  if(!window.keplr) throw new Error('Keplr extension not found');
  await suggestStargazeIfNeeded(rpc, chainId);
  await window.keplr.enable(chainId);
  const getOfflineSigner = window.getOfflineSigner;
  if (!getOfflineSigner) throw new Error('getOfflineSigner not available');
  const offlineSigner = getOfflineSigner(chainId);
  const accounts = await offlineSigner.getAccounts();
  if(!accounts.length) throw new Error('No accounts from signer');
  const address = accounts[0].address;
  const signingClient = await SigningCosmWasmClient.connectWithSigner(rpc, offlineSigner, { gasPrice: GasPrice.fromString(gasPrice) });
  return { signingClient, address };
}

export async function makeQueryClient(rpc: string) {
  return CosmWasmClient.connect(rpc);
}

export type KeplrConnectResult = Awaited<ReturnType<typeof connectKeplr>>;
