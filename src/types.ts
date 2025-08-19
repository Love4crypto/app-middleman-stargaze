export interface SimpleToken { collection: string; token_id: string | number; }
export interface OfferMsgToken { collection: string; token_id: number; }
export interface ParamsResponse { params:{ offer_expiry:{min:number;max:number}; maintainer:string; max_offers:number; bundle_limit:number } }
export interface Coin {
	denom: string;
	amount: string;
}

export interface OfferEntry {
	id: number;
	sender: string;
	peer: string;
	offered_nfts: OfferMsgToken[];
	wanted_nfts: OfferMsgToken[];
	created_at: string;
	expires_at: string;
	offered_funds?: Coin[];
}
export interface OffersResponse { offers: OfferEntry[]; }
