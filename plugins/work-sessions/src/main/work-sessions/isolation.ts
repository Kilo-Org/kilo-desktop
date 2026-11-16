import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { KiloServer, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import {
	HAS_VCS_KEY,
	Vcs,
	Workspaces,
	type IsolationOptions,
	type VcsImplementation,
	type WorkSession,
	type WorkSessionIsolation,
} from "../../contracts/model";

/** Where a work session was placed: its copy, or nothing for the workspace's checkout. */
export interface Placement {
	readonly isolation: WorkSessionIsolation["kind"];
	readonly directory?: string;
	readonly branch?: string;
	readonly baseRef?: string;
	/** kilo.work-sessions created the copy, so it removes it again on failure. */
	readonly created?: boolean;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const NO_VCS = "Isolated copies are unavailable — no version control plugin is active.";

export function vcsOf(sdk: PluginSdk): VcsImplementation | undefined {
	return sdk.extensions.exclusive(Vcs).winner?.implementation;
}

/** Keeps `hasVcs` true while the `vcs` point's winner is implemented. */
export function followVcs(sdk: PluginSdk): void {
	const local = HAS_VCS_KEY.slice(HAS_VCS_KEY.indexOf("/") + 1);
	const publish = () => sdk.context.set(local, vcsOf(sdk) !== undefined);
	publish();
	sdk.extensions.subscribe(Vcs, publish);
}

function primaryFolder(sdk: PluginSdk, workspaceId: string | null): string {
	if (!workspaceId) throw new KernelError("VALIDATION", "Isolated sessions need a workspace.");
	const workspace = sdk.domainObjects
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
 * Creates or resolves the copy a new work session asks for. A requested copy
 * never degrades to the workspace's checkout: without version control, a
 * workspace or its primary folder, creating the work session fails.
 */
export async function placeWorkSession(
	sdk: PluginSdk,
	workspaceId: string | null,
	isolation: WorkSessionIsolation | undefined,
): Promise<Placement | undefined> {
	if (!isolation) return undefined;
	if (isolation.kind === "local") return { isolation: "local" };
	const directory = primaryFolder(sdk, workspaceId);
	const vcs = vcsOf(sdk);
	if (!vcs) throw new KernelError("UNAVAILABLE", NO_VCS);
	if (isolation.kind === "existing-copy") {
		const resolved = await vcs
			.resolveCopy({ directory, copy: isolation.directory })
			.catch((error: unknown) => rethrow("use the copy", error));
		return { isolation: "existing-copy", directory: resolved.directory, branch: resolved.branch };
	}
	const created = await vcs
		.createCopy({
			directory,
			...(isolation.baseBranch ? { baseBranch: isolation.baseBranch } : {}),
		})
		.catch((error: unknown) => rethrow("create the copy", error));
	if (created.warning) sdk.logger.warn(`Copy ${created.directory}: ${created.warning}`);
	return {
		isolation: "new-copy",
		directory: created.directory,
		branch: created.branch,
		...(created.baseRef ? { baseRef: created.baseRef } : {}),
		created: true,
	};
}

/** Removes a copy this plugin created for a work session that couldn't be created. */
export async function discardPlacement(sdk: PluginSdk, placement: Placement): Promise<void> {
	if (!placement.created || !placement.directory) return;
	try {
		await vcsOf(sdk)?.removeCopy({ directory: placement.directory });
	} catch (error) {
		sdk.logger.warn(`Could not remove the copy ${placement.directory}: ${errorText(error)}`);
	}
}

/**
 * Removes a deleted work session's copy: the directory's Kilo instance is
 * released first (best effort — a directory still in use only makes the
 * removal fail, which is reported), then the copy and its managed branch.
 */
export async function removeWorkSessionCopy(sdk: PluginSdk, directory: string): Promise<void> {
	const vcs = vcsOf(sdk);
	if (!vcs) throw new KernelError("UNAVAILABLE", NO_VCS);
	try {
		await sdk.domainObjects.get(KiloServer)?.methods.disposeInstance({ directory });
	} catch (error) {
		sdk.logger.warn(`Could not release the Kilo instance for ${directory}: ${errorText(error)}`);
	}
	await vcs.removeCopy({ directory });
}

/** The branches and copies a new work session in the workspace can choose from. */
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
	const [branches, copies] = await Promise.all([
		vcs.branches(directory).catch(() => null),
		vcs.copies(directory).catch(() => null),
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
		copies: (copies ?? [])
			.filter((copy) => !copy.isMain && copy.path !== directory)
			.map(({ path, name, branch }) => ({ directory: path, name, branch })),
	};
}

/** Never throws: a failed link only costs the Agent Manager entry its chat. */
export async function linkAgentManager(
	sdk: PluginSdk,
	input: { directory: string; chatId: string; baseRef?: string | undefined },
): Promise<boolean> {
	const vcs = vcsOf(sdk);
	if (!vcs) return false;
	try {
		return await vcs.linkAgentManagerSession({
			directory: input.directory,
			chatId: input.chatId,
			...(input.baseRef ? { baseRef: input.baseRef } : {}),
		});
	} catch (error) {
		sdk.logger.warn(
			`Could not link chat ${input.chatId} for the VS Code Agent Manager: ${errorText(error)}`,
		);
		return false;
	}
}

/**
 * One chat per copy for the Agent Manager backfill: the most recently
 * updated live root chat, else an archived one (an archived link still lets
 * the Agent Manager open the conversation and delete the copy).
 */
export function copyChatLinks(
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

/** Whether a work session placed in a copy at creation should link its first chat. */
export function linksFirstChat(workSession: WorkSession): boolean {
	return (
		(workSession.isolation === "new-copy" || workSession.isolation === "existing-copy") &&
		workSession.directory !== null &&
		workSession.chatIds.length === 0
	);
}
