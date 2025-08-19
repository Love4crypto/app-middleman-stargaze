export {};

declare global {
  interface Window {
    keplr?: any;
    getOfflineSigner?: (chainId: string) => any;
  }
}
