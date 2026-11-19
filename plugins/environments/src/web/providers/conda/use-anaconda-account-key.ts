import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	AnacondaAccount,
	type AnacondaAccountState,
} from "@kilo-desktop/plugin-anaconda/contracts";

import { invalidateConda, type CondaMethod } from "../../conda";

function accountKey({ session }: AnacondaAccountState): string {
	if (session.status !== "authenticated") return session.status;
	return `authenticated:${session.user.userId ?? session.user.username ?? ""}`;
}

/**
 * Which Anaconda account repodata is filtered for: it changes on sign-in,
 * sign-out and a switch of account. Null without kilo.anaconda. Package
 * lookups key on it so they never keep showing the previous account's
 * results (main clears its own read cache on the account's `changed`).
 */
export function useAnacondaAccountKey(): string | null {
	return useDomainObjectState(AnacondaAccount, accountKey) ?? null;
}

/** The cached reads whose answer depends on the Anaconda account. */
const ACCOUNT_FILTERED_READS: readonly CondaMethod[] = [
	"findRepodata",
	"previewInstall",
	"previewUpdate",
];

/** Refreshes the account-filtered conda reads when the Anaconda account changes. */
export function useRefreshOnAnacondaAccountChange(): void {
	const queryClient = useQueryClient();
	const key = useAnacondaAccountKey();
	const previous = useRef(key);
	useEffect(() => {
		if (previous.current === key) return;
		const first = previous.current === null;
		previous.current = key;
		// The first known state is not a change: kilo.anaconda just arrived.
		if (!first) void invalidateConda(queryClient, ACCOUNT_FILTERED_READS);
	}, [key, queryClient]);
}
