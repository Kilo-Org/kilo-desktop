import { useQuery } from "@tanstack/react-query";

import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";
import { selectPullRequest, useGitPrStatusStore } from "./git-pr-status-store.js";

/**
 * A session's pull request as the header shows it. Reads, but never
 * fetches, the header's cached `status` for the directory: one `git status`
 * per sidebar row would be wasteful, and only the open session's header
 * keeps that status current.
 */
export function useSessionPullRequest(directory: string) {
	const sdk = useSdk<GitServiceContract>("git");
	const { data: status, dataUpdatedAt } = useQuery({
		...sdkQueryOptions(sdk, "status", { workingDirectory: directory }),
		enabled: false,
	});
	return useGitPrStatusStore((state) =>
		selectPullRequest(
			state,
			directory,
			status ? { branch: status.currentBranch, observedAt: dataUpdatedAt } : undefined,
		),
	);
}
