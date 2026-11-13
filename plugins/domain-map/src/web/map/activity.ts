/** Something a domain object did, as the map saw it from this window. */
export type Activity =
	| { readonly kind: "state"; readonly domainId: string }
	| {
			readonly kind: "event";
			readonly domainId: string;
			readonly event: string;
			readonly payload: unknown;
	  };
