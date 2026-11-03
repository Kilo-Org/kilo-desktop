import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { KernelShell } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { ModelPreferences } from "@kilo-desktop/plugin-chat/contracts";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { PullRequests, Repository, type GithubCliStatus } from "../../contracts/index.js";
import { usePullRequestEntry } from "../pull-requests/use-pull-request.js";
import { branchAwaitingLookup, visiblePullRequest } from "../pull-requests/select.js";
import {
	normalizeDefaultBranch,
	repositoryActions,
	type RepositoryActionModel,
	type RepositoryMenuAction,
} from "../repository-actions.js";
import {
	branchesQuery,
	invalidateRepositoryQueries,
	originUrlQuery,
	repositoryTypeQuery,
	statusQuery,
	workingTreeStatsQuery,
} from "../repository-queries.js";
import type { ActionProgress, GitActionKind } from "./action-progress.js";
import { createSourceControlWriter, type SourceControlWriter } from "./source-control-writer.js";

export const COMMIT_MESSAGE_GENERATED = "Commit Message Generated";
export const PULL_REQUEST_CONTENT_GENERATED = "Pull Request Content Generated";

const GITHUB_CLI_INSTALL_URL = "https://cli.github.com/";
const NON_BLOCKING_TOAST_CLASS = "pointer-events-none [&_button]:pointer-events-auto";
const SETUP_TOAST_DURATION_MS = 15_000;

export type RepositoryActions = Omit<RepositoryActionModel, "menu"> & {
	stats: { additions: number; deletions: number } | undefined;
	busy: boolean;
	progressLabel: string | null;
	pushError: string | null;
	dismissPushError: () => void;
	refreshMenu: () => void;
	push: () => void;
	runQuickAction: () => void;
	menu: readonly (RepositoryMenuAction & { run: () => void })[];
};

/** Marks the step now running: its progress label and the failure copy if it throws. */
type Step = (progressLabel: string, failureLabel: string) => void;

/** Thrown to stop a flow after the user was already guided (no error toast). */
class ActionAbandoned extends Error {}

const errorText = (error: unknown) =>
	error instanceof Error ? error.message : "The Git operation failed.";

/**
 * Setup guidance for a pull request action the GitHub CLI can't serve.
 * Background lookups never raise it, so people without `gh` are not nagged.
 */
