// Constellations / Stargaze GraphQL indexer adapter

// When displaying offers, show offered_funds if present:
// Example usage in your UI:
// if (offer.offered_funds && offer.offered_funds.length > 0) {
//   offer.offered_funds.forEach(fund => {
//     if (fund.denom === "ustars") {
//       // Display fund.amount (in micro-ustars)
//     }
//   });
// }
// Adaptive query strategy: the public GraphQL schema can evolve (field / root names change).
// We attempt a list of candidate queries until one succeeds, then cache that variant.
// This avoids hard failures (HTTP 400 / unknown field) and gives the UI a resilient data feed.

const DEFAULT_ENDPOINT = import.meta.env.VITE_INDEXER_URL || 'https://constellations-api.mainnet.stargaze-apis.com/graphql';
const USER_AGENT = import.meta.env.VITE_INDEXER_UA || 'usemiddleman-app/0.1 (contact: set VITE_INDEXER_UA)';

interface GqlResp<T> { data?: T; errors?: Array<{ message: string }>; }

interface OwnedQueryVariant {
  name: string;
  query: string;
  // returns { list: any[], pageInfo: any }
  extract: (data: any) => { list: any[]; pageInfo: any } | null;
  buildVars: (owner: string, limit: number, cursor: string | null) => any;
  mode?: 'cursor' | 'offset';
}

// Candidate variants (ordered). Reduced & cleaned to only schema-confirmed fields.
// We keep an offset-paginated variant (exposes total) and a simple fallback.
const OWNED_VARIANTS: OwnedQueryVariant[] = [
  {
    name: 'tokens(ownerAddr offset)',
    query: `query OwnedTokens($owner:String!,$limit:Int,$offset:Int){\n  tokens(ownerAddr:$owner, limit:$limit, offset:$offset){\n    tokens { tokenId collectionAddr name imageUrl image { url } }\n    total limit offset\n  }\n}`,
    extract: data => { const c = data?.tokens; if(!c) return null; const total=c.total??0; const limitVal=c.limit??c.tokens?.length??0; const offsetVal=c.offset??0; const hasNextPage=(offsetVal+limitVal)<total; return { list: c.tokens||[], pageInfo:{ hasNextPage, cursor: String(offsetVal+limitVal) } }; },
    buildVars: (owner, limit, cursor) => ({ owner, limit, offset: cursor? Number(cursor):0 }),
    mode: 'offset'
  },
  {
    name: 'tokens(ownerAddr simple)',
    query: `query OwnedTokens($owner:String!){\n  tokens(ownerAddr:$owner){\n    tokens { tokenId collectionAddr name imageUrl image { url } }\n  }\n}`,
    extract: data => { const c = data?.tokens; if(!c) return null; return { list: c.tokens||[], pageInfo:{ hasNextPage:false } }; },
    buildVars: (owner) => ({ owner })
  }
];

let ACTIVE_VARIANT: OwnedQueryVariant | null = null;
let VARIANT_TESTED = false;
const dynamicVariants: OwnedQueryVariant[] = [];
let triedIntrospection = false;

export interface IndexedToken { collectionAddr: string; tokenId: string; image?: string | null; name?: string | null; }

async function gqlRequest<T>(query: string, variables: any, endpoint = DEFAULT_ENDPOINT): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  let json: GqlResp<T> | null = null;
  try { json = JSON.parse(text); } catch {/* non-JSON */}
  if(!res.ok){
    const snippet = text.slice(0,160).replace(/\s+/g,' ').trim();
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
  if(!json) throw new Error('Non-JSON GraphQL response');
  if(json.errors?.length) throw new Error(json.errors.map(e=>e.message).join('; '));
  if(!json.data) throw new Error('No data in GraphQL response');
  return json.data;
}

