import type { GitCapabilities } from "@kilo-desktop/plugin-git/contracts";
import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk/main";

import type { KiloUiChatService } from "../../contracts/chat/schemas.js";
import { linkAgentManagerSession } from "./agent-manager-session-links.js";
import { createKiloInstanceDisposer, type KiloInstanceDisposer } from "./dispose-kilo-instance.js";
import { createUnscopedChatDirectory } from "./unscoped-chat-directory.js";
import type { WorkspaceService } from "../workspaces/WorkspaceService.js";

/**
 * Resolves the git plugin's `gitService` capability. Kept lazy so activation
 * order never matters — a missing or inactive git plugin is handled
 * per-method.
 *
 * Missing-capability policy: session-critical and destructive operations
 * throw a `FeatureError` (`prepareSession` must never silently degrade a
 * requested worktree to the checkout; `removeWorktree` is destructive and
 * must not no-op silently), while the best-effort `renameWorktreeBranch`
 * declines with `null` — the namer treats a declined rename as an outcome,
 * not an error — and `linkWorktreeSession` no-ops.
 */
function gitWorktreeService(mainSdk: MainSdk): GitCapabilities["gitService"] | null {
	return mainSdk.plugins.get<GitCapabilities>("git")?.gitService ?? null;
}

export function createChatWorktreeHandlers(
	mainSdk: MainSdk,
	workspaceService: WorkspaceService,
	disposeKiloInstance: KiloInstanceDisposer = createKiloInstanceDisposer(mainSdk),
): Pick<
	KiloUiChatService,
	| "chat.prepareSession"
	| "chat.renameWorktreeBranch"
	| "chat.removeWorktree"
	| "chat.hasWorktreeWork"
	| "chat.linkWorktreeSession"
> {
	return {
		"chat.prepareSession": async ({ workspaceId, worktree }) => {
			// The schema permits a worktree without a workspace, but the
			// scoped path is the only supported one: never silently degrade
			// a requested worktree to an unscoped chat directory.
			if (worktree && !workspaceId) {
				throw new FeatureError("Worktree sessions require a workspace.", "BUSINESS");
			}
			if (workspaceId) {
				const workspace = workspaceService.get(workspaceId);
				if (!workspace) {
					throw new FeatureError("Workspace not found.", "NOT_FOUND");
				}
				const primary = workspace.folders.find((folder) => folder.isPrimary);
				if (!primary) {
					throw new FeatureError("Workspace has no primary folder.", "BUSINESS");
				}
				const workspaceFolders = workspace.folders.map(({ path, isPrimary }) => ({
					path,
					isPrimary,
				}));
				if (worktree) {
					// A requested worktree must never silently degrade to the
					// workspace checkout: a missing git capability is an error.
					const gitService = gitWorktreeService(mainSdk);
					if (!gitService) {
						throw new FeatureError(
							"Git worktrees are unavailable — the Git plugin is not active.",
							"BUSINESS",
						);
					}
					// Ownership splits here: `created` tells the renderer whether
					// this very call created the worktree (safe to remove when
					// session creation later fails) or merely re-validated an
					// existing one (never removed — it is the user's live
					// worktree). Rename the local away from `created` so the
					// ownership flag is not shadowed.
					const resolved: {
						directory: string;
						branch: string;
						created: boolean;
						warning?: string | undefined;
						baseRef?: string | undefined;
					} =
						"existingDirectory" in worktree
							? {
									created: false,
									...(await gitService.resolveWorktree({
										workingDirectory: primary.path,
										directory: worktree.existingDirectory,
									})),
								}
							: {
									created: true,
									...(await gitService.createWorktree({
										workingDirectory: primary.path,
										...(worktree.baseBranch === undefined
											? {}
											: { baseBranch: worktree.baseBranch }),
									})),
								};
					// The worktree is the session's entire primary context
					// (kilocode's Agent Manager shape): the original checkout
					// is dropped from the folders, non-primary folders stay.
					return {
						directory: resolved.directory,
						workspaceId,
						workspaceFolders: [
							{ path: resolved.directory, isPrimary: true },
							...workspaceFolders.filter((folder) => !folder.isPrimary),
						],
						worktree: {
							branch: resolved.branch,
							created: resolved.created,
							...(resolved.warning === undefined ? {} : { warning: resolved.warning }),
							...(resolved.baseRef === undefined ? {} : { baseRef: resolved.baseRef }),
						},
					};
				}
				return {
					directory: primary.path,
					workspaceId,
					workspaceFolders,
				};
			}
			return {
				directory: await createUnscopedChatDirectory(mainSdk.storageDir),
				workspaceFolders: [],
			};
		},
		"chat.renameWorktreeBranch": async (input) => {
			// Best-effort by design: a missing git capability declines with
			// null instead of failing the chat.
			const gitService = gitWorktreeService(mainSdk);
			if (!gitService) return null;
			return gitService.renameWorktreeBranch({
				path: input.directory,
				currentBranch: input.currentBranch,
				requestedBranch: input.requestedBranch,
			});
		},
		"chat.removeWorktree": async ({ directory }) => {
			const gitService = gitWorktreeService(mainSdk);
			if (!gitService) {
				throw new FeatureError(
					"Git worktrees are unavailable — the Git plugin is not active.",
					"BUSINESS",
				);
			}
			// Best-effort: an instance that cannot be released only risks the
			// removal failing on a locked directory, which surfaces on its own.
			await disposeKiloInstance(directory).catch((error: unknown) => {
				mainSdk.logger.warn(
					`Releasing the Kilo instance for "${directory}" failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			});
			await gitService.removeWorktree({ path: directory });
		},
		"chat.hasWorktreeWork": async ({ directory, baseBranch }) => {
			// Best-effort: a missing git capability means no work is possible.
			const gitService = gitWorktreeService(mainSdk);
			if (!gitService) return false;
			try {
				return await gitService.hasWorktreeWork({
					directory,
					...(baseBranch !== undefined ? { baseBranch } : {}),
				});
			} catch (error) {
				// The channel contract is literal `false` on any failure —
				// including a containment rejection — but never swallowed
				// silently: the failure is logged so it stays diagnosable.
				mainSdk.logger.warn(
					`Worktree work check failed for "${directory}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				return false;
			}
		},
		"chat.linkWorktreeSession": async ({ directory, sessionId, baseRef }) => {
			const gitService = gitWorktreeService(mainSdk);
			if (!gitService) return;
			await linkAgentManagerSession(mainSdk, gitService, {
				path: directory,
				sessionId,
				...(baseRef === undefined ? {} : { baseRef }),
			});
		},
	};
}
