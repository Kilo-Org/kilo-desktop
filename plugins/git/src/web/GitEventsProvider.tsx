import { useEffect, type ReactNode } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { useSdk } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";

/**
 * App-lifetime provider that wires git main-side events to the renderer
 * query cache. Subscribes once on mount so invalidation fires even when
 * no `GitBranchLabel` is currently mounted.
 */
export function GitEventsProvider({ children }: { readonly children?: ReactNode }) {
	const sdk = useSdk<GitServiceContract>("git");
	const queryClient = useQueryClient();

	useEffect(
		() =>
			sdk.events.on(`${sdk.featureId}.worktree-branch-renamed`, () => {
				void queryClient.invalidateQueries({ queryKey: [sdk.featureId, "branches"] });
			}),
		[sdk, queryClient],
	);

	return children ?? null;
}
