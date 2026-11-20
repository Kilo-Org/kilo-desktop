import path from "node:path";

import { execa } from "execa";

interface WorkspaceProject {
	name?: string;
	path: string;
}

async function listWorkspaceProjects(workspaceRoot: string): Promise<WorkspaceProject[]> {
	const { stdout } = await execa("pnpm", ["ls", "--recursive", "--depth", "-1", "--json"], {
		cwd: workspaceRoot,
	});
	return JSON.parse(stdout) as WorkspaceProject[];
}

/**
 * Names of every pnpm workspace package, as they appear under node_modules
 * after `pnpm deploy`. Asked of pnpm rather than inferred from a scope because
 * a workspace package may be published under a third-party name (as the old
 * `@opencode-ai/sdk` shim was).
 */
export async function listWorkspacePackageNames(workspaceRoot: string): Promise<string[]> {
	const root = path.resolve(workspaceRoot);
	return (await listWorkspaceProjects(workspaceRoot))
		.filter((project) => path.resolve(project.path) !== root)
		.flatMap((project) => (project.name ? [project.name] : []));
}

/** Absolute directories of every workspace project, the root included. */
export async function listWorkspaceDirectories(workspaceRoot: string): Promise<string[]> {
	return (await listWorkspaceProjects(workspaceRoot)).map((project) => path.resolve(project.path));
}