function mapToken(raw: any): IndexedToken {
  return {
    collectionAddr: raw.collectionAddr || raw.collectionAddress || raw.contractAddr || raw.contractAddress || '',
    tokenId: String(raw.tokenId ?? raw.id ?? ''),
    image: raw.imageUrl || raw.image?.url || raw.media?.image || raw.media?.url || raw.image || null,
    name: raw.name || null
  };
}

async function introspectAndGenerate(_endpoint = DEFAULT_ENDPOINT){ /* simplified; not needed now */ return; }
async function fetchOwnedPageAdaptive(owner: string, cursor: string | null, limit: number, endpoint?: string): Promise<{ tokens: IndexedToken[]; nextCursor: string | null; variant: string }>{
  const baseList = ACTIVE_VARIANT ? [ACTIVE_VARIANT] : [...OWNED_VARIANTS, ...dynamicVariants];
  const tryVariants = baseList.length ? baseList : OWNED_VARIANTS;
  let lastErr: any = null;
  for(const variant of tryVariants){
    try {
      const data: any = await gqlRequest(variant.query, variant.buildVars(owner, limit, cursor), endpoint);
      const ext = variant.extract(data);
      if(!ext) throw new Error('Unexpected response shape');
      const list = ext.list || [];
      const pageInfo = ext.pageInfo || {};
      let cursorVal = pageInfo.cursor || pageInfo.endCursor || null;
      if(variant.mode === 'offset'){
        // emulate offset-based pagination; increment by limit
        const offsetNum = cursor ? Number(cursor) : 0;
        cursorVal = pageInfo.hasNextPage ? String(offsetNum + limit) : null;
      }
      if(!ACTIVE_VARIANT) ACTIVE_VARIANT = variant; // lock in working variant
  return { tokens: list.map(mapToken).filter(t=>t.collectionAddr && t.tokenId), nextCursor: (pageInfo.hasNextPage && cursorVal) ? cursorVal : null, variant: variant.name };
    } catch(e:any){
      lastErr = e;
      // if variant was active but failed (schema changed mid-session), reset and continue to next
      if(ACTIVE_VARIANT === variant) ACTIVE_VARIANT = null;
      continue;
    }
  }
  if(!dynamicVariants.length){
    await introspectAndGenerate(endpoint);
    if(dynamicVariants.length){
      return fetchOwnedPageAdaptive(owner, cursor, limit, endpoint);
    }
  }
  throw new Error('All indexer query variants failed: '+(lastErr?.message||lastErr));
}

export async function fetchOwnedTokensFromIndexer(owner: string, maxTotal = 2000, endpoint?: string): Promise<IndexedToken[]> {
  const out: IndexedToken[] = [];
  let cursor: string | null = null; let loops = 0;
  while(out.length < maxTotal && loops < 300){
    loops++;
    try {
      const page = await fetchOwnedTokensPage(owner, cursor, 100, endpoint);
      out.push(...page.tokens);
      if(!page.nextCursor) break; cursor = page.nextCursor;
    } catch(e){
      console.error('Indexer fetch error', e);
      break;
    }
  }
  return out;
}

// Add paged fetch support
export interface OwnedTokensPage { tokens: IndexedToken[]; nextCursor: string | null; }

export async function fetchOwnedTokensPage(owner: string, cursor: string | null, limit = 100, endpoint?: string): Promise<OwnedTokensPage> {
  try {
    const page = await fetchOwnedPageAdaptive(owner, cursor, limit, endpoint);
    return { tokens: page.tokens, nextCursor: page.nextCursor };
  } catch(e:any){
    throw new Error('Indexer page fetch failed: '+(e.message||e));
  }
}

