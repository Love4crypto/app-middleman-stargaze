import { fromBech32, toBech32 } from '@cosmjs/encoding';

const sanitizeBech32 = (s?: string) => {
  if (!s) return '';
  // strip zero-width and invisible control chars; normalize; lowercase
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
};

// Contract: must be 32 bytes; Account: 20 bytes
const isValidBech32 = (addr?: string, hrp = 'stars', bytes?: number) => {
  try {
    const { prefix, data } = fromBech32(sanitizeBech32(addr));
    if (prefix !== hrp) return false;
    if (bytes != null && data.length !== bytes) return false;
    return true;
  } catch {
    return false;
  }
};

const debugBech32 = (label: string, addr?: string) => {
  const raw = addr ?? '';
  const san = sanitizeBech32(raw);
  try {
    const { prefix, data } = fromBech32(san);
    const round = toBech32(prefix, data);
    console.group(`[bech32] ${label}`);
    console.log('raw:', raw);
    console.log('sanitized:', san);
    console.log('prefix:', prefix, 'bytes:', data.length, 'roundtrip:', round);
    console.groupEnd();
  } catch (e) {
    console.group(`[bech32] ${label} (INVALID)`);
    console.log('raw:', raw);
    console.log('sanitized:', san);
    console.log('error:', e);
    console.groupEnd();
  }
};

// helpers (no hooks)
const USDC_IBC = 'IBC/4A1C18CA7F50544760CF306189B810CE4C1CB156C7FC870143D401FE7280E591';

const asUSDString = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderFloorUSD(
  floor?: { amount: string; denom: string },
  starsUsd?: number | null
) {
  if (!floor) return '';
  const amt = Number(floor.amount);
  const dLow = floor.denom.toLowerCase();
  const dUp  = floor.denom.toUpperCase();

  if (dLow === 'usd') return asUSDString(amt);                 // already dollars
  if (dLow === 'usdc' || dLow === 'uusdc' || dUp === USDC_IBC) // micro USDC
    return asUSDString(amt / 1_000_000);

  if (dLow === 'ustars') {
    if (starsUsd) return asUSDString((amt / 1_000_000) * starsUsd);
    return `${amt / 1_000_000} STARS`; // fallback until price loads
  }

  // fallback for anything else
  return `${amt / 1_000_000} ${floor.denom.replace(/^u/, '')}`;
}

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
// ⛔️ removed connectKeplr; we keep only makeQueryClient
import { makeQueryClient } from './keplr';
import { connectInjected, type WalletKind } from './wallet';
import { queryParams, queryOffersByPeer, queryOffersBySender, createOffer, approveNft, fetchOwnerTokens, removeOffer, acceptOffer, rejectOffer, isApproved } from './api';
import { batchResolveMedia } from './metadata';
import type { OfferMsgToken, OfferEntry } from './types';
import { fetchOwnedTokensFromIndexer, fetchOwnedTokensPage, fetchFloors, fetchAllCollections, fetchOwnedCollections, fetchTokenImagesBatch, fetchTokenDetailsBatch } from './indexer';
// ⛔️ removed Chakra + CosmosKit imports

const App: React.FC = () => {
  // Hardcoded network / contract (Stargaze mainnet)
  const rpc = 'https://rpc.stargaze-apis.com';
  const chainId = 'stargaze-1';
 
  const contractRaw = 'stars199wg569k4z3qutmm7st5kv488c2us633tnxj3jzj0ye9ma2q4lfs6t50qt';
const contract = sanitizeBech32(contractRaw);

// on startup
useEffect(() => {
  debugBech32('contract', contract);
}, []);


if (!isValidBech32(contract, 'stars', 32)) {
  logOut('Invalid contract address (stars, 32 bytes). Fix the contract constant or input.');
  showToast('Invalid contract address');
  return;
}

  const [address, setAddress] = useState<string | null>(null);
  const [signingClient, setSigningClient] = useState<any>(null);
  const [queryClient, setQueryClient] = useState<any>(null);

  // ⭐️ NEW: wallet preference & label
  const [walletPref, setWalletPref] = useState<WalletKind>('auto'); // 'auto' | 'keplr' | 'leap'
  const [walletLabel, setWalletLabel] = useState<'keplr' | 'leap' | null>(null);

  // collections input removed (indexer only)
  const [collections] = useState('');
  const [peer, setPeer] = useState('');
  const [myTokens, setMyTokens] = useState<OfferMsgToken[]>([]);
  const [peerTokens, setPeerTokens] = useState<OfferMsgToken[]>([]);
  const [offered, setOffered] = useState<OfferMsgToken[]>([]);
  const [wanted, setWanted] = useState<OfferMsgToken[]>([]);
  const [log, setLog] = useState<string>('');
  const [starsAmount, setStarsAmount] = useState<string>('');
  const [offers, setOffers] = useState<OfferEntry[]>([]);
  const [offerExpiryHours, setOfferExpiryHours] = useState<number>(0);
  const [checkingApprovals, setCheckingApprovals] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false); // legacy general loading (kept for other actions)
  const [approving, setApproving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Gallery-only view (list mode removed)
  const [media, setMedia] = useState<Record<string, { image: string | null }>>({});
  const [mediaProgress, setMediaProgress] = useState('');
  const [ipfsGateway] = useState('https://ipfs.io/ipfs/');
  const [lockedTokens, setLockedTokens] = useState<Set<string>>(new Set());
  const useIndexer = true; // always on
  const [indexerStatus, setIndexerStatus] = useState('');
  const [indexerCursorMy, setIndexerCursorMy] = useState<string|null>(null);
  const [indexerCursorPeer, setIndexerCursorPeer] = useState<string|null>(null);
  const [floorPrices, setFloorPrices] = useState<Record<string,{amount:string;denom:string}>>({});
  const [tokenNames, setTokenNames] = useState<Record<string,string>>({});
  const [tokenDetails, setTokenDetails] = useState<Record<string,{description?:string|null;traits?:{name:string;value:string;rarityPercent?:number|null;rarityScore?:number|null;rarity?:number|null}[]|null}>>({});
  const [detailToken, setDetailToken] = useState<{key:string; collection:string; token_id:number}|null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [allCollectionsCount, setAllCollectionsCount] = useState<number| null>(null);
  const [filter, setFilter] = useState('');
  const [showLog, setShowLog] = useState(false);
  const toastRef = useRef<HTMLDivElement|null>(null);

// inside App()
const [starsUsd, setStarsUsd] = useState<number | null>(null);

useEffect(() => {
  (async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=stargaze&vs_currencies=usd');
      const j = await r.json();
      setStarsUsd(j?.stargaze?.usd ?? null);
    } catch {
      setStarsUsd(null);
    }
  })();
}, []);
  // --- helpers -------------------------------------------------------------
