import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { AgentServer, type ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import { Vcs, Workspaces, type VcsImplementation } from "@kilo-desktop/plugin-workspaces/contracts";

import type { IsolationOptions, WorkSession, WorkSessionIsolation } from "../contracts";

/** Where a session was placed: its worktree, or nothing for the workspace's checkout. */
export interface Placement {
	readonly isolation: WorkSessionIsolation["kind"];
	readonly directory?: string;
	readonly branch?: string;
	readonly baseRef?: string;
	/** kilo.sessions created the worktree, so it removes it again on failure. */
	readonly created?: boolean;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const NO_VCS = "Git worktrees are unavailable — the Git plugin is not active.";

export function vcsOf(sdk: PluginSdk): VcsImplementation | undefined {
	return sdk.extensions.exclusive(Vcs).winner?.implementation;
}

function primaryFolder(sdk: PluginSdk, workspaceId: string | null): string {
	if (!workspaceId) throw new KernelError("VALIDATION", "Worktree sessions need a workspace.");
	const workspace = sdk.domains
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === workspaceId);
	if (!workspace) throw new KernelError("NOT_FOUND", "Workspace not found.");
	const primary = workspace.folders.find((folder) => folder.isPrimary) ?? workspace.folders[0];
	if (!primary) throw new KernelError("VALIDATION", "The workspace has no primary folder.");
	return primary.path;
}

function rethrow(label: string, error: unknown): never {
	const code = error instanceof KernelError ? error.code : "UNAVAILABLE";
	throw new KernelError(code, `Could not ${label}: ${errorText(error)}`);
}

/**
 * Creates or resolves the worktree a new session asks for. A requested
 * worktree never degrades to the workspace's checkout: without version
 * control, a workspace or its primary folder, creating the session fails.
 */
export async function placeSession(
	sdk: PluginSdk,
	workspaceId: string | null,
	isolation: WorkSessionIsolation | undefined,
): Promise<Placement | undefined> {
	if (!isolation) return undefined;
	if (isolation.kind === "local") return { isolation: "local" };
	const directory = primaryFolder(sdk, workspaceId);
	const vcs = vcsOf(sdk);
	if (!vcs) throw new KernelError("UNAVAILABLE", NO_VCS);
	if (isolation.kind === "existing-worktree") {
		const resolved = await vcs
			.resolveWorktree({ directory, worktree: isolation.directory })
			.catch((error: unknown) => rethrow("use the worktree", error));
		return {
			isolation: "existing-worktree",
			directory: resolved.directory,
			branch: resolved.branch,
		};
	}
	const created = await vcs
		.createWorktree({
			directory,
			...(isolation.baseBranch ? { baseBranch: isolation.baseBranch } : {}),
		})
		.catch((error: unknown) => rethrow("create the worktree", error));
	if (created.warning) sdk.logger.warn(`Worktree ${created.directory}: ${created.warning}`);
	return {
		isolation: "new-worktree",
		directory: created.directory,
		branch: created.branch,
		...(created.baseRef ? { baseRef: created.baseRef } : {}),
		created: true,
	};
}

/** Removes a worktree this plugin created for a session that couldn't be created. */
export async function discardPlacement(sdk: PluginSdk, placement: Placement): Promise<void> {
	if (!placement.created || !placement.directory) return;
	try {
		await vcsOf(sdk)?.removeWorktree({ directory: placement.directory });
	} catch (error) {
		sdk.logger.warn(`Could not remove the worktree ${placement.directory}: ${errorText(error)}`);
	}
}

/**
 * Removes a deleted session's worktree: the directory's Kilo instance is
 * released first (best effort — a directory still in use only makes the
 * removal fail, which is reported), then the worktree and its managed branch.
 */
export async function removeSessionWorktree(sdk: PluginSdk, directory: string): Promise<void> {
	const vcs = vcsOf(sdk);
	if (!vcs) throw new KernelError("UNAVAILABLE", NO_VCS);
	try {
		await sdk.domains.get(AgentServer)?.methods.disposeInstance({ directory });
	} catch (error) {
		sdk.logger.warn(`Could not release the Kilo instance for ${directory}: ${errorText(error)}`);
	}
	await vcs.removeWorktree({ directory });
}

/** The branches and worktrees a new session in the workspace can choose from. */
export async function isolationOptions(
	sdk: PluginSdk,
	workspaceId: string,
): Promise<IsolationOptions | null> {
	const vcs = vcsOf(sdk);
	if (!vcs) return null;
	let directory: string;
	try {
		directory = primaryFolder(sdk, workspaceId);
	} catch {
		return null;
	}
	const [branches, worktrees] = await Promise.all([
		vcs.branches(directory).catch(() => null),
		vcs.worktrees(directory).catch(() => null),
	]);
	if (!branches) return null;
	const defaultBranch =
		branches.defaultBranch ?? (await vcs.defaultBranch(directory).catch(() => null));
	return {
		directory,
		currentBranch: branches.currentBranch ?? null,
		defaultBranch: defaultBranch ?? null,
		branches: branches.branches.map(({ name, kind, ref, upstream }) => ({
			name,
			kind,
			ref,
			upstream,
		})),
		recentBranches: [...branches.recentBranches],
		worktrees: (worktrees ?? [])
			.filter((worktree) => !worktree.isMain && worktree.path !== directory)
			.map(({ path, name, branch }) => ({ directory: path, name, branch })),
	};
}

/** Never throws: a failed link only costs the Agent Manager entry its chat. */
export async function linkAgentManager(
	sdk: PluginSdk,
	input: { directory: string; sessionId: string; baseRef?: string | undefined },
): Promise<boolean> {
	const vcs = vcsOf(sdk);
	if (!vcs) return false;
	try {
		return await vcs.linkAgentManagerSession({
			directory: input.directory,
			sessionId: input.sessionId,
			...(input.baseRef ? { baseRef: input.baseRef } : {}),
		});
	} catch (error) {
		sdk.logger.warn(
			`Could not link chat ${input.sessionId} for the VS Code Agent Manager: ${errorText(error)}`,
		);
		return false;
	}
}

/**
 * One chat per worktree for the Agent Manager backfill: the most recently
 * updated live root chat, else an archived one (an archived link still lets
 * the Agent Manager open the conversation and delete the worktree).
 */
export function worktreeChatLinks(
	chats: readonly ChatSummary[],
): { directory: string; chatId: string }[] {
	const archived = (chat: ChatSummary) => chat.archivedAt !== undefined;
	const byDirectory = new Map<string, ChatSummary>();
	for (const chat of chats) {
		if (chat.parentId || !chat.directory || !chat.worktreeBranch) continue;
		const current = byDirectory.get(chat.directory);
		const outranks =
			!current ||
			(archived(chat) !== archived(current) ? !archived(chat) : chat.updatedAt > current.updatedAt);
		if (outranks) byDirectory.set(chat.directory, chat);
	}
	return [...byDirectory].map(([directory, chat]) => ({ directory, chatId: chat.id }));
}

/** Whether a session placed in a worktree at creation should link its first chat. */
export function linksFirstChat(session: WorkSession): boolean {
	return (
		(session.isolation === "new-worktree" || session.isolation === "existing-worktree") &&
		session.directory !== null &&
		session.chatIds.length === 0
	);
}
