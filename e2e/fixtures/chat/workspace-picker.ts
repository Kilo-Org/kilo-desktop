import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { callDomainObject } from "../../utils/kernel-bridge.js";
import { WORK_SESSIONS_CALLER } from "../../pages/work-sessions/new-work-session-page.js";
import { removePathAfterAppStops } from "../shell.js";
import { test as chatTest } from "../chat.js";

type WorkspacePickerWorkspace = {
	readonly id: string;
	readonly path: string;
	readonly name: string;
};

type WorkspacePickerFixtures = {
	workspacePickerWorkspaces: readonly [WorkspacePickerWorkspace, WorkspacePickerWorkspace];
};

async function createWorkspace(label: string): Promise<WorkspacePickerWorkspace> {
	const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-chat-workspace-picker-"));
	const folderPath = await realpath(rawPath);
	removePathAfterAppStops(rawPath);
	removePathAfterAppStops(folderPath);
	const name = `${label} ${path.basename(folderPath)}`;
	const created = (await callDomainObject({
		domainId: "kilo.work-sessions/workspaces",
		method: "create",
		input: { name, folders: [{ path: folderPath, isPrimary: true }] },
		caller: WORK_SESSIONS_CALLER,
	})) as { id: string };
	return { id: created.id, path: folderPath, name };
}

export const test = chatTest.extend<WorkspacePickerFixtures>({
	workspacePickerWorkspaces: async ({ appShellPage: _appShellPage }, use) => {
		const workspaces: WorkspacePickerWorkspace[] = [];
		try {
			const firstWorkspace = await createWorkspace("Workspace A");
			workspaces.push(firstWorkspace);
			const selectedWorkspace = await createWorkspace("Workspace B");
			workspaces.push(selectedWorkspace);
			await callDomainObject({
				domainId: "kilo.work-sessions/workspaces",
				method: "setActive",
				input: { id: null },
				caller: WORK_SESSIONS_CALLER,
			});
			await use([firstWorkspace, selectedWorkspace]);
		} finally {
			await callDomainObject({
				domainId: "kilo.work-sessions/workspaces",
				method: "setActive",
				input: { id: null },
				caller: WORK_SESSIONS_CALLER,
			});
			for (const workspace of workspaces) {
				await callDomainObject({
					domainId: "kilo.work-sessions/workspaces",
					method: "remove",
					input: { id: workspace.id },
					caller: WORK_SESSIONS_CALLER,
				});
			}
		}
	},
});

export const { expect } = test;
