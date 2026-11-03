import { realpath } from "node:fs/promises";
import path from "node:path";

import {
	KILO_WORKTREE_SEGMENTS,
	type Authorization,
	type AuthorizeRule,
	type Workspace,
} from "../contracts";
import { comparablePath } from "./folders";

/** The platform rules and filesystem `authorizePath` judges paths by. */
export interface PathEnvironment {
	readonly platform: NodeJS.Platform;
	/** Native realpath: resolves symlinks and expands Windows 8.3 short names. */
	readonly realpath: (target: string) => Promise<string>;
}

const HOST: PathEnvironment = { platform: process.platform, realpath };

/**
 * The one place that decides whether a path may be used, replacing the
 * per-plugin copies origin had. Both the candidate and each folder are
 * resolved before comparing — folders are stored canonical when created,
 * but imported ones may not be, and git reports long, real paths for a
 * folder registered through a short name or symlink — and comparisons fold
 * letter case where the filesystem usually ignores it (`comparablePath`).
 * The authorisation still names the folder exactly as stored.
 */
export async function authorizePath(
	workspaces: readonly Workspace[],
	target: string,
	rule: AuthorizeRule,
	environment: PathEnvironment = HOST,
): Promise<Authorization> {
	const api = environment.platform === "win32" ? path.win32 : path.posix;
	if (!api.isAbsolute(target)) return { allowed: false };

	/**
	 * Resolves the longest existing part of `candidate` and re-attaches the
	 * rest, so a path that doesn't exist yet (a file about to be written) is
	 * judged by where it would land.
	 */
	const resolveExisting = async (candidate: string): Promise<string> => {
		const absolute = api.resolve(candidate);
		try {
			return await environment.realpath(absolute);
		} catch {
			const parent = api.dirname(absolute);
			if (parent === absolute) return absolute;
			return api.join(await resolveExisting(parent), api.basename(absolute));
		}
	};
	const key = (candidate: string) => comparablePath(candidate, environment.platform);
	const isWithin = (child: string, parent: string) => {
		const relative = api.relative(key(parent), key(child));
		return (
			relative === "" ||
			(relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative))
		);
	};
	/** A direct child of `<folder>/.kilo/worktrees`, where the app keeps managed git worktrees. */
	const isManagedWorktree = (candidate: string, folder: string) =>
		key(api.dirname(candidate)) === key(api.join(folder, ...KILO_WORKTREE_SEGMENTS)) &&
		api.basename(candidate).length > 0;

	const resolved = await resolveExisting(target);
	for (const workspace of workspaces) {
		for (const folder of workspace.folders) {
			if (rule === "primary" && !folder.isPrimary) continue;
			const folderPath = await resolveExisting(folder.path);
			const matches =
				rule === "inside"
					? isWithin(resolved, folderPath)
					: key(resolved) === key(folderPath) || isManagedWorktree(resolved, folderPath);
			if (matches) {
				return { allowed: true, workspaceId: workspace.id, folder: folder.path, path: resolved };
			}
		}
	}
	return { allowed: false };
}
