/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_PEGASUS_CONTRACT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
