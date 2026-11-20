import { rm } from "node:fs/promises";
import path from "node:path";

import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Workspace, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { CloneSource } from "../../contracts/models";

/** The kilo.work-sessions methods a clone needs to become a workspace. */
export type CloneWorkspaceTarget = Pick<
	DomainObjectHandle<typeof Workspaces>["methods"],
	"newFolderPath" | "create" | "rememberNewFolderLocation"
>;

export interface CloneWorkspaceInput {
	readonly source: CloneSource;
	readonly name: string;
	readonly color?: string | undefined;
	readonly parentPath: string;
}

export interface CloneWorkspaceDeps {
	/** kilo.work-sessions' workspaces; null while they are absent. */
	readonly workspaces: CloneWorkspaceTarget | null;
	/** Clones `source` into `destination`, which does not exist yet. */
	readonly clone: (source: CloneSource, destination: string) => Promise<void>;
}

/**
 * Clones `source` into a new folder `<parentPath>/<name>` and creates a
 * workspace of it. kilo.work-sessions checks the destination (one folder
 * name, an existing parent, nothing there yet), so if creating the workspace
 * fails everything in it came from this clone and it is removed again,
 * letting the person retry with the same name.
 */
export async function cloneWorkspace(
	input: CloneWorkspaceInput,
	{ workspaces, clone }: CloneWorkspaceDeps,
): Promise<Workspace> {
	if (!workspaces) {
		throw new KernelError(
			"BUSINESS",
			"Workspaces are unavailable, so a repository can't be cloned into one.",
		);
	}
	const name = input.name.trim();
	const { path: destination } = await workspaces.newFolderPath({
		parentPath: input.parentPath,
		name,
	});
	await clone(input.source, destination);
	let workspace: Workspace;
	try {
		workspace = await workspaces.create({
			name,
			...(input.color === undefined ? {} : { color: input.color }),
			folders: [{ path: destination, isPrimary: true }],
			source: input.source.kind === "github" ? "github-clone" : "git-url-clone",
		});
	} catch (reason) {
		await rm(destination, { recursive: true, force: true }).catch(() => undefined);
		throw reason;
	}
	await workspaces
		.rememberNewFolderLocation({ path: path.dirname(destination) })
		.catch(() => undefined);
	return workspace;
}
