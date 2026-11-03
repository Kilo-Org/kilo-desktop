import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
	envPrefixSchema,
	type CreatePrefixUnavailableReason,
} from "../../../contracts/providers/conda.js";
import { condaQueryOptions, type CondaClient } from "../../conda.js";

/** Wait this long after the last keystroke before checking the prefix. */
export const PREFIX_CHECK_DEBOUNCE_MS = 400;

export type CreatePrefixCheckState =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "available" }
	| { status: "unavailable"; reason: CreatePrefixUnavailableReason }
	| { status: "error" };

/**
 * Whether `prefix` can be created, re-checked (debounced) as it changes.
 *
 * The answer always belongs to the *current* prefix: while the debounce is
 * pending or a check is in flight — including the refetch after a create
 * invalidates it — the state is `checking`, so a stale `available` can never
 * unlock creation. `prefix === null` (nothing valid to check yet) is `idle`.
 */
export function useCreatePrefixCheck(
	conda: CondaClient,
	prefix: string | null,
): CreatePrefixCheckState {
	const [debounced, setDebounced] = useState(prefix);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(prefix), PREFIX_CHECK_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [prefix]);

	const checkable = debounced !== null && envPrefixSchema.safeParse(debounced).success;
	const query = useQuery({
		...condaQueryOptions(conda, "checkPrefix", { prefix: debounced ?? "" }),
		enabled: checkable,
		staleTime: 0,
		retry: false,
	});

	if (prefix === null) return { status: "idle" };
	if (debounced !== prefix) return { status: "checking" };
	if (!checkable) return { status: "unavailable", reason: "invalid-path" };
	if (query.isFetching || query.isPending) return { status: "checking" };
	if (query.isError) return { status: "error" };
	return query.data.available
		? { status: "available" }
		: { status: "unavailable", reason: query.data.reason };
}