// Floor price query (best-effort). If it fails we silently ignore.
// NOTE: Original attempt used collectionsByAddr (not present in newer schema). We fallback to per-collection queries.
const QUERY_FLOORS = `query Floors($addr:String!){ collection(collectionAddr:$addr){ collectionAddr floorPrice floorPriceStars floorPriceUsd } }`;
export interface FloorMap { [collectionAddr: string]: { amount: string; denom: string } }
export async function fetchFloors(collections: string[], endpoint?: string): Promise<FloorMap> {
  if(!collections.length) return {};
  const unique = Array.from(new Set(collections)).slice(0, 40); // limit sequential calls
  const map: FloorMap = {};
  for(const addr of unique){
    try {
      const data: any = await gqlRequest(QUERY_FLOORS, { addr }, endpoint);
      const c = data.collection; if(c && (c.floorPriceStars != null || c.floorPrice != null)){
        // Prefer STARS numeric forms; we normalize to amount+denom
        if(c.floorPriceStars != null){ map[c.collectionAddr] = { amount: String(Math.round(Number(c.floorPriceStars)*1_000_000)), denom: 'ustars' }; }
        else if(c.floorPrice != null) { map[c.collectionAddr] = { amount: String(c.floorPrice), denom: 'ustars' }; }
      }
    } catch{/* ignore individual failures */}
  }
  return map;
}

// ---------------------------------------------------------------------------
// Collections listing (offset pagination)
// ---------------------------------------------------------------------------
export interface IndexedCollection { name?: string|null; collectionAddr?: string|null; address?: string|null; mintedAt?: string|null; }
interface CollectionsPage { collections: IndexedCollection[]; total?: number; nextOffset: number | null; }

// Collections query: remove deprecated/unknown fields (collectionAddress, address, pageInfo) to avoid schema errors.
// Newer schema exposes collections(list) without pageInfo; we simulate pagination via offset until an empty page or < limit length.
const QUERY_COLLECTIONS = `query Collections($limit:Int,$offset:Int){\n  collections(limit:$limit, offset:$offset){\n    collections { name collectionAddr mintedAt }\n    total limit offset\n  }\n}`;

export async function fetchCollectionsPage(limit=100, offset=0, endpoint=DEFAULT_ENDPOINT): Promise<CollectionsPage>{
  try {
    const data: any = await gqlRequest(QUERY_COLLECTIONS, { limit, offset }, endpoint);
    const container = data.collections || {};
    const list = (container.collections || []).map((c:any)=> ({
      name: c.name || null,
      collectionAddr: c.collectionAddr || null,
      address: c.collectionAddr || null,
      mintedAt: c.mintedAt || null
    }));
    // Prefer server-provided total; else infer via length heuristic
    const total = container.total ?? null;
    let nextOffset: number | null = null;
    if(list.length === limit){
      if(typeof container.total === 'number'){
        if(offset + limit < container.total) nextOffset = offset + limit;
      } else {
        // unknown total, optimistic continue until we receive < limit
        nextOffset = offset + limit;
      }
    }
    return { collections: list, total: typeof total==='number'? total: undefined, nextOffset };
  } catch(e:any){
    // Provide clearer error surface
    throw new Error('Collections query failed: '+(e.message||e));
  }
}

export async function fetchAllCollections(max=5000, endpoint=DEFAULT_ENDPOINT): Promise<IndexedCollection[]>{
  let out: IndexedCollection[] = []; let offset = 0; const limit = 100; let guard=0;
  while(out.length < max && guard < 200){
    guard++;
    const page = await fetchCollectionsPage(limit, offset, endpoint);
    out = out.concat(page.collections);
    if(page.nextOffset == null) break; offset = page.nextOffset;
  }
  return out.slice(0,max);
}