function showGithubSetupToast(
	status: Exclude<GithubCliStatus, "ready">,
	openExternal: (url: string) => void,
) {
	if (status === "missing") {
		toast.error("GitHub CLI is not installed", {
			description: "Install GitHub CLI to show and create pull requests.",
			duration: SETUP_TOAST_DURATION_MS,
			className: NON_BLOCKING_TOAST_CLASS,
			action: { label: "Install", onClick: () => openExternal(GITHUB_CLI_INSTALL_URL) },
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

/** Commit and pull request text through kilo.agent, with the model new chats start with. */
function useWriter(): SourceControlWriter | null {
	const conversations = useDomain(Conversations);
	const modelPreferences = useDomain(ModelPreferences);
	return useMemo(() => {
		if (!conversations) return null;
		return createSourceControlWriter({
			generate: (input) => conversations.methods.generate(input),
			model: () => {
				const preferred = modelPreferences?.getState().preferred;
				if (!preferred) return undefined;
				return {
					providerID: preferred.providerID,
					modelID: preferred.modelID,
					...(preferred.variant ? { variant: preferred.variant } : {}),
				};
			},
		});
	}, [conversations, modelPreferences]);
}

/** One subscription for the header control: repository reads, its pull request and runners. */
export function useRepositoryActions(
	directory: string,
	progressStore: ActionProgress,
): RepositoryActions | null {
	const repository = useDomain(Repository);
	const pullRequests = useDomain(PullRequests);
	const shell = useDomain(KernelShell);
	const telemetry = useDomain(Telemetry);
	const writer = useWriter();
	const queries = useQueryClient();
	const [pushError, setPushError] = useState<string | null>(null);

	const statusRead = useQuery(statusQuery(repository, directory));
	const typeRead = useQuery(repositoryTypeQuery(repository, directory));
	const branchesRead = useQuery({
		...branchesQuery(repository, directory),
		enabled: repository !== null && typeRead.data?.kind === "regular",
	});
	const originRead = useQuery(originUrlQuery(repository, directory));
	const statsRead = useQuery(workingTreeStatsQuery(repository, directory));
	const status = statusRead.data;
	const checkedOut = status
		? { branch: status.currentBranch, observedAt: statusRead.dataUpdatedAt }
		: undefined;
	const entry = usePullRequestEntry(directory);
	const pullRequest = visiblePullRequest(entry, checkedOut);
	const progress = useSyncExternalStore(progressStore.subscribe, progressStore.get)[directory];
	const defaultBranch = normalizeDefaultBranch(branchesRead.data?.defaultBranch);
	const model =
		status == null
			? null
			: repositoryActions({ status, origin: originRead.data ?? null, defaultBranch, pullRequest });

	const refreshPullRequest = (settle = false) =>
		void pullRequests?.methods.refresh({ directory, settle }).catch(() => undefined);
	const openExternal = (url: string): Promise<boolean> =>
		shell?.methods.openExternal({ url }).catch(() => false) ?? Promise.resolve(false);
	const track = (event: string) =>
		void telemetry?.methods.track({ event, data: {} }).catch(() => undefined);

	// A branch the last lookup has not seen is looked up now instead of at the
	// next poll, once per directory and branch: status re-reads while that
	// lookup runs must not queue more, and a failed lookup is left to backoff.
	const awaiting = branchAwaitingLookup(entry, checkedOut);
	const requested = useRef<string | null>(null);
	useEffect(() => {
		if (!awaiting) return;
		const key = `${directory}\n${awaiting}`;
		if (requested.current === key) return;
		requested.current = key;
		void pullRequests?.methods.refresh({ directory }).catch(() => undefined);
	}, [awaiting, directory, pullRequests]);

	const invalidate = () =>
		invalidateRepositoryQueries(queries, ["status", "branches", "originUrl", "workingTreeStats"]);

	/** Remote refresh: main coalesces and throttles the fetch. */
	function refreshRemote() {
		if (!repository) return;
		void repository.methods
			.fetch({ directory })
			.catch(() => undefined)
			.then(invalidate)
			.catch(() => undefined);
		refreshPullRequest();
	}

	useEffect(() => {
		refreshRemote();
		// Fetch once when this repository is shown, not on every status render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [directory, repository]);

	/**
	 * Runs a multi-step action. Push failures open a details dialog; other
	 * failures toast the step that failed. The local refresh afterwards runs
	 * regardless of outcome (earlier steps may have succeeded) and can never
	 * turn a success into a failure toast.
	 */
	async function run(action: GitActionKind, operation: (step: Step) => Promise<void>) {
		if (!progressStore.start(directory, action)) return;
		setPushError(null);
		let failureLabel = action === "pr" ? "create pull request" : action;
		const step: Step = (label, failure) => {
			progressStore.setLabel(directory, label);
			failureLabel = failure;
		};
		try {
			await operation(step);
		} catch (error) {
			if (!(error instanceof ActionAbandoned)) {
				if (failureLabel === "push") setPushError(errorText(error));
				else toast.error(`Unable to ${failureLabel}`, { description: errorText(error) });
			}
		} finally {
			progressStore.finish(directory);
		}
		await invalidate().catch(() => undefined);
		refreshPullRequest(true);
	}

	function requireRepository() {
		if (!repository) throw new Error("Git isn't available.");
		return repository;
	}

	function requireWriter() {
		if (!writer) throw new Error("Kilo text generation is unavailable.");
		return writer;
	}

	/**
	 * The branch checked out now, read from git rather than the rendered
	 * status: a session worktree's branch can be renamed mid-flow (e.g. while
	 * a commit message is generating).
	 */
	async function readCheckedOutBranch() {
		const live = await requireRepository().methods.status({ directory });
		if (!live?.currentBranch) throw new Error("Checkout a branch before creating a pull request.");
		return live.currentBranch;
	}

	/**
	 * Checks `gh` right before the PR step, so earlier commit and push steps
	 * never depend on it; an unusable CLI raises setup guidance instead of an
	 * error toast.
	 */
	async function ensureGithubCli() {
		const { status: cliStatus } = await requireRepository().methods.githubCliStatus({
			force: true,
		});
		if (cliStatus === "ready") return;
		showGithubSetupToast(cliStatus, (url) => void openExternal(url));
		throw new ActionAbandoned();
	}

	async function pushStep(step: Step) {
		step("Pushing...", "push");
		await requireRepository().methods.push({ directory });
	}

	async function commitStep(step: Step) {
		const generator = requireWriter();
		step("Staging changes...", "stage changes");
		const context = await requireRepository().methods.stageChanges({ directory });
		step("Generating commit message...", "generate a commit message");
		const message = await generator.generateCommitMessage({ directory, ...context });
		track(COMMIT_MESSAGE_GENERATED);
		step("Committing...", "commit");
		await requireRepository().methods.commit({ directory, message });
	}

	async function pullRequestStep(step: Step) {
		await ensureGithubCli();
		const generator = requireWriter();
		step("Generating PR content...", "generate pull request content");
		const headBranch = await readCheckedOutBranch();
		const baseBranch = defaultBranch!;
		const context = await requireRepository().methods.pullRequestContext({
			directory,
			baseBranch,
		});
		const generated = await generator.generatePullRequest({
			directory,
			baseBranch,
			headBranch,
			...context,
		});
		track(PULL_REQUEST_CONTENT_GENERATED);
		step("Creating draft PR...", "create pull request");
		const created = await requireRepository().methods.createPullRequest({
			directory,
			baseBranch,
			headBranch,
			title: generated.title,
			body: generated.body,
		});
		void pullRequests?.methods
			.recordCreated({ directory, branch: headBranch, pullRequest: created })
			.catch(() => undefined);
		if (!(await openExternal(created.url))) {
			toast.success(`Draft PR #${created.number} created`, { description: created.url });
		}
	}

	const hasUpstream = model?.hasUpstream ?? false;
	const push = () => void run("push", pushStep);
	const pull = () =>
		void run("pull", async (step) => {
			step("Pulling...", "pull");
			await requireRepository().methods.pull({ directory });
		});
	const viewPullRequest = () => {
		if (pullRequest) void openExternal(pullRequest.url);
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
	const runMenu = (id: RepositoryMenuAction["id"]) => {
		if (id === "commit") return void run("commit", commitStep);
		if (id === "push") return push();
		if (id === "view-pr") return viewPullRequest();
		createPullRequest();
	};

	if (!model) return null;
	return {
		...model,
		stats: statsRead.data,
		busy: progress !== undefined,
		progressLabel: progress?.label ?? null,
		pushError,
		dismissPushError: () => setPushError(null),
		refreshMenu: refreshRemote,
		push,
		runQuickAction,
		menu: model.menu.map((action) => ({ ...action, run: () => runMenu(action.id) })),
	};
}
