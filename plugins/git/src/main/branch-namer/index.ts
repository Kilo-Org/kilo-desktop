import { mainHost, type DomainObjectHandle, type PluginSdk } from "@kilo-desktop/kernel";
import { Chats, Generation } from "@kilo-desktop/plugin-core/contracts";
import {
	isOrphanedCopySession,
	WorkSessions,
	type VcsImplementation,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	createBranchNamer,
	type ArmedChats,
	type ArmedProgress,
	type BranchNamerModel,
	type NamerTarget,
} from "./controller";

export { createBranchNamer, MAX_PROMPTS } from "./controller";

export interface BranchNamerOptions {
	readonly vcs: Pick<VcsImplementation, "renameCopyBranch" | "hasCopyWork" | "isManagedBranch">;
}

/** A saved model in either shape: v2's `ModelRef` or origin's `{providerID, modelID}`. */
interface SavedModel {
	readonly aiProviderId?: unknown;
	readonly modelId?: unknown;
	readonly providerID?: unknown;
	readonly modelID?: unknown;
}

function readModel(saved: SavedModel | undefined): BranchNamerModel | undefined {
	const aiProviderId = saved?.aiProviderId ?? saved?.providerID;
	const modelId = saved?.modelId ?? saved?.modelID;
	return typeof aiProviderId === "string" && typeof modelId === "string"
		? { aiProviderId, modelId }
		: undefined;
}

/** The saved progress per chat, reading the model as origin saved it too; anything unreadable is dropped. */
function readArmed(saved: unknown): ArmedChats {
	if (!saved || typeof saved !== "object") return {};
	const armed: Record<string, ArmedProgress> = {};
	for (const [chatId, entry] of Object.entries(saved as Record<string, unknown>)) {
		if (!entry || typeof entry !== "object") continue;
		const { promptCount, idleAttempted, baseRef, model } = entry as Record<string, unknown>;
		if (typeof promptCount !== "number") continue;
		const restoredModel = readModel(model as SavedModel | undefined);
		armed[chatId] = {
			promptCount,
			idleAttempted: idleAttempted === true,
			...(typeof baseRef === "string" ? { baseRef } : {}),
			...(restoredModel ? { model: restoredModel } : {}),
		};
	}
	return armed;
}

/**
 * The copy branch namer in main, driven by kilo.core's chats and
 * kilo.work-sessions' work sessions:
 *
 * - A chat is armed when it becomes the first chat of a work session whose
 *   copy kilo.work-sessions created (`copyCreated`) — never for an existing
 *   copy picked at creation, nor for work sessions from before this run unless
 *   their progress was saved.
 * - It stays eligible while its work session's branch is managed (`kilo/…`)
 *   and it is the only work session and the only root chat in that directory.
 * - Messages sent to it (`user-message`) and its finished turns drive the
 *   controller; names come from `kilo.core/generation`'s `generateBranchName`,
 *   the rename from kilo.git's own `vcs` (which announces
 *   `worktree-branch-renamed` and toasts it), then the work session takes the
 *   new branch (`setBranch`, which rewrites its chats' stamps too).
 * - Progress per chat is kept in kv (`branch-namer`); a deleted work
 *   session's chats are dropped.
 */
export function activateBranchNamer(sdk: PluginSdk, { vcs }: BranchNamerOptions): void {
	const store = mainHost(sdk).storage.kv<{ armed: unknown }>({
		namespace: "branch-namer",
		defaults: { armed: {} },
	});
	let workSessions: DomainObjectHandle<typeof WorkSessions> | undefined;
	let chats: DomainObjectHandle<typeof Chats> | undefined;

	const target = (chatId: string): NamerTarget | null => {
		const list = workSessions?.getState().workSessions ?? [];
		const summaries = chats?.getState().chats ?? {};
		const workSession = list.find((candidate) => candidate.chatIds.includes(chatId));
		const branch = workSession?.branch;
		const directory = workSession?.directory;
		if (!workSession?.copyCreated || !branch || !directory || !vcs.isManagedBranch(branch)) {
			return null;
		}
		if (!isOrphanedCopySession(list, workSession.id)) return null;
		const soleRootChat = Object.values(summaries).every(
			(chat) => chat.id === chatId || chat.parentId !== null || chat.directory !== directory,
		);
		return soleRootChat
			? { workSessionId: workSession.id, directory, currentBranch: branch }
			: null;
	};

	const namer = createBranchNamer({
		target,
		isBusy: (chatId) => {
			const status = chats?.getState().chats[chatId]?.activity.status;
			return status === "busy" || status === "retry";
		},
		generate: async (input) => {
			const generation = sdk.domainObjects.get(Generation);
			if (!generation) return null;
			const { branch } = await generation.methods.generateBranchName(input);
			return branch;
		},
		rename: (input) => vcs.renameCopyBranch(input),
		hasCopyWork: (input) => vcs.hasCopyWork(input),
		renamed: async ({ workSessionId, branch }) => {
			await workSessions?.methods.setBranch({ id: workSessionId, branch });
		},
		progress: {
			load: () => readArmed(store.snapshot().armed),
			save: (armed) => store.set({ armed }),
		},
		log: (message) => sdk.logger.warn(message),
	});
	sdk.onDispose(() => namer.dispose());

	let stopWorkSessions = () => {};
	let stopChats = () => {};
	sdk.onDispose(() => {
		stopWorkSessions();
		stopChats();
	});
	sdk.domainObjects.track(WorkSessions, {
		added(handle) {
			workSessions = handle;
			const stops = [
				handle.on("updated", ({ before, after }) => {
					const first = after.chatIds[0];
					if (before.chatIds.length === 0 && first && after.copyCreated) {
						namer.arm(first, { baseRef: after.baseRef });
					}
				}),
				handle.on("deleted", ({ workSession }) => workSession.chatIds.forEach(namer.forget)),
			];
			stopWorkSessions = () => stops.forEach((stop) => stop());
		},
		removed() {
			stopWorkSessions();
			workSessions = undefined;
		},
	});
	sdk.domainObjects.track(Chats, {
		added(handle) {
			chats = handle;
			const stops = [
				handle.on("user-message", ({ chatId, text, model }) =>
					namer.prompt({ chatId, text, model }),
				),
				handle.on("turn-ended", ({ chatId }) => namer.turnEnded(chatId)),
			];
			stopChats = () => stops.forEach((stop) => stop());
		},
		removed() {
			stopChats();
			chats = undefined;
		},
	});
}
