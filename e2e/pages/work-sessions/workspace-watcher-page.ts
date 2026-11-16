import { writeFile } from "node:fs/promises";
import path from "node:path";

import { getPage } from "@anaconda/playwright-utils/page-utils";

import { callDomainObject, waitForDomainObjectState } from "../../utils/kernel-bridge.js";
import { WORK_SESSIONS_CALLER } from "./new-work-session-page.js";

const FILE_WATCHER_DOMAIN = "kilo.work-sessions/file-watcher";

type FileChangeType = "create" | "update" | "delete";
interface FileChangeBatch {
	root: string;
	changes: { path: string; type: string }[];
}
interface FileWatcherState {
	watched: { path: string; state: string }[];
}

/** The watcher subscribes once the window is shown; a cold CI runner can take a while. */
const WATCH_ACTIVE_TIMEOUT_MS = 30_000;
/** Per-attempt wait before writing a fresh file; 5 attempts bound the worst case. */
const ATTEMPT_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 5;

/**
 * Waits until the file watcher watches `folderPath` (a workspace folder).
 * Reads main's snapshot, so the spec needs an app of its own (see below).
 */
export async function waitForWorkspaceWatcher(folderPath: string): Promise<void> {
	await waitForDomainObjectState<FileWatcherState>({
		domainId: FILE_WATCHER_DOMAIN,
		description: `The file watcher did not watch ${folderPath}`,
		timeoutMs: WATCH_ACTIVE_TIMEOUT_MS,
		accept: (state) =>
			state.watched.some((folder) => folder.path === folderPath && folder.state === "active"),
	});
}

/**
 * Page object for the workspace file watcher smoke flow.
 *
 * The watcher is headless (kilo.work-sessions' `file-watcher` service in
 * main), so the flow drives it through the kernel bridge: the workspace is
 * created with a `kilo.work-sessions/workspaces` call, and batches are
 * observed as `kilo.work-sessions/file-watcher` `changed` events broadcast to
 * the window. This exercises the real native @parcel/watcher addon inside the
 * packaged binary — the only tier that can.
 *
 * Waiting for the watched state reads main's snapshot (`kernel:hydrate`),
 * which makes main forget what the window implements; specs using this page
 * run in an app of their own.
 */
export class WorkspaceWatcherPage {
	/**
	 * Create a workspace holding one folder. The creation event re-runs the
	 * watcher's reconcile, which subscribes the native watcher to the folder.
	 */
	async createWorkspace(folderPath: string, name: string): Promise<void> {
		await callDomainObject({
			domainId: "kilo.work-sessions/workspaces",
			method: "create",
			input: { name, folders: [{ path: folderPath, isPrimary: true }] },
			caller: WORK_SESSIONS_CALLER,
		});
		await waitForWorkspaceWatcher(folderPath);
	}

	/**
	 * Write a new file into a watched folder and await the `create` batch the
	 * watcher must publish for it.
	 *
	 * `createWorkspace` waits for the native subscription to become active.
	 * Multiple attempts still tolerate platform event coalescing, and the first
	 * observed batch proves the packaged binary's full chain: native parcel events →
	 * normalization → domain event → kernel bridge → renderer.
	 */
	async writeNewFileAndAwaitCreateChange(folderPath: string, baseName: string): Promise<string> {
		await this.#startListeningForFileChanges();
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
			const filePath = path.join(folderPath, `${baseName}-${attempt}.txt`);
			await writeFile(filePath, `created by the workspace watcher smoke spec\n`);
			if (await this.#hasChange(filePath, "create", ATTEMPT_TIMEOUT_MS)) {
				return filePath;
			}
		}
		const received = await this.#collectedBatches();
		throw new Error(
			`Workspace watcher never published a create batch for files under ${folderPath} ` +
				`after ${MAX_ATTEMPTS} attempts; received batches: ${JSON.stringify(received)}`,
		);
	}

	/** Collect `kilo.work-sessions/file-watcher` `changed` events broadcast to the window. Idempotent. */
	async #startListeningForFileChanges(): Promise<void> {
		await getPage().evaluate((domainId) => {
			type DomainEvent = { id?: string; event?: string; payload?: unknown };
			type ListenerGlobal = typeof globalThis & {
				kernelBridge: { on(listener: (channel: string, payload: unknown) => void): () => void };
				__workspaceFileChanges?: FileChangeBatch[];
			};
			const global = globalThis as ListenerGlobal;
			if (global.__workspaceFileChanges) return;
			global.__workspaceFileChanges = [];
			global.kernelBridge.on((channel, payload) => {
				const message = payload as DomainEvent;
				if (
					channel === "kernel:domain-event" &&
					message.id === domainId &&
					message.event === "changed"
				) {
					global.__workspaceFileChanges!.push(message.payload as FileChangeBatch);
				}
			});
		}, FILE_WATCHER_DOMAIN);
	}

	async #hasChange(filePath: string, type: FileChangeType, timeoutMs: number): Promise<boolean> {
		try {
			await getPage().waitForFunction(
				({ expectedPath, expectedType }) => {
					type ListenerGlobal = typeof globalThis & {
						__workspaceFileChanges?: FileChangeBatch[];
					};
					const batches = (globalThis as ListenerGlobal).__workspaceFileChanges ?? [];
					return batches.some((batch) =>
						batch.changes.some(
							(change) => change.path === expectedPath && change.type === expectedType,
						),
					);
				},
				{ expectedPath: filePath, expectedType: type },
				{ timeout: timeoutMs },
			);
			return true;
		} catch {
			return false;
		}
	}

	async #collectedBatches(): Promise<unknown> {
		return getPage().evaluate(() => {
			type ListenerGlobal = typeof globalThis & { __workspaceFileChanges?: FileChangeBatch[] };
			return (globalThis as ListenerGlobal).__workspaceFileChanges ?? [];
		});
	}
}
