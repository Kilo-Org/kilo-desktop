import { writeFile } from "node:fs/promises";
import path from "node:path";

import { getPage } from "@anaconda/playwright-utils/page-utils";

type FileChangeType = "create" | "update" | "delete";
interface FileChangeBatch {
	root: string;
	changes: { path: string; type: string }[];
}

/** Per-attempt wait before writing a fresh file; 5 attempts bound the worst case. */
const ATTEMPT_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 5;

/**
 * Page object for the built-in workspace watcher smoke flow.
 *
 * The watcher is headless (main-process only), so the flow drives it through
 * the two renderer-reachable bridges: workspace CRUD via
 * `desktopApi.invoke("feature:invoke", ...)` on kilo-ui (same trick as the
 * git plugin's smoke spec), and batch observation via the raw
 * "feature:event" channel the shell broadcasts main-side emissions on.
 * This exercises the real native @parcel/watcher addon inside the packaged
 * binary — the only tier that can.
 */
export class WorkspaceWatcherPage {
	/**
	 * Create a workspace holding one folder. The creation event re-runs the
	 * watcher's reconcile, which subscribes the native watcher to the folder.
	 */
	async createWorkspace(folderPath: string, name: string): Promise<void> {
		await getPage().evaluate(
			async ({ folderPath, name }) => {
				type InvokeResult =
					| { ok: true; value: unknown }
					| { ok: false; error: { code: string; message: string } };
				type DesktopGlobal = typeof globalThis & {
					desktopApi: {
						invoke(
							channel: "feature:invoke",
							input: { featureId: string; channel: string; args?: unknown },
						): Promise<InvokeResult>;
					};
				};
				const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId: "kilo-ui",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			},
			{ folderPath, name },
		);
	}

	/**
	 * Write a new file into a watched folder and await the `create` batch the
	 * watcher must publish for it.
	 *
	 * The native watcher arms asynchronously after `createWorkspace`, so a
	 * write can race its subscription. Each attempt writes a fresh file —
	 * a raced write is retried, never waited on — and the first observed
	 * batch proves the packaged binary's full chain: native parcel events →
	 * normalization → main event bus → IPC bridge → renderer.
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

	/** Collect `workspace.file-change` batches broadcast over the event bridge. Idempotent. */
	async #startListeningForFileChanges(): Promise<void> {
		await getPage().evaluate(() => {
			type FeatureEventEnvelope = { featureId: string; name: string; payload?: unknown };
			type DesktopGlobal = typeof globalThis & {
				desktopApi: {
					on(
						channel: "feature:event",
						listener: (payload: FeatureEventEnvelope) => void,
					): () => void;
				};
				__workspaceFileChanges?: FileChangeBatch[];
			};
			const global = globalThis as DesktopGlobal;
			if (global.__workspaceFileChanges) return;
			global.__workspaceFileChanges = [];
			global.desktopApi.on("feature:event", (envelope) => {
				if (envelope.featureId === "workspace" && envelope.name === "file-change") {
					global.__workspaceFileChanges!.push(envelope.payload as FileChangeBatch);
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