const safeMergeMedia = (patch: Record<string, { image: string | null | undefined }>) => {
  setMedia(prev => {
    const out = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      const img = normalizeImage(v?.image || null);
      if (!img) continue;                 // ⛔ skip null/empty
      if (out[k]?.image) continue;        // 👍 keep existing good URL
      out[k] = { image: img };
    }
    return out;
  });
};

  const safeStringify = (v: any) => {
    try { return typeof v === 'string' ? v : JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? val.toString() : val, 2); }
    catch { return String(v); }
  };
  const logOut = (v: any) => {
    const s = safeStringify(v);
    setLog(prev => prev ? prev + '\n' + s : s);
    console.log('[usemiddleman]', v);
  };

  const keyFor = (t:OfferMsgToken) => `${t.collection}:${t.token_id}`;

  // Normalize image URLs (convert ipfs:// to gateway, fix accidental fs:// or bare CID)
  const normalizeImage = useCallback((u?: string | null) => {
    if(!u) return null;
    let url = u.trim();
    const gw = 'https://ipfs-gw.stargaze-apis.com/ipfs/';
    if(url.startsWith('ipfs://')){
      url = gw + url.slice(7);
    }
    if(url.startsWith('fs://')){
      url = gw + url.replace(/^fs:\/\//,'');
    }
    if(!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)){
      if(/^[a-zA-Z0-9]{46,}$/.test(url)){
        url = gw + url;
      }
    }
    const ipfsGatewayPattern = /https?:\/\/(?:[^\/]+)\/ipfs\/([a-zA-Z0-9]+)(?:\/([^?]+))?/;
    const match = url.match(ipfsGatewayPattern);
    if(match){
      url = gw + match[1];
      if(match[2]) url += '/' + match[2];
    }
    return url;
  }, []);

  // Persist peer & wallet preference only
  useEffect(()=> {
    const legacy = localStorage.getItem('pegasus_settings');
    if(legacy){ try { const j = JSON.parse(legacy); if(j.peer) setPeer(j.peer); } catch{} }
    const saved = localStorage.getItem('usemiddleman_settings');
    if(saved){ try { const j = JSON.parse(saved); if(j.peer) setPeer(j.peer); if(j.walletPref) setWalletPref(j.walletPref); } catch{} }
  }, []);
  useEffect(()=> { localStorage.setItem('usemiddleman_settings', JSON.stringify({ peer, walletPref })); }, [peer, walletPref]);

  // 🔌 Connect / Disconnect --------------------------------------------------
  const onConnect = async () => {
    try {
      setLog('Connecting...');
      const { signingClient: sc, address: addr, walletType } = await connectInjected(rpc, chainId, walletPref);
      setSigningClient(sc); setAddress(addr); setWalletLabel(walletType);
      const qc = await makeQueryClient(rpc); setQueryClient(qc);
      logOut(`Connected ${addr} via ${walletType}`);
      showToast(`Connected via ${walletType}`);
    } catch(e:any){ logOut('Connect failed: '+(e.message||e)); }
  };
  const onDisconnect = () => {
    setAddress(null);
    setSigningClient(null);
    setQueryClient(null);
    setMyTokens([]); setPeerTokens([]); setOffered([]); setWanted([]); setOffers([]); setApprovalStatus({});
    setMedia({});
    logOut('Disconnected');
    showToast('Disconnected');
  };

  const showToast = (msg:string, timeout=4200) => {
    if(!toastRef.current) return;
    toastRef.current.textContent = msg;
    toastRef.current.className = 'toast show';
    setTimeout(()=> { if(toastRef.current) toastRef.current.className='toast'; }, timeout);
  };

  const updateFloorPrices = async (tokens: OfferMsgToken[]) => {
    const addrs = tokens.map(t=>t.collection);
    const floors = await fetchFloors(addrs);
    if(Object.keys(floors).length){ setFloorPrices(f=> ({...f, ...floors})); }
  };

  const loadFromIndexerPaged = async (owner: string, isPeer=false) => {
    setIndexerStatus('indexer: loading page...');
    try {
      const cursor = isPeer ? indexerCursorPeer : indexerCursorMy;
      const page = await fetchOwnedTokensPage(owner, cursor, 120);
      const mapped: OfferMsgToken[] = page.tokens.map(t=> ({ collection: t.collectionAddr, token_id: Number(t.tokenId) }));
      const namesPatch: Record<string,string> = {};
      page.tokens.forEach(t=> { if(t.name) namesPatch[`${t.collectionAddr}:${t.tokenId}`] = t.name!; });
      const idxMedia: Record<string,{image:string|null}> = {};
      page.tokens.forEach(t=> { const k = `${t.collectionAddr}:${t.tokenId}`; if((t as any).image && !media[k]) idxMedia[k] = { image: normalizeImage((t as any).image) }; });
      if(Object.keys(namesPatch).length) setTokenNames(n=> ({...n, ...namesPatch}));
      if(isPeer) setPeerTokens(p=> { const all=[...p, ...mapped]; const seen=new Set<string>(); return all.filter(t=>{ const k=keyFor(t); if(seen.has(k)) return false; seen.add(k); return true; }); });
      else setMyTokens(p=> { const all=[...p, ...mapped]; const seen=new Set<string>(); return all.filter(t=>{ const k=keyFor(t); if(seen.has(k)) return false; seen.add(k); return true; }); });
      if(page.nextCursor){ if(isPeer) setIndexerCursorPeer(page.nextCursor); else setIndexerCursorMy(page.nextCursor); }
      else { if(isPeer) setIndexerCursorPeer(null); else setIndexerCursorMy(null); }
      setIndexerStatus(`indexer: loaded +${mapped.length} (cursor ${page.nextCursor? 'has more':'end'})`);
      if(Object.keys(idxMedia).length) setMedia(m=> ({...m, ...idxMedia}));
      const missingPairs = mapped
        .filter(t=> !media[keyFor(t)] || !media[keyFor(t)].image)
        .slice(0, 60)
        .map(t=> ({ collectionAddr: t.collection, tokenId: String(t.token_id) }));
      if(missingPairs.length){
        try {
          const imgs = await fetchTokenImagesBatch(missingPairs);
          setMedia(m => {
            const updated = { ...m };
            Object.entries(imgs).forEach(([k, v]) => {
              const imgUrl = normalizeImage(v);
              if (imgUrl && imgUrl.length > 0) {
                updated[k] = { image: imgUrl };
              }
            });
            return updated;
          });
        } catch{/* ignore backfill errors */}
      }
      const stillMissing = mapped.filter(t=>{ const k = `${t.collection}:${t.token_id}`; return !media[k] || !media[k].image; }).map(t=> ({ collectionAddr: t.collection, tokenId: String(t.token_id) }));
      if(stillMissing.length){
        try {
          const batchImgs = await fetchTokenImagesBatch(stillMissing);
          setMedia(m => {
            const updated = { ...m };
            Object.entries(batchImgs).forEach(([k, v]) => {
              if (v && v.length > 0) {
                updated[k] = { image: v };
              }
            });
            return updated;
          });
        } catch{/* ignore */}
      }
      updateFloorPrices(mapped);
      const subsetRaw = mapped.slice(0, 300);
      const subset = subsetRaw.filter(t=> { const k = `${t.collection}:${t.token_id}`; return !media[k] || !media[k].image; });
  const mediaMap = subset.length ? await batchResolveMedia(queryClient, subset, ipfsGateway, 6, ()=>{}) : {};
const compact: Record<string, { image: string | null }> = {};
for (const [k, v] of Object.entries(mediaMap)) compact[k] = { image: v?.image ?? null };
safeMergeMedia(compact); // ✅ will only fill missing, non-null
      try {
        const detailPairs = mapped.slice(0,150).map(t=> ({ collectionAddr: t.collection, tokenId: String(t.token_id) }));
        const det = await fetchTokenDetailsBatch(detailPairs);
        if(Object.keys(det).length) setTokenDetails(d=> ({...d, ...det}));
      } catch{/* ignore details fetch errors */}
      showToast('Loaded NFTs page');
    } catch(e:any){ setIndexerStatus('indexer error: '+(e.message||e)); showToast('Indexer error'); }
  };

  // Load ALL pages for my wallet automatically (indexer mode)
  const loadAllFromIndexer = useCallback(async (owner: string) => {
    setMyTokens([]); setIndexerCursorMy(null);
    setIndexerStatus('indexer: loading all pages...');
    let cursor: string | null = null; let total = 0; const MAX = 10000; // safety cap
    const sessionAddr = owner; const sessionFlag = useIndexer; // capture
    while(true){
      try {
        if(!sessionFlag || sessionAddr !== address) { setIndexerStatus('indexer: aborted'); return; }
        const page = await fetchOwnedTokensPage(owner, cursor, 120);
        const mapped: OfferMsgToken[] = page.tokens.map(t=> ({ collection: t.collectionAddr, token_id: Number(t.tokenId) }));
        if(page.tokens.length){
          const namesPatch: Record<string,string> = {};
            page.tokens.forEach(t=> { if(t.name) namesPatch[`${t.collectionAddr}:${t.tokenId}`] = t.name!; });
          if(Object.keys(namesPatch).length) setTokenNames(n=> ({...n, ...namesPatch}));
          // direct indexer images for this page
          const idxMedia: Record<string,{image:string|null}> = {};
          page.tokens.forEach(t=> { const k = `${t.collectionAddr}:${t.tokenId}`; if((t as any).image && !media[k]) idxMedia[k] = { image: normalizeImage((t as any).image) }; });
          if(Object.keys(idxMedia).length) setMedia(m=> ({...m, ...idxMedia}));
        }
        setMyTokens(prev => {
          const all=[...prev, ...mapped]; const seen=new Set<string>();
            return all.filter(t=>{ const k=keyFor(t); if(seen.has(k)) return false; seen.add(k); return true; });
        });
        if(mapped.length) updateFloorPrices(mapped);
        // optional media batch (small incremental)
        if(mapped.length){
          try {
            const subsetRaw = mapped.slice(0,200);
            const subset = subsetRaw.filter(t=> { const k = `${t.collection}:${t.token_id}`; return !media[k] || !media[k].image; });
            const mediaMap = subset.length ? await batchResolveMedia(queryClient, subset, ipfsGateway, 6, ()=>{}) : {};
            const compact: Record<string,{image:string|null}> = {};
            Object.entries(mediaMap).forEach(([k,v])=>{ compact[k] = { image: normalizeImage(v.image || null) }; });
            setMedia(m => ({ ...m, ...compact }));
            try {
              const detailPairs = mapped.slice(0,160).map(t=> ({ collectionAddr: t.collection, tokenId: String(t.token_id) }));
              const det = await fetchTokenDetailsBatch(detailPairs);
              if(Object.keys(det).length) setTokenDetails(d=> ({...d, ...det}));
            } catch{/* ignore */}
            // Backfill any still-missing via token() query
            const missingPairs = mapped.filter(t=>{ const k = `${t.collection}:${t.token_id}`; return !compact[k] || !compact[k].image; }).map(t=> ({ collectionAddr: t.collection, tokenId: String(t.token_id) }));
            if(missingPairs.length){
              try {
                const batchImgs = await fetchTokenImagesBatch(missingPairs);
                const patch: Record<string,{image:string|null}> = {};
                Object.entries(batchImgs).forEach(([k,v])=>{ if(v) patch[k] = { image: v }; });
                if(Object.keys(patch).length) setMedia(m=> ({...m, ...patch}));
              } catch{/* ignore */}
            }
          } catch{/* ignore single page errors */}
        }
        total += mapped.length;
        setIndexerStatus(`indexer: loaded ${total}${page.nextCursor? ' (more...)':''}`);
        cursor = page.nextCursor || null;
        if(!cursor || mapped.length===0 || total >= MAX) break;
      } catch(e:any){ setIndexerStatus('indexer error: '+(e.message||e)); break; }
    }
    setIndexerStatus(`indexer: complete (${total})`);
    showToast('Loaded '+total+' NFTs');
  }, [address, useIndexer, ipfsGateway, queryClient]);

  const loadOwnerTokens = useCallback(async (owner: string, setState: (t: OfferMsgToken[]) => void) => {
    if(useIndexer){
      // reset for fresh load
      if(setState===setMyTokens){
        setMyTokens([]); setIndexerCursorMy(null);
      } else {
        // Remove images for all tokens in previous peerTokens
        setPeerTokens([]); setIndexerCursorPeer(null);
        setMedia(m => {
          const newMedia = { ...m };
          peerTokens.forEach(t => {
            const k = `${t.collection}:${t.token_id}`;
            delete newMedia[k];
          });
          return newMedia;
        });
      }
      await loadFromIndexerPaged(owner, setState===setPeerTokens);
      return;
    }
    if (!queryClient) return logOut('Not connected (no indexer fallback)');
  }, [queryClient, ipfsGateway, useIndexer]);

  // Auto-load my NFTs after connect (and when mode/collections change)
  useEffect(()=>{
    if(address && queryClient){
      if(useIndexer){ loadAllFromIndexer(address); }
      else if(collections.trim()) { loadOwnerTokens(address, setMyTokens); }
    }
  }, [address, queryClient, useIndexer, collections, loadAllFromIndexer, loadOwnerTokens]);

  // Owned collections floor prefetch (indexer mode)
  useEffect(()=>{
    if(address && useIndexer){
      (async()=>{
        try {
          const owned = await fetchOwnedCollections(address);
          if(owned.length){
            const subset = owned.slice(0, 60);
            const floors = await fetchFloors(subset);
            if(Object.keys(floors).length) setFloorPrices(f=> ({...f, ...floors}));
          }
        } catch{/* ignore */}
      })();
    }
  }, [address, useIndexer]);

  const toggleToken = (token: OfferMsgToken, list: OfferMsgToken[], setter: (x: OfferMsgToken[]) => void) => {
    const exists = list.find(t => t.collection === token.collection && t.token_id === token.token_id);
    if (exists) setter(list.filter(t => !(t.collection === token.collection && t.token_id === token.token_id)));
    else setter([...list, token]);
  };

  const recomputeLocked = (offersList: OfferEntry[]) => {
    if(!address) return setLockedTokens(new Set());
    // Tokens in offers created by me (still active) are locked
    const s = new Set<string>();
    offersList.filter(o=>o.sender===address).forEach(o=>{
      o.offered_nfts.forEach(tok=> s.add(keyFor(tok)));
    });
    setLockedTokens(s);
  };

  const refreshApprovalStatus = async () => {
    if(!queryClient || !contract) return;
    setCheckingApprovals(true);
    const status: Record<string, boolean> = {};
    for(const tok of offered){
      status[keyFor(tok)] = await isApproved(queryClient, tok.collection, tok.token_id, contract);
    }
    setApprovalStatus(status);
    setCheckingApprovals(false);
  };

  useEffect(()=>{ refreshApprovalStatus(); }, [offered, queryClient, contract]);
  useEffect(()=>{ if(address && queryClient && contract) { qOffersSender(); } }, [address, queryClient, contract]);

  // When offers change, ensure media & basic details for tokens inside offers
  useEffect(()=>{
    (async()=>{
      if(!queryClient || !offers.length) return;
      const allTokens = offers.flatMap(o=> [...o.offered_nfts, ...o.wanted_nfts]);
      const missing = allTokens.filter(t=>{ const k = keyFor(t); return !media[k]; }).slice(0,60); // cap
      if(!missing.length) return;
      try {
        const mediaMap = await batchResolveMedia(queryClient, missing, ipfsGateway, 6, ()=>{});
        const patch: Record<string,{image:string|null}> = {};
        Object.entries(mediaMap).forEach(([k,v])=>{ patch[k] = { image: normalizeImage(v.image || null) }; });
        if(Object.keys(patch).length) setMedia(m=> ({...m, ...patch}));
      } catch{/* ignore */}
    })();
  }, [offers, queryClient, ipfsGateway, normalizeImage]);

  // Simple concurrency runner
  const runWithConcurrency = async <T,>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
    return new Promise<void>((resolve, reject) => {
      const queue = [...items];
      let active = 0; let done = 0; let failed = false;
      const launch = () => {
        if(failed) return; // already rejected
        if(done === items.length) { if(active === 0) resolve(); return; }
        while(active < limit && queue.length){
          const it = queue.shift()!; active++;
            worker(it)
              .catch(err => { failed = true; reject(err); })
              .finally(()=> { active--; done++; if(!failed) launch(); });
        }
      };
      launch();
    });
  };

  // ⭐️ UPDATED: wallet-agnostic reconnect path
  const approveOneWithRetry = async (tok: OfferMsgToken, attempt = 0): Promise<void> => {
    if(!signingClient || !address) throw new Error('Not connected');
    try {
      await approveNft(signingClient, address, tok.collection, tok.token_id, contract);
      setApprovalStatus(s => ({ ...s, [keyFor(tok)]: true }));
    } catch(e:any){
      const msg = e?.message || String(e);
      if(attempt < 2 && (msg.includes('sequence mismatch') || msg.includes('incorrect account sequence') || msg.includes('code 32'))){
        // brief backoff then retry
        await new Promise(r=>setTimeout(r, 400 + attempt*300));
        return approveOneWithRetry(tok, attempt+1);
      }
      if(attempt < 2 && msg.includes('Failed to retrieve account from signer')){
        // Try silent reconnect (Leap or Keplr)
        try {
          if(!reconnecting){
            setReconnecting(true);
            logOut('Signer lost - attempting reconnect...');
            const { signingClient: sc, address: addr, walletType } = await connectInjected(rpc, chainId, walletPref);
            setSigningClient(sc); setAddress(addr); setWalletLabel(walletType);
            logOut('Reconnect success via ' + walletType);
          }
        } catch(reErr:any){
          logOut('Reconnect failed: '+(reErr.message||reErr));
        } finally { setReconnecting(false); }
        await new Promise(r=>setTimeout(r, 300));
        return approveOneWithRetry(tok, attempt+1);
      }
      throw e;
    }
  };

  const approveAll = async () => {
    if (!signingClient || !address) return logOut('Connect first');
    if (!offered.length) return logOut('Select offered tokens');
    setApproving(true); let count = 0;
    try {
      // Run strictly sequential to avoid account sequence mismatch
      for(const tok of offered){
        await approveOneWithRetry(tok);
        count++;
      }
      logOut('Approved ' + count + ' NFTs');
      showToast('Approved '+count);
    } catch(e:any){
      logOut('Approve failed: '+(e.message||e));
      showToast('Approve error');
    }
    setApproving(false);
    refreshApprovalStatus();
  };

  const doCreateOffer = async () => {
    if (!signingClient || !address) return logOut('Connect first');
    if (!offered.length || !wanted.length) return logOut('Need offered + wanted tokens');
    if (!peer) return logOut('Peer required');
    // Auto approve any missing approvals first
    const missing = offered.filter(t => !approvalStatus[keyFor(t)]);
    if(missing.length){
      logOut(`Auto-approving ${missing.length} NFT(s)...`);
      try {
        setApproving(true);
        for(const tok of missing){
          await approveOneWithRetry(tok);
        }
        setApproving(false);
        await refreshApprovalStatus();
      } catch(e:any){ logOut('Auto-approve failed: '+(e.message||e)); return; }
    }
    // Re-check
    const stillMissing = offered.filter(t=> !approvalStatus[keyFor(t)]);
    if(stillMissing.length){
      logOut('Create offer blocked: some NFTs still not approved. Use Approve Offered.');
      return;
    }
    setCreating(true);
    try {
      const safeHours = offerExpiryHours>0 ? Math.min(offerExpiryHours, 24*30) : 0; // UI cap
      // Contract min/max from on-chain params (hardcoded defaults fallback): min 24h (86400s), max 7d (604800s)
      const nowSec = Math.floor(Date.now()/1000);
      let expires: number | null = null; let raised=false; let clamped=false;
      if(safeHours>0){
        const target = nowSec + Math.floor(safeHours*3600);
        const min = 86400; const max = 604800; // in seconds offset length
        const delta = target - nowSec;
        if(delta < min){
          expires = nowSec + min; // raise to min instead of null so user intent is preserved
          raised = true;
        } else if(delta > max){
          expires = nowSec + max; // clamp to max
          clamped = true;
        } else {
          expires = target;
        }
      }
      // Convert STARS to ustars (micro units)
      let funds: { denom: string; amount: string }[] = [];
      if (starsAmount && !isNaN(Number(starsAmount)) && Number(starsAmount) > 0) {
        funds = [{ denom: "ustars", amount: (Number(starsAmount) * 1_000_000).toFixed(0) }];
      }
      const res = await createOffer(signingClient, address, contract, offered, wanted, peer, expires, funds);
      await qOffersSender();
      const slim = { txHash: (res as any).transactionHash, height: (res as any).height, gasWanted: (res as any).gasWanted?.toString?.() || (res as any).gasWanted, gasUsed: (res as any).gasUsed?.toString?.() || (res as any).gasUsed };
      logOut({ message: 'Offer creation tx sent', ...slim });
      if(raised) { logOut('Expiry raised to contract minimum (24h)'); showToast('Expiry raised to 24h min'); }
      else if(clamped) { logOut('Expiry clamped to contract max (7d)'); showToast('Expiry clamped to 7d max'); }
      else showToast('Offer created');
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('not authorized') || msg.includes('Contract is not authorized')) {
        logOut('Create offer failed: contract not approved for all offered NFTs. Approve them and retry.');
      } else if (msg.includes('unknown variant `create_offer`')) {
        logOut('Create offer failed: wrong contract address (points to cw721).');
      } else {
        logOut('Create offer failed: ' + msg);
      }
      showToast('Offer create failed');
    }
    setCreating(false);
  };

  const qParams = async () => { if (!queryClient) return; logOut(await queryParams(queryClient, contract)); };
  const qOffersSender = async () => { if (!queryClient || !address) return; const res = await queryOffersBySender(queryClient, contract, address); setOffers(res.offers); recomputeLocked(res.offers); logOut(res); };
  const qOffersPeer = async () => { if (!queryClient || !peer) return; const res = await queryOffersByPeer(queryClient, contract, peer); setOffers(res.offers); logOut(res); };

  const actRemove = async (id:number) => { if(!signingClient||!address) return; setLoading(true); try{ await removeOffer(signingClient,address,contract,id); await qOffersSender(); }catch(e:any){ logOut('Remove failed: '+(e.message||e)); } setLoading(false); };
  const actAccept = async (id:number) => {
    if(!signingClient||!address) return logOut('Connect first');
    const offer = offers.find(o=>o.id===id);
    if(!offer) return logOut('Offer not found');
    if(address !== offer.peer) return logOut('You are not the peer for this offer');
    setLoading(true);
    try {
      let approvalsDone = 0; let approvalsSkipped = 0;
      await runWithConcurrency(offer.wanted_nfts, 4, async (tok) => {
        const already = await isApproved(queryClient, tok.collection, tok.token_id, contract);
        if (already) { approvalsSkipped++; return; }
        await approveNft(signingClient!, address!, tok.collection, tok.token_id, contract);
        approvalsDone++;
      });
      if (approvalsDone>0) logOut(`Auto-approved ${approvalsDone} tokens (skipped ${approvalsSkipped}). Accepting offer...`);
      const res = await acceptOffer(signingClient,address,contract,id);
      logOut({ message:'Offer accepted', txHash:(res as any).transactionHash, height:(res as any).height });
      await qOffersPeer();
      await qOffersSender();
    } catch(e:any){
      logOut('Accept failed: '+(e.message||e));
    }
    setLoading(false);
  };
  const actReject = async (id:number) => { if(!signingClient||!address) return logOut('Connect first'); setLoading(true); try{ await rejectOffer(signingClient,address,contract,id); await qOffersPeer(); await qOffersSender(); }catch(e:any){ logOut('Reject failed: '+(e.message||e)); } setLoading(false); };
  // Peer-side approval of wanted NFTs prior to accepting
  const approveWantedForOffer = async (offer: OfferEntry) => {
    if(!signingClient || !address) return logOut('Connect first');
    if(address !== offer.peer) return logOut('Not the peer for this offer');
    setLoading(true); let approved=0; let skipped=0; let failed=false;
    for(const tok of offer.wanted_nfts){
      try {
        const already = await isApproved(queryClient, tok.collection, tok.token_id, contract);
        if(already){ skipped++; continue; }
        await approveNft(signingClient, address, tok.collection, tok.token_id, contract);
        approved++;
      } catch(e:any){ logOut('Approve wanted token failed '+tok.collection+'#'+tok.token_id+': '+(e.message||e)); failed=true; break; }
    }
    setLoading(false);
    if(!failed) logOut(`Wanted approvals done. Approved ${approved}, skipped ${skipped}. Now you can Accept.`);
  };
  const offerHasAllPeerApprovals = async (offer: OfferEntry): Promise<boolean> => {
    if(!queryClient) return false;
    for(const tok of offer.wanted_nfts){
      const ok = await isApproved(queryClient, tok.collection, tok.token_id, contract);
      if(!ok) return false;
    }
    return true;
  };

  const removeAllMyOffers = async () => {
    if(!signingClient||!address) return logOut('Connect first');
    const mine = offers.filter(o=>o.sender===address).map(o=>o.id);
    if(!mine.length) return logOut('No offers to remove');
    setLoading(true);
    let removed = 0;
    for(const id of mine){
      try { await removeOffer(signingClient,address,contract,id); removed++; }
      catch(e:any){ logOut('Failed removing offer '+id+': '+(e.message||e)); break; }
    }
    await qOffersSender();
    setLoading(false);
    logOut('Removed '+removed+' offers');
  };

  return <div className="app">
  <style>{`
    :root{--accent:#E3A938;--accent-rgb:227,169,56;--bg:#0d0d0d;--bg-alt:#141414;--panel:#1b1b1b;--panel-alt:#222;--border:#2a2a2a;--border-soft:#1f1f1f;--text:#e4e4e4;--muted:#8a8a8a;--danger:#b3363b;--danger-rgb:179,54,59;--radius:10px}
    /* Full-bleed page background & reset */
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: linear-gradient(140deg, #000, #121212) fixed; /* match your theme */
  color: var(--text);
  overflow-x: hidden; /* avoid accidental horizontal scroll on mobile */
}

/* Safer sizing everywhere */
*, *::before, *::after { box-sizing: border-box; }

/* Content container: centered with max-width and responsive gutters */
.app{
  width: 100%;
  max-width: 1200px;               /* <-- your requested width */
  margin-inline: auto;             /* center */
  padding: 1rem clamp(12px, 3vw, 24px); /* comfy side gutters */
  min-height: 100vh;
  display: flex; 
  flex-direction: column;
}

/* Respect iOS safe-area insets for edge-to-edge devices */
@supports (padding: max(0px)) {
  .app{
    padding-left: max(env(safe-area-inset-left), clamp(12px, 3vw, 24px));
    padding-right: max(env(safe-area-inset-right), clamp(12px, 3vw, 24px));
  }
}
    h1{font-size:1.35rem;background:linear-gradient(90deg,var(--accent),#ffe8b0);-webkit-background-clip:text;color:transparent;letter-spacing:.5px;margin:.2rem 0 1rem}
    h2{margin:1.2rem 0 .6rem;font-size:.95rem;font-weight:600;letter-spacing:.04em;color:#f0f0f0}
    fieldset{position:relative;border:1px solid transparent;padding:1.15rem 1rem .95rem;margin:0 0 1.2rem;border-radius:22px;backdrop-filter:blur(3px);background:
      linear-gradient(#141414,#101010) padding-box,
      linear-gradient(135deg,#2a2a2a,#3a2a2a,#2a2a2a) border-box;
      box-shadow:0 4px 14px -6px rgba(0,0,0,.75),0 0 0 1px #000,0 0 0 1px #1c1c1c inset}
    fieldset:hover{box-shadow:0 6px 18px -6px rgba(var(--accent-rgb),.25),0 0 0 1px #000}
    legend{padding:.4rem .95rem;font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;position:absolute;top:-12px;left:18px;border-radius:999px;font-weight:600;background:linear-gradient(135deg,var(--accent),#f3d27d);color:#121212;display:flex;align-items:center;gap:.45rem;border:1px solid #bb8a2b;box-shadow:0 2px 6px -2px rgba(0,0,0,.7),0 0 0 3px #0e0e0e}
    legend:before{content:'';width:6px;height:6px;border-radius:50%;background:#121212;box-shadow:0 0 0 4px rgba(0,0,0,.5),0 0 0 6px var(--accent);}
    label{display:block;margin:.4rem 0 .25rem;font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
    input,textarea{width:100%;padding:.55rem .65rem; box-sizing: border-box; border:1px solid var(--border);border-radius:6px;background:#101010;color:var(--text);font-family:inherit;font-size:.7rem;transition:.18s;border-bottom:1px solid #333}
    input:focus,textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
    button{cursor:pointer;position:relative;isolation:isolate;background:var(--accent);color:#121212;border:1px solid #8c671e;padding:.58rem .95rem;border-radius:7px;font-weight:600;margin:.35rem .45rem .35rem 0;transition:.18s;font-size:.68rem;letter-spacing:.03em}
    button:before{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(140deg,rgba(var(--accent-rgb),.25),transparent 60%);opacity:0;transition:.25s;z-index:-1}
    button:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 14px -4px rgba(var(--accent-rgb),.55);}
    button:hover:not(:disabled):before{opacity:1}
    button:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.3)}
    button.secondary{background:#262626;color:var(--text);border:1px solid #343434}
    button.secondary:hover:not(:disabled){box-shadow:0 4px 12px -4px rgba(0,0,0,.7),0 0 0 1px #000}
    button.danger{background:linear-gradient(135deg,#651d1f,#932f33);color:#fceaea;border:1px solid #5d2426}
    button.danger:hover:not(:disabled){box-shadow:0 4px 14px -4px rgba(var(--danger-rgb),.7)}
    .flex{display:flex;gap:.75rem;flex-wrap:wrap}
    .col{flex:1 1 230px;min-width:200px}
    .nfts{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:.55rem}
    .nft{position:relative;background:#121212;border:1px solid var(--border);padding:.42rem .55rem;border-radius:12px;font-size:.63rem;cursor:pointer;width:104px;min-height:104px;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.55),0 0 0 1px #000;transition:.22s}
    .nft:hover{border-color:var(--accent);box-shadow:0 4px 14px -4px rgba(var(--accent-rgb),.5),0 0 0 1px var(--accent)}
    .nft img{max-width:100%;max-height:100%;object-fit:cover;border-radius:6px;display:block;filter:saturate(.92);transition:.25s}
    .nft:hover img{filter:saturate(1.05) brightness(1.05)}
    .nft.sel{outline:2px solid var(--accent);background:linear-gradient(145deg,#1a1a1a,#111);box-shadow:0 0 0 2px var(--accent),0 6px 14px -6px rgba(var(--accent-rgb),.55)}
    .nft.locked{opacity:.32;cursor:not-allowed}
    .nft.locked:after{content:'LOCKED';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:700;background:rgba(0,0,0,.55);letter-spacing:.05em;color:#bbb}
    .nft .tag{position:absolute;left:4px;top:4px;background:rgba(0,0,0,.55);padding:2px 5px;font-size:.55rem;border-radius:5px;color:#ccc;backdrop-filter:blur(2px)}
    .nft .nm{position:absolute;left:2px;right:2px;bottom:2px;background:rgba(0,0,0,.55);padding:2px 4px;font-size:.5rem;max-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;color:#ddd}
    .nftWrap{display:flex;flex-direction:column;align-items:center;width:104px}
    .nftWrap .floor{margin-top:4px;text-align:center;font-size:.52rem;color:var(--accent);font-weight:600;letter-spacing:.03em}
    .detailPanel{position:fixed;top:0;right:0;width:320px;background:#0f0f0f;height:100%;border-left:1px solid #222;padding:1rem .95rem .9rem;overflow:auto;font-size:.65rem;box-shadow:-4px 0 12px -6px rgba(0,0,0,.6)}
    .detailPanel h3{margin:.3rem 0 .55rem;font-size:.9rem;font-weight:600;color:var(--accent)}
    .traitsList{display:flex;flex-direction:column;gap:.3rem;margin-top:.55rem}
    .traitsList div{background:#181818;padding:5px 8px;border-radius:6px;display:flex;justify-content:space-between;gap:.6rem;border:1px solid #242424}
    .traitsList div span:first-child{font-weight:600;color:var(--accent)}
    pre{background:#111;padding:.75rem .8rem;border-radius:8px;max-height:320px;overflow:auto;font-size:.66rem;white-space:pre-wrap;border:1px solid #1f1f1f}
    .toast{position:fixed;bottom:18px;right:18px;background:#191919;color:var(--text);padding:.65rem .9rem;border-radius:10px;font-size:.7rem;opacity:0;transform:translateY(8px);transition:.4s;border:1px solid #2a2a2a;box-shadow:0 4px 18px -6px rgba(0,0,0,.7)}
    .toast.show{opacity:1;transform:translateY(0)}
    .floor{font-size:.55rem;opacity:.8;margin-top:2px}
    .badge{position:absolute;right:4px;top:4px;font-size:.55rem;padding:2px 5px;border-radius:5px;background:#262626;border:1px solid #333;letter-spacing:.04em}
    .badge.ok{background:var(--accent);color:#121212;border:1px solid #bb8a2b;font-weight:600}
    .badge.miss{background:#3a1a1a;color:#ffb4b4;border:1px solid #5a2626}
  .pillBtn, .logToggle{display:inline-block;font-size:.55rem;cursor:pointer;color:#121212;background:var(--accent);text-decoration:none;margin-left:.6rem;letter-spacing:.09em;padding:.32rem .7rem .36rem;border-radius:999px;font-weight:600;box-shadow:0 2px 6px -2px rgba(var(--accent-rgb),.55),0 0 0 1px #bb8a2b;transition:.22s;line-height:1}
  .pillBtn:hover, .logToggle:hover{filter:brightness(1.07);transform:translateY(-1px);box-shadow:0 4px 10px -3px rgba(var(--accent-rgb),.65),0 0 0 1px #d29b30}
  .pillBtn:active, .logToggle:active{transform:translateY(0);filter:brightness(.95)}
  .pillBtn.secondary{background:#262626;color:var(--accent);box-shadow:0 0 0 1px #333}
  .pillBtn.secondary:hover{box-shadow:0 0 0 1px var(--accent),0 3px 8px -3px rgba(var(--accent-rgb),.5)}
    .offersList{display:flex;flex-direction:column;gap:.55rem;margin-top:.75rem}
    .offerCard{background:#141414;border:1px solid #262626;padding:.55rem .7rem;border-radius:12px;font-size:.63rem;display:flex;align-items:flex-start;gap:.8rem;flex-wrap:wrap;position:relative;box-shadow:0 2px 6px -2px rgba(0,0,0,.6)}
    .offerCard strong{font-size:.7rem;color:var(--accent)}
    .offerCard:hover{border-color:var(--accent);box-shadow:0 4px 14px -4px rgba(var(--accent-rgb),.5)}
    .miniSet{display:flex;flex-wrap:wrap;gap:5px;max-width:260px}
    .miniNft{width:75px;height:75px;position:relative;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;background:#181818;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.22s}
    .miniNft:hover{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
    .miniNft img{width:100%;height:100%;object-fit:cover;display:block}
    .miniNft span{font-size:.5rem;color:#cfcfcf}
    .miniLabel{font-size:.48rem;opacity:.65;width:100%;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
    .credit{margin-bottom:1.1rem;font-size:.70rem;letter-spacing:.12em;font-weight:600;text-transform:uppercase;display:inline-block;padding:.45rem .85rem .5rem;border:1px solid #2a2a2a;border-radius:999px;background:linear-gradient(135deg,#181818,#121212);box-shadow:0 4px 14px -6px rgba(0,0,0,.7),0 0 0 1px #252525, inset 0 0 0 1px #1a1a1a;position:relative;overflow:hidden}
    .credit a{background:linear-gradient(90deg,#E3A938,#ffe8b0,#E3A938);background-size:200% 100%;-webkit-background-clip:text;color:transparent;text-decoration:none;font-weight:800;animation:shine 6s linear infinite;letter-spacing:.15em}
   .col.compact { flex: 0 1 360px; max-width: 360px; min-width: 260px; }
.col.break   { flex: 1 1 100%; min-width: 100%; } /* forces next line in a flex-wrap row */ .credit:before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(90deg,rgba(227,169,56,.4),rgba(227,169,56,0),rgba(227,169,56,.4));-webkit-mask:linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.55}
    @keyframes shine{0%{background-position:0 0}100%{background-position:200% 0}}
    .hint{font-size:.5rem;opacity:.55;margin-top:.25rem;letter-spacing:.05em}
	/* Layout: let footer stick to bottom even on short pages */
.app{ display:flex; flex-direction:column; }

/* Footer */
.siteFooter{
  margin-top:auto;             /* pushes footer to the bottom */
  border-top:1px solid var(--border);
  background:linear-gradient(180deg,#0f0f0f 0%, #0b0b0b 100%);
  padding:1rem 0 1.1rem;
  position:relative;
}
.siteFooter::before{
  content:"";
  position:absolute;
  top:-1px; left:0; right:0; height:1px;
  background:linear-gradient(90deg, rgba(var(--accent-rgb),.45), rgba(255,255,255,.06), rgba(var(--accent-rgb),.45));
  opacity:.5;
}
.siteFooter .wrap{
  display:flex; align-items:center; justify-content:space-between;
  gap:.9rem; flex-wrap:wrap;
}
.siteFooter .brand{
  font-weight:800; letter-spacing:.08em; font-size:.78rem;
  background:linear-gradient(90deg,var(--accent),#ffe8b0);
  -webkit-background-clip:text; color:transparent;
}
.siteFooter .tagline{
  font-size:.88rem; color:var(--muted); margin-top:.2rem;
}
.siteFooter .legal{
  font-size:.88rem; color:#a9a9a9; opacity:.9;
  border:1px solid #262626; padding:.35rem .55rem; border-radius:999px;
  background:linear-gradient(135deg,#141414,#101010);
  box-shadow:0 1px 4px rgba(0,0,0,.35), inset 0 0 0 1px #171717;
}
.siteFooter a{ color:inherit; text-decoration:none; }
.siteFooter a:hover{ text-decoration:underline; }
  `}</style>
    <div ref={toastRef} className="toast" />

