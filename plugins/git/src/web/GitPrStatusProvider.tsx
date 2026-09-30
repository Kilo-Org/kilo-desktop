import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import { sdkQueryKey, useSdk } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { MAX_BATCHED_DIRECTORIES, type GitServiceContract } from "../contracts/schemas.js";
import {
	type GitPrSnapshot,
	type GithubCapabilityStatus,
	useGitPrStatusStore,
} from "./git-pr-status-store.js";
import { PrStatusScheduler, type PrStatusLoadResult } from "./pr-status-scheduler.js";

const INSTALL_URL = "https://cli.github.com/";
const NON_BLOCKING_TOAST_CLASS = "pointer-events-none [&_button]:pointer-events-auto";
const SETUP_TOAST_DURATION_MS = 15_000;

/**
 * App-lifetime pull request status coordinator. Background polling is
 * silent: an unusable GitHub CLI only records its status, so users without
 * `gh` (or without GitHub remotes) never see errors. Setup guidance appears
 * only when a user-initiated PR action raises `githubSetupRequest`.
 */
export function GitPrStatusProvider({ children }: { readonly children: ReactNode }) {
	const sdk = useSdk<GitServiceContract>("git");
	const queryClient = useQueryClient();
	const schedulerRef = useRef<PrStatusScheduler | null>(null);
	const sdkRef = useRef(sdk);
	sdkRef.current = sdk;

	function showSetupToast(status: Exclude<GithubCapabilityStatus, "ready">) {
		if (status === "missing") {
			toast.error("GitHub CLI is not installed", {
				description: "Install GitHub CLI to show and create pull requests.",
				duration: SETUP_TOAST_DURATION_MS,
				className: NON_BLOCKING_TOAST_CLASS,
				action: {
					label: "Install",
					onClick: () => void sdkRef.current.shell.openExternal(INSTALL_URL),
				},
			});
			return;
		}
		if (status === "unauthenticated") {
			toast.error("GitHub CLI needs authentication", {
				description: "Run gh auth login in your terminal, then retry creating the pull request.",
				duration: SETUP_TOAST_DURATION_MS,
				className: NON_BLOCKING_TOAST_CLASS,
			});
			return;
		}
		toast.error(status === "timeout" ? "GitHub CLI timed out" : "GitHub CLI is unavailable", {
			description: "Check your GitHub CLI installation and network, then try again.",
			duration: SETUP_TOAST_DURATION_MS,
			className: NON_BLOCKING_TOAST_CLASS,
		});
	}

	useEffect(() => {
		const apply = (directory: string, snapshot: GitPrSnapshot): PrStatusLoadResult => {
			const target = useGitPrStatusStore
				.getState()
				.targets.find((candidate) => candidate.directory === directory);
			if (!target) return;
			if (snapshot.githubStatus !== "unsupported") {
				useGitPrStatusStore.getState().setGithubStatus(snapshot.githubStatus);
			}
			// Keep the cached snapshot while the CLI is unusable.
			if (snapshot.githubStatus !== "ready" && snapshot.githubStatus !== "unsupported") {
				return "unavailable";
			}
			useGitPrStatusStore.getState().setSnapshot(target.id, snapshot);
			queryClient.setQueryData(
				sdkQueryKey(sdk, "pullRequest", { workingDirectory: directory }),
				snapshot.pullRequest,
			);
		};
		const load = async (directory: string): Promise<PrStatusLoadResult> =>
			apply(directory, await sdk.client.pullRequestSnapshot({ workingDirectory: directory }));
		const loadMany = async (directories: readonly string[]) => {
			const answers = new Map<string, PrStatusLoadResult>();
			for (let start = 0; start < directories.length; start += MAX_BATCHED_DIRECTORIES) {
				const results = await sdk.client.pullRequestSnapshots({
					workingDirectories: directories.slice(start, start + MAX_BATCHED_DIRECTORIES),
				});
				for (const { workingDirectory, snapshot } of results) {
					if (snapshot) answers.set(workingDirectory, apply(workingDirectory, snapshot));
				}
			}
			return answers;
		};
		const scheduler = new PrStatusScheduler({
			getTargets: () => useGitPrStatusStore.getState().targets,
			load,
			loadMany,
			isVisible: () => document.visibilityState === "visible",
		});
		schedulerRef.current = scheduler;
		scheduler.start();
		scheduler.consumeRefreshRequests(useGitPrStatusStore.getState().refreshRequests);
		const unsubscribe = useGitPrStatusStore.subscribe((next, previous) => {
			if (next.targets !== previous.targets) void scheduler.syncTargets(next.targets);
			if (next.refreshRequests !== previous.refreshRequests) {
				scheduler.consumeRefreshRequests(next.refreshRequests);
			}
		});
		return () => {
			unsubscribe();
			scheduler.stop();
			if (schedulerRef.current === scheduler) schedulerRef.current = null;
		};
	}, [queryClient, sdk]);

	useEffect(
		() =>
			useGitPrStatusStore.subscribe((next, previous) => {
				const request = next.githubSetupRequest;
				if (request && request.id !== previous.githubSetupRequest?.id) {
					showSetupToast(request.status);
				}
			}),
		// Toast helpers close over refs and stable state setters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	return children;
}
