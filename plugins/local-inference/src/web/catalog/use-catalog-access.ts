import { useQueryClient } from "@tanstack/react-query";
import { createElement, Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type {
	ModelCatalogAccess,
	ModelCatalogSignInResult,
	ModelCatalogState,
} from "../../contracts/index";
import {
	localInferenceQueryKey,
	useLocalInference,
	useModelServerState,
	type LocalInferenceClient,
} from "../local-inference";

export type { ModelCatalogAccess, ModelCatalogSignInResult };

const selectCatalog = (state: { catalog: ModelCatalogState }) => state.catalog;
const sameCatalog = (a: ModelCatalogState, b: ModelCatalogState) =>
	JSON.stringify(a) === JSON.stringify(b);

/** The `model-catalog` contribution `model-server` reports; null while there is none. */
function useCatalogState(): ModelCatalogState {
	return useModelServerState(selectCatalog, sameCatalog) ?? null;
}

/**
 * Refetches the catalog whenever who it is read for changes (a sign-in,
 * sign-out, another account, or the catalog itself coming or going) — origin's
 * Anaconda account boundary, now over `model-server`'s `catalog` state.
 */
export function CatalogAccessBoundary({ children }: { children: ReactNode }) {
	const catalog = useCatalogState();
	const queryClient = useQueryClient();
	const previous = useRef(catalog);

	useEffect(() => {
		if (sameCatalog(previous.current, catalog)) return;
		previous.current = catalog;
		void queryClient.invalidateQueries({ queryKey: localInferenceQueryKey("listCatalog") });
	}, [catalog, queryClient]);

	return createElement(Fragment, null, children);
}

export interface CatalogAccess {
	/** False when no model catalog is contributed. */
	available: boolean;
	/** Whose catalog it is ("Anaconda"); null without one. */
	title: string | null;
	access: ModelCatalogAccess;
	resolving: boolean;
	signingIn: boolean;
	signIn(): Promise<ModelCatalogSignInResult>;
	cancelSignIn(): Promise<void>;
}

const UNAVAILABLE_ACCESS: ModelCatalogAccess = { status: "signed-out" };

/**
 * The model catalog's access as the catalog UI needs it, tolerating no
 * catalog. Mounting asks the catalog to work out its access, as origin's
 * catalog resolved the Anaconda session when shown.
 */
export function useCatalogAccess(): CatalogAccess {
	const catalog = useCatalogState();
	const client = useLocalInference();
	const [signingIn, setSigningIn] = useState(false);
	const available = catalog !== null;

	useEffect(() => {
		if (available) void client.resolveCatalogAccess(undefined).catch(() => undefined);
	}, [available, client]);

	const signIn = async (): Promise<ModelCatalogSignInResult> => {
		setSigningIn(true);
		const result = await signInToCatalog(client);
		setSigningIn(false);
		return result;
	};

	const cancelSignIn = async (): Promise<void> => {
		await client.cancelCatalogSignIn(undefined).catch(() => undefined);
	};

	return {
		available,
		title: catalog?.title ?? null,
		access: catalog?.access ?? UNAVAILABLE_ACCESS,
		resolving: catalog?.access.status === "resolving",
		signingIn,
		signIn,
		cancelSignIn,
	};
}

async function signInToCatalog(client: LocalInferenceClient): Promise<ModelCatalogSignInResult> {
	try {
		return await client.signInToCatalog(undefined);
	} catch (cause) {
		return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
	}
}

/**
 * Identifies whose account the catalog would be read for. Part of the catalog
 * query key, so signing in, out, or switching accounts never serves a catalog
 * cached under a different account (the query cache outlives the dialog).
 */
export function catalogAccountKey(catalog: CatalogAccess): string {
	if (!catalog.available) return "unavailable";
	const { access } = catalog;
	if (access.status !== "signed-in") return access.status;
	return `user:${access.accountKey}`;
}
