import { access, constants, realpath, stat } from "node:fs/promises";

import type { WorkspaceFolderStatus } from "../../contracts/workspaces/status.js";
import type { Workspace } from "../../contracts/workspaces/schemas.js";

const PROBE_TIMEOUT_MS = 1500;
const PROBE_CONCURRENCY = 8;

/**
 * Reads stored workspace folders without mutating workspace records. The
 * bounded, timed probes prevent an inaccessible mount from stalling the main
 * process while still reporting its original stored path to the UI.
 */
export class WorkspaceFolderStatusService {
	async list(workspaces: readonly Workspace[]): Promise<WorkspaceFolderStatus[]> {
		const folders = workspaces.flatMap((workspace, workspaceIndex) =>
			workspace.folders.map((folder) => ({ workspaceIndex, path: folder.path })),
		);
		const unavailableByWorkspace = workspaces.map((): string[] => []);

		await mapWithConcurrency(folders, PROBE_CONCURRENCY, async (folder) => {
			if (!(await isAvailableDirectory(folder.path))) {
				unavailableByWorkspace[folder.workspaceIndex]?.push(folder.path);
			}
		});

		return workspaces.map((workspace, index) => ({
			workspaceId: workspace.id,
			unavailableFolders: unavailableByWorkspace[index] ?? [],
		}));
	}
}

async function isAvailableDirectory(folderPath: string): Promise<boolean> {
	try {
		return await withTimeout(probeDirectory(folderPath));
	} catch {
		return false;
	}
}

async function probeDirectory(folderPath: string): Promise<boolean> {
	const resolvedPath = await realpath(folderPath);
	if (!(await stat(resolvedPath)).isDirectory()) return false;
	await access(resolvedPath, constants.R_OK | constants.X_OK);
	return true;
}

function withTimeout(probe: Promise<boolean>): Promise<boolean> {
	let timer: NodeJS.Timeout;
	const timeout = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
	});
	probe.catch(() => undefined);
	return Promise.race([probe, timeout]).finally(() => clearTimeout(timer));
}

async function mapWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
): Promise<void> {
	const iterator = items[Symbol.iterator]();
	const worker = async (): Promise<void> => {
		for (let step = iterator.next(); !step.done; step = iterator.next()) {
			await task(step.value);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
