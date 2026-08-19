import { realpath } from "node:fs/promises";

import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { filesContract, type FilesServiceContract } from "../contracts/schemas.js";
import { FilesService } from "./FilesService.js";

interface WorkspaceCapabilityLike extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string; isPrimary: boolean }[] }[]>;
	};
}

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

export function mainRegister(mainSdk: MainSdk): void {
	const service = new FilesService({
		authorize: async (workspaceDirectory) => {
			const capability = mainSdk.plugins.get<WorkspaceCapabilityLike>("kilo-ui")?.workspaceService;
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
		},
	});

	const handlers: FilesServiceContract = {
		list: ({ workspaceDirectory }) => service.list(workspaceDirectory),
		read: ({ workspaceDirectory, relativePath }) => service.read(workspaceDirectory, relativePath),
		write: ({ workspaceDirectory, relativePath, contents, expectedRevision, force }) =>
			service.write(workspaceDirectory, relativePath, contents, expectedRevision, force),
	};
	mainSdk.channels(filesContract).handleAll(handlers);
}