<div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.4rem",
  }}
>
  {/* Left side: Title and credit */}
  <div>
    <h1 style={{ margin: "0 0 0.3rem 0" }}>P2P marketplace app.usemiddleman.xyz</h1>
    <div className="credit">
      Crafted by{" "}
      <span style={{ position: "relative", zIndex: 1 }}>
        <a
          href="https://x.com/love_4_crypto"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "relative",
            zIndex: 2,
            pointerEvents: "auto",
          }}
        >
          Love_4_crypto
        </a>
      </span>
    </div>
  </div>

  {/* Right side: Wallet connection block */}
  <fieldset style={{ minWidth: "260px", flexShrink: 0 }}>
    <legend>Connect</legend>

    {!address ? (
      <div style={{ display:'flex', gap:'.5rem', alignItems:'center', flexWrap:'wrap' }}>
        <button onClick={onConnect}>Connect</button>
        <select
          style={{ fontSize:'.7rem', background:'#101010', border:'1px solid #333', color:'#e4e4e4', borderRadius:6, padding:'.3rem .4rem' }}
          value={walletPref}
          onChange={e => setWalletPref(e.target.value as WalletKind)}
          title="Choose which wallet to use"
        >
          <option value="auto">Auto</option>
          <option value="keplr">Keplr</option>
          <option value="leap">Leap</option>
        </select>
      </div>
    ) : (
      <>
        <button
          onClick={onDisconnect}
          className="danger"
          style={{ marginRight: "0.6rem" }}
        >
          Disconnect
        </button>
        <span style={{ fontSize: "0.65rem", opacity: 0.85 }}>
          {address}
        </span>
      </>
    )}

    <div
      style={{
        fontSize: "0.6rem",
        opacity: 0.7,
        marginTop: "0.4rem",
      }}
    >
      Network: Stargaze (stargaze-1) | Contract preset{walletLabel ? ` | Wallet: ${walletLabel}` : ''}
    </div>
  </fieldset>
