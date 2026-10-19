import path from "node:path";

import { execa } from "execa";

interface WorkspaceProject {
	name?: string;
	path: string;
}

/**
 * Names of every pnpm workspace package, as they appear under node_modules
 * after `pnpm deploy`. Asked of pnpm rather than inferred from a scope because
 * some workspace packages are published under third-party names (the
 * `@opencode-ai/sdk` shim in plugins/kilo-ui).
 */
export async function listWorkspacePackageNames(workspaceRoot: string): Promise<string[]> {
	const { stdout } = await execa("pnpm", ["ls", "--recursive", "--depth", "-1", "--json"], {
		cwd: workspaceRoot,
	});
	const projects = JSON.parse(stdout) as WorkspaceProject[];
	const root = path.resolve(workspaceRoot);
	return projects
		.filter((project) => path.resolve(project.path) !== root)
		.flatMap((project) => (project.name ? [project.name] : []));
}
