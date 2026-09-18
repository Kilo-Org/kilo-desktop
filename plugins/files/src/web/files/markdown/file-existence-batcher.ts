import type { SDK } from "@kilo-desktop/feature-sdk";

import {
	FILE_EXISTENCE_BATCH_LIMIT,
	type FilesServiceContract,
} from "../../../contracts/schemas.js";

interface PendingCheck {
	readonly resolve: (exists: boolean) => void;
	readonly reject: (error: unknown) => void;
}

type PendingWorkspace = Map<string, PendingCheck[]>;

function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

/**
 * Owns renderer-side coalescing for exact workspace file checks. One instance
 * belongs to one Files SDK. All checks queued in the same microtask are grouped
 * by workspace and deduplicated by relative path; the main process remains the
 * authority on existence and path containment. TanStack Query owns longer-lived
 * caching, so this batcher retains no results after settling its callers.
 */
class FileExistenceBatcher {
	private pending = new Map<string, PendingWorkspace>();
	private scheduled = false;

	constructor(private readonly sdk: SDK<FilesServiceContract>) {}

	exists(workspaceDirectory: string, relativePath: string): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			const workspace = this.pending.get(workspaceDirectory) ?? new Map();
			const checks = workspace.get(relativePath) ?? [];
			checks.push({ resolve, reject });
			workspace.set(relativePath, checks);
			this.pending.set(workspaceDirectory, workspace);

			if (this.scheduled) return;
			this.scheduled = true;
			queueMicrotask(() => void this.flush());
		});
	}

	private async flush(): Promise<void> {
		const pending = this.pending;
		this.pending = new Map();
		this.scheduled = false;
		await Promise.all(
			[...pending].map(([workspaceDirectory, workspace]) =>
				this.flushWorkspace(workspaceDirectory, workspace),
			),
		);
	}

	private async flushWorkspace(
		workspaceDirectory: string,
		workspace: PendingWorkspace,
	): Promise<void> {
		const relativePaths = [...workspace.keys()];
		try {
			const results = await Promise.all(
				chunks(relativePaths, FILE_EXISTENCE_BATCH_LIMIT).map((batch) =>
					this.sdk.client.existingPaths({ workspaceDirectory, relativePaths: batch }),
				),
			);
			const existing = new Set(results.flatMap(({ paths }) => paths));
			for (const [relativePath, checks] of workspace) {
				for (const { resolve } of checks) resolve(existing.has(relativePath));
			}
		} catch (error) {
			for (const checks of workspace.values()) {
				for (const { reject } of checks) reject(error);
			}
		}
	}
}

const batchers = new WeakMap<SDK<FilesServiceContract>, FileExistenceBatcher>();

export function checkWorkspaceFileExists(
	sdk: SDK<FilesServiceContract>,
	workspaceDirectory: string,
	relativePath: string,
): Promise<boolean> {
	let batcher = batchers.get(sdk);
	if (!batcher) {
		batcher = new FileExistenceBatcher(sdk);
		batchers.set(sdk, batcher);
	}
	return batcher.exists(workspaceDirectory, relativePath);
}
