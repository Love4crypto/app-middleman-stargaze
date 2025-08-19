// wallet.ts
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';

type OfflineSigner = any;

interface InjectedWallet {
  enable: (chainId: string) => Promise<void>;
  experimentalSuggestChain?: (config: any) => Promise<void>;
  getOfflineSigner?: (chainId: string) => OfflineSigner;
  getOfflineSignerAuto?: (chainId: string) => Promise<OfflineSigner>;
}

declare global {
  interface Window {
    keplr?: InjectedWallet;
    leap?: InjectedWallet;
    // Keplr (and Leap) also expose a legacy global getter in many builds:
    getOfflineSigner?: (chainId: string) => OfflineSigner;
  }
}

export type WalletKind = 'auto' | 'keplr' | 'leap';

const DEFAULT_GAS_PRICE = '0.025ustars'; // matches your working keplr.ts

async function suggestStargazeIfNeededGeneric(
  wallet: InjectedWallet,
  rpc: string,
  chainId: string
) {
  if (!wallet.experimentalSuggestChain) return;
  try {
    await wallet.experimentalSuggestChain({
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
        bech32PrefixConsPub: 'starsvalconspub',
      },
      currencies: [
        { coinDenom: 'STARS', coinMinimalDenom: 'ustars', coinDecimals: 6 },
      ],
      feeCurrencies: [
        {
          coinDenom: 'STARS',
          coinMinimalDenom: 'ustars',
          coinDecimals: 6,
          gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
        },
      ],
      stakeCurrency: {
        coinDenom: 'STARS',
        coinMinimalDenom: 'ustars',
        coinDecimals: 6,
      },
      features: ['cosmwasm', 'ibc-transfer'],
    });
  } catch {
    // ignore suggest errors; chain may already be known
  }
}

function pickWallet(preferred: WalletKind): { wallet?: InjectedWallet; type?: 'keplr' | 'leap' } {
  if (preferred === 'keplr' && window.keplr) return { wallet: window.keplr, type: 'keplr' };
  if (preferred === 'leap' && window.leap) return { wallet: window.leap, type: 'leap' };

  // auto: prefer Leap if both are present
  if (window.leap) return { wallet: window.leap, type: 'leap' };
  if (window.keplr) return { wallet: window.keplr, type: 'keplr' };
  return {};
}

async function getAnyOfflineSigner(
  chainId: string,
  wallet?: InjectedWallet
): Promise<OfflineSigner> {
  // Modern path on both Leap & Keplr
  if (wallet?.getOfflineSignerAuto) return wallet.getOfflineSignerAuto(chainId);
  // Legacy global (Keplr-compatible, also present in Leap builds)
  if (window.getOfflineSigner) return window.getOfflineSigner(chainId);
  // Wallet-local legacy
  if (wallet?.getOfflineSigner) return wallet.getOfflineSigner(chainId);
  throw new Error('No offline signer available from the injected wallet');
}

/**
 * Universal connector for injected Cosmos wallets (Leap or Keplr).
 * - `preferred`: choose which wallet to use ('auto' prefers Leap when both are installed)
 * - sets a default gasPrice so "auto" fees work in execute/instantiate/etc
 */
export async function connectInjected(
  rpc: string,
  chainId: string,
  preferred: WalletKind = 'auto',
  opts?: { gasPrice?: string }
) {
  const { wallet, type } = pickWallet(preferred);
  if (!wallet) throw new Error('Please install Leap or Keplr');

  // Make sure the chain is registered (no-op if already known)
  await suggestStargazeIfNeededGeneric(wallet, rpc, chainId);

  // Request permissions
  await wallet.enable(chainId);

  // Get signer (supports modern + legacy APIs)
  const offlineSigner = await getAnyOfflineSigner(chainId, wallet);
  const accounts = await offlineSigner.getAccounts();
  if (!accounts?.length) throw new Error('No accounts from signer');
  const address = accounts[0].address;

  // Create client with a gasPrice so "fee: auto" works
  const signingClient = await SigningCosmWasmClient.connectWithSigner(rpc, offlineSigner, {
    // prefix: 'stars', // optional; CosmJS derives from bech32 address, safe to omit
    gasPrice: GasPrice.fromString(opts?.gasPrice ?? DEFAULT_GAS_PRICE),
  });

  const walletType: 'keplr' | 'leap' = type ?? (wallet === window.leap ? 'leap' : 'keplr');
  return { signingClient, address, walletType } as const;
}

export type ConnectInjectedResult = Awaited<ReturnType<typeof connectInjected>>;