// Owned collections (addresses where user has tokens) - can be used to prefetch floor prices quickly
export async function fetchOwnedCollections(owner: string, endpoint=DEFAULT_ENDPOINT): Promise<string[]> {
  const QUERY_OWNED = `query Owned($owner:String!){ ownedCollections(ownerAddr:$owner){ collections { collectionAddr } } }`;
  try {
    const data: any = await gqlRequest(QUERY_OWNED, { owner }, endpoint);
    const list = data?.ownedCollections?.collections || [];
    return list.map((c:any)=> c.collectionAddr).filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Per-token image backfill (some list queries may omit imageUrl)
// ---------------------------------------------------------------------------
interface TokenPair { collectionAddr: string; tokenId: string; }

function sanitize(val: string){ return val.replace(/[^a-zA-Z0-9:_\-./]/g,''); }

function buildTokenImagesQuery(pairs: TokenPair[]): string {
  // Use field aliases to request many tokens in one round trip
  const body = pairs.map((p,i)=> `t${i}: token(collectionAddr:"${sanitize(p.collectionAddr)}", tokenId:"${sanitize(p.tokenId)}"){ imageUrl image { url } }`).join('\n');
  return `query TokenImages {\n${body}\n}`;
}

export async function fetchTokenImagesBatch(pairs: TokenPair[], endpoint=DEFAULT_ENDPOINT): Promise<Record<string,string|null>>{
  const out: Record<string,string|null> = {};
  const BATCH = 20; // reasonable tradeoff
  for(let i=0;i<pairs.length;i+=BATCH){
    const slice = pairs.slice(i,i+BATCH);
    try {
      const q = buildTokenImagesQuery(slice);
      const data: any = await gqlRequest(q, {}, endpoint);
      if(data){
        slice.forEach((p,idx)=>{
          const node = (data as any)[`t${idx}`];
          const img = node?.imageUrl || node?.image?.url || null;
          out[`${p.collectionAddr}:${p.tokenId}`] = img || null;
        });
      }
    } catch(e){
      // fallback: try individual queries to salvage some images
      for(const p of slice){
        try {
          const singleQ = `query TokenImage($c:String!,$id:String!){ token(collectionAddr:$c, tokenId:$id){ imageUrl image { url } } }`;
          const d: any = await gqlRequest(singleQ, { c: p.collectionAddr, id: p.tokenId }, endpoint);
          const node = d?.token; out[`${p.collectionAddr}:${p.tokenId}`] = node?.imageUrl || node?.image?.url || null;
        } catch { out[`${p.collectionAddr}:${p.tokenId}`] = null; }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch fetch token descriptions & traits
// ---------------------------------------------------------------------------
export interface TokenTrait { name: string; value: string; rarityPercent?: number | null; rarityScore?: number | null; rarity?: number | null; }
export interface TokenDetails { description?: string | null; traits?: TokenTrait[] | null; }

function buildTokenDetailsQuery(pairs: TokenPair[]): string {
  const body = pairs.map((p,i)=> `t${i}: token(collectionAddr:"${sanitize(p.collectionAddr)}", tokenId:"${sanitize(p.tokenId)}"){ description traits { name value rarityPercent rarityScore rarity } }`).join('\n');
  return `query TokenDetails {\n${body}\n}`;
}

export async function fetchTokenDetailsBatch(pairs: TokenPair[], endpoint=DEFAULT_ENDPOINT): Promise<Record<string,TokenDetails>>{
  const out: Record<string,TokenDetails> = {};
  const BATCH = 12; // heavier query than images; keep smaller
  for(let i=0;i<pairs.length;i+=BATCH){
    const slice = pairs.slice(i,i+BATCH);
    try {
      const q = buildTokenDetailsQuery(slice);
      const data: any = await gqlRequest(q, {}, endpoint);
      slice.forEach((p,idx)=>{
        const node = (data as any)[`t${idx}`];
        if(node) out[`${p.collectionAddr}:${p.tokenId}`] = { description: node.description || null, traits: node.traits || null };
      });
    } catch(e){
      // fallback individual
      for(const p of slice){
        try {
          const singleQ = `query SingleToken($c:String!,$id:String!){ token(collectionAddr:$c, tokenId:$id){ description traits { name value rarityPercent rarityScore rarity } } }`;
          const d: any = await gqlRequest(singleQ, { c: p.collectionAddr, id: p.tokenId }, endpoint);
          const node = d?.token; if(node) out[`${p.collectionAddr}:${p.tokenId}`] = { description: node.description || null, traits: node.traits || null };
        } catch{/* ignore */}
      }
    }
  }
  return out;
}
