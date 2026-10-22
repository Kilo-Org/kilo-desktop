import { realpath } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";

import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

/** kilo-ui's workspace registry, declared locally (no import across features). */
interface WorkspaceCapability extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string }[] }[]>;
	};
}

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

function isInside(root: string, target: string): boolean {
	const path = relative(comparablePath(root), comparablePath(target));
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * Which local files the Browser tab may show: those inside a registered
 * workspace folder (its managed worktrees live inside it too). Paths arrive
 * already canonical; folders are canonicalized here so a symlinked workspace
 * still matches. No workspace service means nothing is served.
 */
export function createWorkspaceFileAuthorization(
	mainSdk: MainSdk,
): (canonicalPath: string) => Promise<boolean> {
	return async (canonicalPath) => {
		const workspaces = mainSdk.plugins.get<WorkspaceCapability>("kilo-ui")?.workspaceService;
		if (!workspaces) return false;
		const folders = (await workspaces.list()).flatMap(({ folders }) => folders);
		const roots = await Promise.all(folders.map(({ path }) => realpath(path).catch(() => null)));
		return roots.some((root) => root !== null && isInside(root, canonicalPath));
	};
}
