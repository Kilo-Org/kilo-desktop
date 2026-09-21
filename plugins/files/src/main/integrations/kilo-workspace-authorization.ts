import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk/main";

/**
 * Path segments of the managed chat-worktree directory
 * (`<registered>/.kilo/worktrees/`). Declared locally so files carries no
 * runtime dependency on the git package — pinned to git's contracts const
 * by kilo-workspace-authorization.test.ts.
 */
const KILO_WORKTREE_SEGMENTS = [".kilo", "worktrees"] as const;

interface WorkspaceCapability extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string; isPrimary: boolean }[] }[]>;
	};
}

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

/**
 * True when `candidate` is a direct child of `<registered>/.kilo/worktrees` —
 * the managed chat-worktree location. Exact-parent comparison (mirroring the
 * git plugin's `isManagedWorktreePath`) rules out sibling-prefix confusions
 * like a `worktrees-evil` directory.
 *
 * Known limitation: when the registered folder is itself a linked worktree,
 * managed worktrees live under the main checkout's `.kilo/worktrees/` and
 * will not authorize. Out of scope.
 */
function isManagedWorktreeChild(candidate: string, registered: string): boolean {
	return dirname(resolve(candidate)) === resolve(registered, ...KILO_WORKTREE_SEGMENTS);
}

/**
 * Adapts Kilo's workspace registry to the authorization seam owned by the
 * workspace-files module. Canonical paths are compared here so the filesystem
 * module never needs to understand another plugin's capability shape.
 */
export function createKiloWorkspaceAuthorization(
	mainSdk: MainSdk,
): (canonicalWorkspaceDirectory: string) => Promise<void> {
	return async (workspaceDirectory) => {
		const capability = mainSdk.plugins.get<WorkspaceCapability>("kilo-ui")?.workspaceService;
		if (!capability) {
			throw new FeatureError("Kilo workspace service is unavailable.", "BUSINESS");
		}
		const workspaces = await capability.list();
		const registeredPaths = await Promise.all(
			workspaces
				.flatMap(({ folders }) => folders)
				.map(async ({ path }) => {
					try {
						return comparablePath(await realpath(path));
					} catch {
						return null;
					}
				}),
		);
		const candidate = comparablePath(workspaceDirectory);
		if (
			!registeredPaths.some(
				(registered) =>
					registered !== null &&
					(registered === candidate || isManagedWorktreeChild(candidate, registered)),
			)
		) {
			throw new FeatureError("Workspace directory is not registered.", "VALIDATION");
		}
	};
}