</div>

    <fieldset>
      <legend>Peer</legend>
      <div className="flex">
        <div className="col"><label>Peer Address</label><input value={peer} onChange={e=>setPeer(e.target.value)} placeholder="stars1peer..."/></div>
      </div>
  <div style={{fontSize:'.65rem',opacity:.8}}>{indexerStatus || 'Indexer: loading...'}</div>
  <div className="flex" style={{marginTop:'.4rem'}}>
    <div className="col"><label>Filter</label><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="search id / name / collection" /></div>
  </div>
  <button className="pillBtn secondary" disabled={!address} onClick={()=> address && loadOwnerTokens(address,setMyTokens)}>Refresh My NFTs</button>
  {indexerCursorMy && <button className="pillBtn secondary" disabled={!address} onClick={()=>address && loadFromIndexerPaged(address,false)}>More Mine</button>}
  <button className="pillBtn secondary" disabled={!peer} onClick={()=> peer && loadOwnerTokens(peer,setPeerTokens)}>Load Peer NFTs</button>
  {indexerCursorPeer && <button className="pillBtn secondary" disabled={!peer} onClick={()=>peer && loadFromIndexerPaged(peer,true)}>More Peer</button>}
  <button className="pillBtn secondary" onClick={async ()=>{ try { const list = await fetchAllCollections(1000); setAllCollectionsCount(list.length); logOut({ collectionsFetched: list.length }); } catch(e:any){ logOut('Collections fetch failed: '+(e.message||e)); } }}>All Collections</button>
  {mediaProgress && <span style={{marginLeft:'.6rem'}}>Media: {mediaProgress}</span>}
  {allCollectionsCount!=null && <span style={{marginLeft:'.6rem'}}>Collections: {allCollectionsCount}</span>}
      <div className="flex">
        <div className="col">
          <h2>Your NFTs</h2>
          <div className="nfts">
            {myTokens.filter(t=>{
              if(!filter.trim()) return true;
              const key = `${t.collection}:${t.token_id}`;
              const nm = tokenNames[key];
              const f = filter.toLowerCase();
              return key.toLowerCase().includes(f) || (nm && nm.toLowerCase().includes(f)) || t.collection.toLowerCase().includes(f) || String(t.token_id).includes(f);
            }).map(t=> {
              const sel = offered.find(o=>o.collection===t.collection && o.token_id===t.token_id);
              const key = `${t.collection}:${t.token_id}`;
              const img = normalizeImage(media[key]?.image);
              const locked = lockedTokens.has(key);
              const floor = floorPrices[t.collection];
              const nm = tokenNames[key];
              const det = tokenDetails[key];
              const tooltip = [nm||key, det?.description, det?.traits?.slice(0,6).map(tr=>`${tr.name}:${tr.value}${tr.rarityScore?`(R:${tr.rarityScore.toFixed(2)})`:''}`).join(' | ')].filter(Boolean).join('\n');
              return <div key={key} className="nftWrap">
                <div title={tooltip} className={'nft'+(sel?' sel':'')+(locked?' locked':'')} onClick={()=>{ if(locked) return; toggleToken(t,offered,setOffered); setDetailToken({key, collection:t.collection, token_id:t.token_id}); }}>
                  {img ? <img src={img} alt={key} loading="lazy" /> : <span>{t.token_id}</span>}
                  <span className="tag">{t.token_id}</span>
                  {nm && <span className="nm">{nm}</span>}
                  {sel && <span className={'badge '+(approvalStatus[key]? 'ok':'miss')}>{approvalStatus[key]? 'OK':'!'}</span>}
                </div>
                {floor && <div className="floor">Floor: {renderFloorUSD(floor, starsUsd)}</div>}
              </div>;
            })}
          </div>
        </div>
        <div className="col">
          <h2>Peer NFTs</h2>
            <div className="nfts">
            {peerTokens.filter(t=>{
              if(!filter.trim()) return true;
              const key = `${t.collection}:${t.token_id}`;
              const nm = tokenNames[key];
              const f = filter.toLowerCase();
              return key.toLowerCase().includes(f) || (nm && nm.toLowerCase().includes(f)) || t.collection.toLowerCase().includes(f) || String(t.token_id).includes(f);
            }).map(t=> {
              const sel = wanted.find(o=>o.collection===t.collection && o.token_id===t.token_id);
              const key = `${t.collection}:${t.token_id}`;
              const img = normalizeImage(media[key]?.image);
              const floor = floorPrices[t.collection];
              const nm = tokenNames[key];
              const det = tokenDetails[key];
              const tooltip = [nm||key, det?.description, det?.traits?.slice(0,6).map(tr=>`${tr.name}:${tr.value}${tr.rarityScore?`(R:${tr.rarityScore.toFixed(2)})`:''}`).join(' | ')].filter(Boolean).join('\n');
              return <div key={key} className="nftWrap">
                <div title={tooltip} className={'nft'+(sel?' sel':'')} onClick={()=>{ toggleToken(t,wanted,setWanted); setDetailToken({key, collection:t.collection, token_id:t.token_id}); }}>
                  {img ? <img src={img} alt={key} loading="lazy" /> : <span>{t.token_id}</span>}
                  <span className="tag">{t.token_id}</span>
                  {nm && <span className="nm">{nm}</span>}
                </div>
               {floor && <div className="floor">Floor: {renderFloorUSD(floor, starsUsd)}</div>}
              </div>;
            })}
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Offer Actions</legend>
      <div className="flex">
        <div className="col"><label>Offered</label><pre>{JSON.stringify(offered,null,2)}</pre></div>
        <div className="col"><label>Wanted</label><pre>{JSON.stringify(wanted,null,2)}</pre></div>
      </div>
       <div className="flex">
  <div className="col" style={{ flex: '0 1 360px', maxWidth: 360 }}>
    <label htmlFor="starsAmount">Add $STARS to offer</label>
    <input type="number" id="starsAmount" min="0" step="any" placeholder="Amount of STARS (optional)" value={starsAmount} onChange={e => setStarsAmount(e.target.value)} />
  </div>
