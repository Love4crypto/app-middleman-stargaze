import type { OffersResponse, ParamsResponse, OfferMsgToken } from './types';
import { SigningCosmWasmClient, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';

export async function queryParams(client: CosmWasmClient, contract: string): Promise<ParamsResponse> {
  return client.queryContractSmart(contract, { params: {} });
}
export async function queryOffersBySender(client: CosmWasmClient, contract: string, sender: string): Promise<OffersResponse> {
  return client.queryContractSmart(contract, { offers_by_sender: { sender } });
}
export async function queryOffersByPeer(client: CosmWasmClient, contract: string, peer: string): Promise<OffersResponse> {
  return client.queryContractSmart(contract, { offers_by_peer: { peer } });
}

export async function createOffer(
  client: SigningCosmWasmClient,
  sender: string,
  contract: string,
  offered: OfferMsgToken[],
  wanted: OfferMsgToken[],
  peer: string,
  expires_at?: number | null,
  funds?: { denom: string; amount: string }[]
  ){
    // Contract expects Timestamp (nanoseconds) serialized as string; frontend supplies seconds.
    const ts = (expires_at && expires_at > 0) ? (BigInt(Math.floor(expires_at)) * 1000000000n).toString() : null;
    const offered_funds = funds && funds.length ? funds : undefined;
    const msg = { create_offer: { offered_nfts: offered, wanted_nfts: wanted, peer, expires_at: ts, offered_funds } };
    return client.execute(sender, contract, msg, 'auto', undefined, offered_funds || []);
}

export async function removeOffer(
  client: SigningCosmWasmClient,
  sender: string,
  contract: string,
  id: number
) {
  const msg = { remove_offer: { id } };
  return client.execute(sender, contract, msg, 'auto');
}

export async function acceptOffer(
  client: SigningCosmWasmClient,
  sender: string,
  contract: string,
  id: number
) {
  const msg = { accept_offer: { id } };
  return client.execute(sender, contract, msg, 'auto');
}

export async function rejectOffer(
  client: SigningCosmWasmClient,
  sender: string,
  contract: string,
  id: number
) {
  const msg = { reject_offer: { id } };
  return client.execute(sender, contract, msg, 'auto');
}

export async function approveNft(
  client: SigningCosmWasmClient,
  sender: string,
  collection: string,
  tokenId: number,
  spender: string
){
  const msg = { approve: { spender, token_id: String(tokenId) } };
  return client.execute(sender, collection, msg, 'auto');
}

export async function isApproved(
  client: CosmWasmClient,
  collection: string,
  tokenId: number,
  spender: string
): Promise<boolean> {
  try {
    const res = await client.queryContractSmart(collection, { approval: { token_id: String(tokenId), spender, include_expired: false } });
    return !!res;
  } catch {
    return false;
  }
}

export async function fetchOwnerTokens(client: CosmWasmClient, collection: string, owner: string, startAfter?: string): Promise<string[]> {
  try {
    const res = await client.queryContractSmart(collection, { tokens: { owner, limit: 50, start_after: startAfter } });
    return res.tokens ?? [];
  } catch { return []; }
}
