import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Workspace } from "../../contracts/workspaces/schemas.js";
import { WorkspaceFolderStatusService } from "./WorkspaceFolderStatusService.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function workspace(folders: Workspace["folders"]): Workspace {
	return {
		id: "workspace-1",
		name: "Workspace",
		folders,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("WorkspaceFolderStatusService", () => {
	it("returns no unavailable folders for an existing directory", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-folder-status-"));
		directories.push(root);

		await expect(
			new WorkspaceFolderStatusService().list([
				workspace([{ id: "folder-1", path: root, isPrimary: true, position: 0 }]),
			]),
		).resolves.toEqual([{ workspaceId: "workspace-1", unavailableFolders: [] }]);
	});

	it("returns stored paths for deleted directories and files", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-folder-status-"));
		directories.push(root);
		const existing = path.join(root, "existing");
		const deleted = path.join(root, "deleted");
		const file = path.join(root, "file.txt");
		fs.mkdirSync(existing);
		fs.mkdirSync(deleted);
		fs.rmSync(deleted, { recursive: true });
		fs.writeFileSync(file, "not a directory");

		await expect(
			new WorkspaceFolderStatusService().list([
				workspace([
					{ id: "folder-1", path: existing, isPrimary: true, position: 0 },
					{ id: "folder-2", path: deleted, isPrimary: false, position: 1 },
					{ id: "folder-3", path: file, isPrimary: false, position: 2 },
				]),
			]),
		).resolves.toEqual([{ workspaceId: "workspace-1", unavailableFolders: [deleted, file] }]);
	});
});