</div>
 <div className="flex">
  <div className="col compact">
    <label>Expiry Hours (relative)</label>
    <input
      type="number"
      step="1"
      min="0"
      placeholder="0 = auto min"
      value={offerExpiryHours}
      onChange={e => setOfferExpiryHours(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
    />
    <div className="hint">Min 24h · Max 168h (7d). Below min will auto-raise.</div>
  </div>

  <div className="col break">
    <label>Approvals</label>
    <pre>{checkingApprovals ? 'checking...' : JSON.stringify(approvalStatus, null, 2)}</pre>
  </div>
</div>
  <button className="secondary" disabled={!offered.length || approving || creating} onClick={approveAll}>{approving? (reconnecting? 'Reconnecting...' : 'Approving...') : 'Approve Offered'}</button>
  <button className="danger" disabled={!offered.length||!wanted.length||!peer||creating||approving} onClick={doCreateOffer}>{creating? 'Creating...' : 'Create Offer'}</button>
      <button className="secondary" onClick={()=>{setOffered([]);setWanted([]);}}>Clear Selections</button>
    </fieldset>

    <fieldset>
      <legend>Queries</legend>
   {/*   <button className="secondary" onClick={qParams}>Params</button> */}
      <button className="secondary" onClick={qOffersSender} disabled={!address}>Offers Sent</button>
      <button className="secondary" onClick={qOffersPeer} disabled={!peer}>Offers Recieved</button>
      <button className="secondary" onClick={removeAllMyOffers} disabled={!address || !offers.some(o=>o.sender===address)}>Remove All My Offers</button>
    </fieldset>
	{/*
    <fieldset>
      <legend>Output <span className="logToggle" onClick={()=>setShowLog(s=>!s)}>{showLog? 'hide':'show'}</span></legend>
      {showLog && <pre>{log}</pre>}
    </fieldset> */}

    {offers.length > 0 && <fieldset>
      <legend>Active Offers ({offers.length})</legend>
      <div className="offersList">
        {offers.map(o=> {
          const mine = o.sender===address;
          const peerSide = o.peer===address;
          const renderMini = (tok: OfferMsgToken) => {
            const k = keyFor(tok);
            const img = media[k]?.image && normalizeImage(media[k]?.image);
            return <div key={k} className="miniNft" title={k} onClick={()=> setDetailToken({key:k, collection:tok.collection, token_id: tok.token_id})}>
              {img ? <img src={img} alt={k}/> : <span>{tok.token_id}</span>}
            </div>;
          };
          const expTooltip = (()=>{
            try {
              if(o.expires_at){
                const expMs = Number(BigInt(o.expires_at)/1000000n);
                const createdMs = o.created_at? Number(BigInt(o.created_at)/1000000n): null;
                const dExp = new Date(expMs).toLocaleString();
                const dCr = createdMs? new Date(createdMs).toLocaleString():'';
                return `Created: ${dCr}\nExpires: ${dExp}`;
              }
            } catch {/* ignore */}
            return '';
          })();
          // Show STARS offered if present
          let starsAmount = null as number | null;
          if(o.offered_funds && Array.isArray(o.offered_funds)){
            const starsCoin = o.offered_funds.find((f: any)=>f.denom==='ustars');
            if(starsCoin && starsCoin.amount){
              const amt = Number(starsCoin.amount)/1_000_000;
              if(amt > 0) starsAmount = amt;
            }
          }
          return <div key={o.id} className="offerCard" title={expTooltip}>
            <strong>#{o.id}</strong>
            <span>{mine? 'You':'Sender'}: {o.sender.slice(0,10)}</span>
            <span>Peer: {o.peer.slice(0,10)}</span>
            {(()=>{
              let expiryNode: React.ReactNode = null;
              try {
                if(o.expires_at){
                  const now = Date.now();
                  const expMs = Number(BigInt(o.expires_at)/1000000n); // ns -> ms
                  const diff = expMs - now;
                  const expired = diff <= 0;
                  const fmt = (ms:number)=>{
                    const s = Math.max(0, Math.floor(ms/1000));
                    const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const ss = s%60;
                    if(h>48) return h+"h"; if(h>0) return h+"h"+ (m? m+"m":""); if(m>0) return m+"m"; return ss+"s";
                  };
                  expiryNode = <span style={{color:expired? '#ff7a7a':'var(--accent)'}}>
                    {expired? 'Expired' : 'Exp:' + fmt(diff)}
                  </span>;
                }
              } catch{/* ignore */}
              return expiryNode;
            })()}
            <div className="miniSet" style={{maxWidth:220}}>
              <div className="miniLabel">Offered</div>
              {starsAmount !== null && <div style={{fontSize:'.62rem',color:'var(--accent)',marginBottom:'2px'}}>+ {starsAmount} STARS</div>}
              {o.offered_nfts.slice(0,8).map(renderMini)}
              {o.offered_nfts.length>8 && <span style={{fontSize:'.55rem'}}>+{o.offered_nfts.length-8} more</span>}
            </div>
            <div className="miniSet" style={{maxWidth:220}}>
              <div className="miniLabel">Wanted</div>
              {o.wanted_nfts.slice(0,8).map(renderMini)}
              {o.wanted_nfts.length>8 && <span style={{fontSize:'.55rem'}}>+{o.wanted_nfts.length-8} more</span>}
            </div>
            <div style={{marginLeft:'auto',display:'flex',gap:'.4rem'}}>
              <button className="secondary" onClick={()=>actRemove(o.id)} disabled={!mine}>Remove</button>
              <button className="secondary" onClick={()=>actAccept(o.id)} disabled={!peerSide || loading}>Accept</button>
              <button className="secondary" onClick={()=>actReject(o.id)} disabled={!peerSide}>Reject</button>
            </div>
          </div>;
        })}
      </div>
    </fieldset>}
    {detailToken && (()=>{
      const det = tokenDetails[detailToken.key];
      const rawImg = media[detailToken.key]?.image;
      const img = normalizeImage(rawImg);
      const name = tokenNames[detailToken.key] || detailToken.key;
      const ensureDetails = async () => {
        if(det || detailLoading) return;
        try {
          setDetailLoading(true);
          const res = await fetchTokenDetailsBatch([{ collectionAddr: detailToken.collection, tokenId: String(detailToken.token_id)}]);
          if(res && Object.keys(res).length) setTokenDetails(d=> ({...d, ...res}));
        } finally { setDetailLoading(false); }
      };
      ensureDetails();
      return <div className="detailPanel">
        <button className="secondary" style={{float:'right'}} onClick={()=>setDetailToken(null)}>Close</button>
        <h3>{name}</h3>
        <div style={{fontSize:'.6rem',opacity:.8,marginBottom:'.5rem'}}>{detailToken.collection} #{detailToken.token_id}</div>
        {img && <img src={img} alt={name} style={{maxWidth:'100%',borderRadius:6,marginBottom:'.6rem'}} />}
        {det?.description && <div style={{whiteSpace:'pre-wrap',fontSize:'.6rem',marginBottom:'.7rem'}}>{det.description}</div>}
        <div style={{fontWeight:600,marginTop:'.4rem'}}>Traits {det?.traits?`(${det.traits.length})`:''} {detailLoading && '...'} </div>
        <div className="traitsList">
          {det?.traits?.map((tr,i)=> <div key={i}><span>{tr.name}</span><span>{tr.value}{tr.rarityScore?` • R:${tr.rarityScore.toFixed(2)}`:''}{tr.rarityPercent?` • ${tr.rarityPercent.toFixed(2)}%`:''}</span></div>)}
        </div>
      </div>;
    })()}
	<footer className="siteFooter">
  <div className="wrap">
    <div>
      <div className="brand">app.usemiddleman.xyz</div>
      <div className="tagline">Secure and modern P2P marketplace for exchanging Stargaze NFTs.</div>
    </div>
    <div className="legal">© 2025 app.usemiddleman.xyz · All rights reserved.</div>
  </div>
</footer>
  </div>;
};

createRoot(document.getElementById('root')!).render(<App />);
