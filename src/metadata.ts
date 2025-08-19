import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';

export interface NftInfoResponse { token_uri?: string | null; extension?: any; }
export interface ResolvedMedia { image: string | null; rawTokenUri: string | null; metadata?: any; error?: string; }

const infoCache = new Map<string, NftInfoResponse>();
const httpCache = new Map<string, any>();

export function ipfsToHttp(uri?: string | null, gateway = 'https://ipfs.io/ipfs/') {
  if (!uri) return null;
  const stargazeGw = 'https://ipfs-gw.stargaze-apis.com/ipfs/';
  if (uri.startsWith('ipfs://')) return stargazeGw + uri.replace('ipfs://', '');
  // If it's a cloudflare-ipfs.com or other gateway, force to Stargaze gateway
  const cloudflarePattern = /https?:\/\/cloudflare-ipfs\.com\/ipfs\/([a-zA-Z0-9]+)(?:\/([^?]+))?/;
  const match = uri.match(cloudflarePattern);
  if(match){
    let url = stargazeGw + match[1];
    if(match[2]) url += '/' + match[2];
    return url;
  }
  // If it's another gateway, e.g. https://ipfs.io/ipfs/<cid>/... or similar
  const genericPattern = /https?:\/\/[^\/]+\/ipfs\/([a-zA-Z0-9]+)(?:\/([^?]+))?/;
  const match2 = uri.match(genericPattern);
  if(match2){
    let url = stargazeGw + match2[1];
    if(match2[2]) url += '/' + match2[2];
    return url;
  }
  return uri;
}

export async function fetchNftInfo(client: CosmWasmClient, collection: string, tokenId: number): Promise<NftInfoResponse> {
  const key = `${collection}:${tokenId}`;
  if (infoCache.has(key)) return infoCache.get(key)!;
  try {
    const res = await client.queryContractSmart(collection, { nft_info: { token_id: String(tokenId) } });
    infoCache.set(key, res);
    return res;
  } catch {
    const fb: NftInfoResponse = {};
    infoCache.set(key, fb);
    return fb;
  }
}

function pickImage(meta: any): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  let img = meta.image || meta.image_url || meta.imageURI || meta.media || (meta.properties && meta.properties.image) || undefined;
  // Force any cloudflare-ipfs or other gateway to Stargaze gateway
  if (img) {
    img = ipfsToHttp(img);
  }
  return img;
}

export async function resolveNftMedia(client: CosmWasmClient, collection: string, tokenId: number, gateway?: string): Promise<ResolvedMedia> {
  const info = await fetchNftInfo(client, collection, tokenId);
  const tokenUri = info.token_uri || null;
  if (!tokenUri) return { image: null, rawTokenUri: null, metadata: info };
  const url = ipfsToHttp(tokenUri, gateway);
  if (!url) return { image: null, rawTokenUri: tokenUri, metadata: info };
  if (httpCache.has(url)) {
    const cached = httpCache.get(url);
    return { image: pickImage(cached) || null, rawTokenUri: tokenUri, metadata: cached };
  }
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await resp.json();
      httpCache.set(url, json);
      let img = pickImage(json) || null;
      if(img && img.startsWith('ipfs://')) {
        const converted = ipfsToHttp(img, gateway);
        if(converted) img = converted;
      }
      return { image: img, rawTokenUri: tokenUri, metadata: json };
    } else if (ct.startsWith('image/')) {
  return { image: url, rawTokenUri: tokenUri, metadata: { direct: true } };
    } else {
      return { image: null, rawTokenUri: tokenUri, metadata: { contentType: ct } };
    }
  } catch (e: any) {
    return { image: null, rawTokenUri: tokenUri, metadata: info, error: e.message || String(e) };
  }
}

export async function batchResolveMedia(
  client: CosmWasmClient,
  tokens: { collection: string; token_id: number }[],
  gateway?: string,
  concurrency = 4,
  onProgress?: (done: number, total: number) => void
) {
  const results: Record<string, ResolvedMedia> = {};
  let idx = 0; let done = 0;
  async function worker() {
    while (idx < tokens.length) {
      const current = idx++;
      const tok = tokens[current];
      results[`${tok.collection}:${tok.token_id}`] = await resolveNftMedia(client, tok.collection, tok.token_id, gateway);
      done++; onProgress && onProgress(done, tokens.length);
    }
  }
  const workers = Array(Math.min(concurrency, tokens.length)).fill(0).map(()=>worker());
  await Promise.all(workers);
  return results;
}
