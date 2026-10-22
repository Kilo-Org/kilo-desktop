import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import {
	filesContract,
	type ExternalEditorId,
	type FilesServiceContract,
} from "../contracts/schemas.js";
import { ExternalEditorService } from "./external-editors/ExternalEditorService.js";
import { createGitStatusLookup } from "./integrations/git-status.js";
import { createKiloWorkspaceAuthorization } from "./integrations/kilo-workspace-authorization.js";
import { FilesService } from "./workspace-files/FilesService.js";

export interface ExternalEditorLauncher {
	listAvailable(): Promise<readonly ExternalEditorId[]>;
	open(editor: ExternalEditorId, targetPath: string): Promise<void>;
}

export function mainRegister(
	mainSdk: MainSdk,
	{
		editorLauncher = new ExternalEditorService(),
	}: { editorLauncher?: ExternalEditorLauncher } = {},
): void {
	const service = new FilesService({
		authorize: createKiloWorkspaceAuthorization(mainSdk),
		gitStatus: createGitStatusLookup(mainSdk),
	});

	const handlers: FilesServiceContract = {
		list: ({ workspaceDirectory }) => service.list(workspaceDirectory),
		existingPaths: async ({ workspaceDirectory, relativePaths }) => ({
			paths: await service.existingPaths(workspaceDirectory, relativePaths),
		}),
		resolveFileLink: ({ workspaceDirectory, relativePath }) =>
			service.resolveFileLink(workspaceDirectory, relativePath),
		read: ({ workspaceDirectory, relativePath }) => service.read(workspaceDirectory, relativePath),
		listExternalEditors: async () => ({ editors: [...(await editorLauncher.listAvailable())] }),
		openExternalEditor: async ({ workspaceDirectory, relativePath, editor }) => {
			const targetPath = await service.resolveFilePath(workspaceDirectory, relativePath);
			await editorLauncher.open(editor, targetPath);
			return { opened: true };
		},
		write: ({ workspaceDirectory, relativePath, contents, expectedRevision, force }) =>
			service.write(workspaceDirectory, relativePath, contents, expectedRevision, force),
		gitStatus: async ({ workspaceDirectory }) => {
			const entries = await service.gitStatus(workspaceDirectory);
			return entries === null ? null : { entries };
		},
	};
	mainSdk.channels(filesContract).handleAll(handlers);
}
