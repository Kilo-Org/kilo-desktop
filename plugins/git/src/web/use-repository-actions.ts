import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { GitServiceContract } from "../contracts/schemas.js";
import { selectPullRequest, useGitPrStatusStore } from "./git-pr-status-store.js";
import {
	normalizeDefaultBranch,
	repositoryActions,
	type RepositoryActionModel,
	type RepositoryMenuAction,
} from "./repository-actions.js";

interface SourceControlWriterCapability extends Record<string, unknown> {
	sourceControlWriter: {
		generateCommitMessage(input: {
			workspaceDirectory: string;
			statusSummary: string;
			diffPatch: string;
			recentCommitSubjects: string[];
		}): Promise<string>;
		generatePullRequest(input: {
			workspaceDirectory: string;
			baseBranch: string;
			headBranch: string;
			commitSummary: string;
			diffSummary: string;
			diffPatch: string;
			recentCommitSubjects: string[];
			pullRequestTemplate: string | null;
		}): Promise<{ title: string; body: string }>;
	};
}

export type RepositoryActions = Omit<RepositoryActionModel, "menu"> & {
	stats: { additions: number; deletions: number } | undefined;
	busy: boolean;
	progressLabel: string | null;
	refreshMenu: () => void;
	push: () => void;
	runQuickAction: () => void;
	menu: readonly (RepositoryMenuAction & { run: () => void })[];
};

type BusyAction = "commit" | "pull" | "push" | "pr";
/** Marks the step now running: its progress label and the failure copy if it throws. */
type Step = (progressLabel: string, failureLabel: string) => void;

/** Thrown to stop a flow after the user was already guided (no error toast). */
class ActionAbandoned extends Error {}

