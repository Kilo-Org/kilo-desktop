import { realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { KernelError } from "@kilo-desktop/kernel";

import type { Workspace, WorkspaceFolderInput } from "../../contracts/model";

/**
 * Paths compare case-insensitively on Windows and macOS, whose default
 * filesystems ignore case (a case-sensitive APFS volume is the accepted
 * exception), and case-sensitively on Linux.
 */
export function comparablePath(
	folderPath: string,
	platform: NodeJS.Platform = process.platform,
): string {
	return platform === "win32" || platform === "darwin" ? folderPath.toLowerCase() : folderPath;
}

function canonicalHomeDirectory(): string {
	try {
		return realpathSync.native(homedir());
	} catch {
		return homedir();
	}
}

/**
 * Checks folders for a workspace and returns them canonical: absolute,
 * symlinks resolved, existing directories, not a filesystem root or the home
 * directory, unique, exactly one primary — placed first.
 */
export function validateFolders(input: readonly WorkspaceFolderInput[]): WorkspaceFolderInput[] {
	if (input.length === 0) {
		throw new KernelError("VALIDATION", "A workspace needs at least one folder.");
	}
	if (input.filter((folder) => folder.isPrimary).length !== 1) {
		throw new KernelError("VALIDATION", "A workspace must have exactly one primary folder.");
	}

	const home = comparablePath(canonicalHomeDirectory());
	const seen = new Set<string>();
	const canonical = input.map((folder) => {
		if (!path.isAbsolute(folder.path)) {
			throw new KernelError("VALIDATION", "Workspace folders must use absolute paths.");
		}
		let resolved: string;
		try {
			resolved = realpathSync.native(folder.path);
			if (!statSync(resolved).isDirectory()) throw new Error("not a directory");
		} catch {
			throw new KernelError(
				"VALIDATION",
				`Workspace folder does not exist or is not a directory: ${folder.path}`,
			);
		}
		const comparable = comparablePath(resolved);
		if (resolved === path.parse(resolved).root || comparable === home) {
			throw new KernelError(
				"VALIDATION",
				"Filesystem roots and the home directory cannot be workspace folders.",
			);
		}
		if (seen.has(comparable)) {
			throw new KernelError("VALIDATION", "Workspace folders must be unique.");
		}
		seen.add(comparable);
		return { path: resolved, isPrimary: folder.isPrimary };
	});

	const primary = canonical.find((folder) => folder.isPrimary)!;
	return [primary, ...canonical.filter((folder) => !folder.isPrimary)].map((folder, position) => ({
		...folder,
		isPrimary: position === 0,
	}));
}

const PROBE_TIMEOUT_MS = 1500;
const PROBE_CONCURRENCY = 8;

/**
 * Ids of folders that no longer resolve to a directory (moved, deleted,
 * unmounted). A folder that exists but denies reads (a macOS privacy prompt)
 * is not unavailable. Probes are timed and bounded so an unreachable mount
 * can't stall the main process; stored paths never change.
 */
export async function unavailableFolderIds(workspaces: readonly Workspace[]): Promise<string[]> {
	const folders = workspaces.flatMap((workspace) => workspace.folders);
	const unavailable = new Set<string>();
	const queue = folders[Symbol.iterator]();
	const worker = async () => {
		for (let step = queue.next(); !step.done; step = queue.next()) {
			if (!(await isAvailableDirectory(step.value.path))) unavailable.add(step.value.id);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, folders.length) }, worker));
	return folders.filter((folder) => unavailable.has(folder.id)).map((folder) => folder.id);
}

async function isAvailableDirectory(folderPath: string): Promise<boolean> {
	const probe = (async () => {
		const resolved = await realpath(folderPath);
		return (await stat(resolved)).isDirectory();
	})().catch(() => false);
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
	});
	return Promise.race([probe, timeout]).finally(() => clearTimeout(timer));
}
