import { writeFile } from "node:fs/promises";
import path from "node:path";

import { getPage } from "@anaconda/playwright-utils/page-utils";

import { callDomainMethod } from "../../../utils/kernel-domains.js";

type FileChangeType = "create" | "update" | "delete";
interface FileChangeBatch {
	root: string;
	changes: { path: string; type: string }[];
}

/** Per-attempt wait before writing a fresh file; 5 attempts bound the worst case. */
const ATTEMPT_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 5;

/** Waits until kilo.workspaces' watcher reports `folderPath` as actively watched. */
export async function waitForWorkspaceWatcher(folderPath: string): Promise<void> {
	await getPage().waitForFunction(async (expectedPath) => {
		type Watched = { path: string; state: string };
		type Bridge = {
			request(
				channel: string,
				payload: unknown,
			): Promise<{
				ok: boolean;
				value?: { domains: { id: string; state: { watched?: Watched[] } }[] };
			}>;
		};
		const bridge = (globalThis as typeof globalThis & { kernelBridge: Bridge }).kernelBridge;
		// Main answers `kernel:hydrate` with every domain object's current state.
		const result = await bridge.request("kernel:hydrate", null);
		const files = result.value?.domains.find((domain) => domain.id === "kilo.workspaces/file");
		return (files?.state.watched ?? []).some(
			(folder) => folder.path === expectedPath && folder.state === "active",
		);
	}, folderPath);
}

/**
 * Page object for the built-in workspace watcher smoke flow.
 *
 * The watcher is headless (main-process only), so the flow drives it through
 * the kernel bridge: the workspace is created with a `kilo.workspaces/workspace`
 * domain call, and batches are observed as `kilo.workspaces/file` `changed`
 * domain events broadcast to the window. This exercises the real native
 * @parcel/watcher addon inside the packaged binary — the only tier that can.
 */
export class WorkspaceWatcherPage {
	/**
	 * Create a workspace holding one folder. The creation event re-runs the
	 * watcher's reconcile, which subscribes the native watcher to the folder.
	 */
	async createWorkspace(folderPath: string, name: string): Promise<void> {
		await callDomainMethod(
			"kilo.workspaces/workspace",
			"create",
			{ name, folders: [{ path: folderPath, isPrimary: true }] },
			"kilo.workspaces",
		);
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

	/** Collect `kilo.workspaces/file` `changed` events broadcast to the window. Idempotent. */
	async #startListeningForFileChanges(): Promise<void> {
		await getPage().evaluate(() => {
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
					message.id === "kilo.workspaces/file" &&
					message.event === "changed"
				) {
					global.__workspaceFileChanges!.push(message.payload as FileChangeBatch);
				}
			});
		});
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