/** One subscription for the header control: queries, PR snapshot, and runners. */
export function useRepositoryActions(workspaceDirectory: string): RepositoryActions | null {
	const sdk = useSdk<GitServiceContract>("git");
	const queryClient = useQueryClient();
	const refreshPullRequest = useGitPrStatusStore((state) => state.refresh);
	const statusQuery = useSdkQuery(sdk, "status", { workingDirectory: workspaceDirectory });
	const branchesQuery = useSdkQuery(sdk, "branches", { workingDirectory: workspaceDirectory });
	const originQuery = useSdkQuery(sdk, "originUrl", { workingDirectory: workspaceDirectory });
	const workingTreeStatsQuery = useSdkQuery(sdk, "workingTreeStats", {
		workingDirectory: workspaceDirectory,
	});
	const status = statusQuery.data;
	const pullRequest = useGitPrStatusStore((state) =>
		selectPullRequest(state, {
			directory: workspaceDirectory,
			...(status?.currentBranch ? { branch: status.currentBranch } : {}),
		}),
	);
	const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
	const [progressLabel, setProgressLabel] = useState<string | null>(null);
	const defaultBranch = normalizeDefaultBranch(branchesQuery.data?.defaultBranch);
	const model =
		status == null
			? null
			: repositoryActions({
					status,
					origin: originQuery.data ?? null,
					defaultBranch,
					pullRequest,
				});

	async function invalidateRepositoryQueries() {
		await Promise.all(
			(["status", "branches", "originUrl", "workingTreeStats"] as const).map((channel) =>
				queryClient.invalidateQueries({ queryKey: [sdk.featureId, channel] }),
			),
		);
	}

	/** Remote refresh: the main process coalesces and throttles the fetch. */
	function refreshRemote() {
		void sdk.client
			.fetch({ workingDirectory: workspaceDirectory })
			.catch(() => undefined)
			.then(invalidateRepositoryQueries)
			.catch(() => undefined);
		refreshPullRequest(workspaceDirectory);
	}

	useEffect(() => {
		refreshRemote();
		// Fetch once when this active repository changes, not on every status render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshPullRequest, workspaceDirectory]);

	/**
	 * Runs a multi-step action. A failure toasts the step that failed; the
	 * local refresh afterwards runs regardless of outcome (earlier steps may
	 * have succeeded) and can never turn a success into a failure toast.
	 */
	async function run(action: BusyAction, operation: (step: Step) => Promise<void>) {
		setBusyAction(action);
		let failureLabel = action === "pr" ? "create pull request" : action;
		const step: Step = (progress, failure) => {
			setProgressLabel(progress);
			failureLabel = failure;
		};
		try {
			await operation(step);
		} catch (error) {
			if (!(error instanceof ActionAbandoned)) {
				toast.error(`Unable to ${failureLabel}`, {
					description: error instanceof Error ? error.message : "The Git operation failed.",
				});
			}
		} finally {
			setBusyAction(null);
			setProgressLabel(null);
		}
		await invalidateRepositoryQueries().catch(() => undefined);
		refreshPullRequest(workspaceDirectory, true);
	}

	const currentBranch = model?.currentBranch;
	const hasUpstream = model?.hasUpstream ?? false;

	function writer() {
		const capability = sdk.plugins.get<SourceControlWriterCapability>("kilo-ui");
		if (!capability?.sourceControlWriter) throw new Error("Kilo text generation is unavailable.");
		return capability.sourceControlWriter;
	}

	/**
	 * Checks `gh` right before the PR step, so earlier commit/push steps never
	 * depend on it (t3code parity); an unusable CLI raises setup guidance
	 * instead of an error toast.
	 */
	async function ensureGithubCli() {
		const { status: cliStatus } = await sdk.client.githubCliStatus({ force: true });
		useGitPrStatusStore.getState().setGithubStatus(cliStatus);
		if (cliStatus === "ready") return;
		useGitPrStatusStore.getState().requestGithubSetup(cliStatus);
		throw new ActionAbandoned();
	}

	async function pushStep(step: Step) {
		step("Pushing...", "push");
		await sdk.client.push({
			workingDirectory: workspaceDirectory,
			branch: currentBranch!,
			hasUpstream,
		});
	}

	async function commitStep(step: Step) {
		const generator = writer();
		step("Staging changes...", "stage changes");
		const context = await sdk.client.stageChanges({ workingDirectory: workspaceDirectory });
		step("Generating commit message...", "generate a commit message");
		const message = await generator.generateCommitMessage({ workspaceDirectory, ...context });
		step("Committing...", "commit");
		await sdk.client.commit({ workingDirectory: workspaceDirectory, message });
	}

	async function pullRequestStep(step: Step) {
		await ensureGithubCli();
		const generator = writer();
		step("Generating PR content...", "generate pull request content");
		const context = await sdk.client.pullRequestContext({
			workingDirectory: workspaceDirectory,
			baseBranch: defaultBranch!,
		});
		const generated = await generator.generatePullRequest({
			workspaceDirectory,
			baseBranch: defaultBranch!,
			headBranch: currentBranch!,
			...context,
		});
		step("Creating draft PR...", "create pull request");
		const created = await sdk.client.createPullRequest({
			workingDirectory: workspaceDirectory,
			baseBranch: defaultBranch!,
			headBranch: currentBranch!,
			title: generated.title,
			body: generated.body,
		});
		const opened = await sdk.shell.openExternal(created.url).catch(() => ({ opened: false }));
		if (!opened.opened) {
			toast.success(`Draft PR #${created.number} created`, { description: created.url });
		}
	}

	const push = () => void run("push", pushStep);
	const pull = () =>
		void run("pull", async (step) => {
			step("Pulling...", "pull");
			await sdk.client.pull({ workingDirectory: workspaceDirectory });
		});
	const viewPullRequest = () => {
		if (pullRequest) void sdk.shell.openExternal(pullRequest.url);
	};
	const createPullRequest = () =>
		void run("pr", async (step) => {
			if (!hasUpstream || (model?.ahead ?? 0) > 0) await pushStep(step);
			await pullRequestStep(step);
		});

	const runQuickAction = () => {
		if (!model) return;
		const kind = model.quickAction.kind;
		if (kind === "disabled") return;
		if (kind === "view-pr") return viewPullRequest();
		if (kind === "push") return push();
		if (kind === "pull") return pull();
		if (kind === "create-pr") return createPullRequest();
		void run("commit", async (step) => {
			await commitStep(step);
			if (kind === "commit") return;
			await pushStep(step);
			if (kind === "commit-push-pr") await pullRequestStep(step);
		});
	};
	const runMenu = (id: RepositoryActionModel["menu"][number]["id"]) => {
		if (id === "commit") return void run("commit", commitStep);
		if (id === "push") return push();
		if (id === "view-pr") return viewPullRequest();
		createPullRequest();
	};

	if (!model) return null;
	return {
		...model,
		stats: workingTreeStatsQuery.data,
		busy: busyAction !== null,
		progressLabel,
		refreshMenu: refreshRemote,
		push,
		runQuickAction,
		menu: model.menu.map((action) => ({ ...action, run: () => runMenu(action.id) })),
	};
}
