import { useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { GitServiceContract } from "../contracts/schemas.js";

export interface UseInitRepositoryResult {
	readonly isPending: boolean;
	/**
	 * Initialize `workingDirectory` as a git repository. `onSuccess` runs
	 * after the invalidation pass — callers whose data bypasses TanStack
	 * (the Changes panel's raw patch fetch) retry there.
	 */
	init(workingDirectory: string, onSuccess?: () => void): void;
}

/**
 * The `init` mutation shared by the two Initialize Git entry points (the
 * Changes panel's 404 state and the composer footer buttons). Success
 * invalidates the repositoryType/branches/status queries app-wide
 * (`[featureId, channel]` prefix match), so every gated UI refreshes;
 * failures surface as a toast.
 */
export function useInitRepository(): UseInitRepositoryResult {
	const sdk = useSdk<GitServiceContract>("git");
	const mutation = useSdkMutation(sdk, "init", {
		invalidates: ["repositoryType", "branches", "status"],
	});
	return {
		isPending: mutation.isPending,
		init: (workingDirectory, onSuccess) =>
			mutation.mutate(
				{ workingDirectory },
				{
					...(onSuccess !== undefined ? { onSuccess } : {}),
					onError: (error) => {
						toast.error("Could not initialize git", {
							description: error instanceof Error ? error.message : "Unknown git error.",
						});
					},
				},
			),
	};
}
