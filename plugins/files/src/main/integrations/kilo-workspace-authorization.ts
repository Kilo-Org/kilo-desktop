import { realpath } from "node:fs/promises";

import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

interface WorkspaceCapability extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string; isPrimary: boolean }[] }[]>;
	};
}

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
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
		if (!registeredPaths.includes(comparablePath(workspaceDirectory))) {
			throw new FeatureError("Workspace directory is not registered.", "VALIDATION");
		}
	};
}
