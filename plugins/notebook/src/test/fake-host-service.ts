// A stand-in for nteract's host service: records what kilo.notebook's main
// entry asks of it and lets tests answer (daemon state, opened files, saves).
import type { ElectronMainPort } from "@runtimed/node/electron";
import { vi } from "vitest";

import type {
	NotebookOpenFileResult,
	NotebookSaveResult,
	NotebookStatus,
} from "../contracts/index.js";
import type { NotebookHostServiceLike } from "../main/entry.js";
import type {
	ElectronNotebookConnectionArgs,
	ElectronNotebookHostServiceOptions,
} from "../main/runtime/ElectronNotebookHostService.js";
import type { RuntimedDaemonState } from "../main/runtime/RuntimedDaemonManager.js";

export const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

export interface FakeConnection {
	readonly port: ElectronMainPort;
	readonly args: ElectronNotebookConnectionArgs;
	readonly windowId: string;
}

export function createFakeHostServices() {
	const created: ElectronNotebookHostServiceOptions[] = [];
	const connections: FakeConnection[] = [];
	const defaultSaveDirectories = new Map<string, string | null>();
	let daemon: RuntimedDaemonState = { status: "external" };
	let openFile = async (path: string): Promise<NotebookOpenFileResult> => ({
		notebookId: NOTEBOOK_ID,
		path,
		title: path.split("/").at(-1) ?? path,
	});
	let saveResult: NotebookSaveResult = { outcome: "saved" };
	const disposed = vi.fn(async () => undefined);
	const started = vi.fn(async () => daemon);
	const opened = vi.fn((path: string) => openFile(path));
	const saved = vi.fn(async (_notebookId: string) => saveResult);

	const create = (options: ElectronNotebookHostServiceOptions): NotebookHostServiceLike => {
		created.push(options);
		return {
			start: started,
			status: async (): Promise<NotebookStatus> =>
				daemon.status === "external" || daemon.status === "bundled"
					? {
							availability: { status: "available" },
							process: { status: daemon.status },
							daemon: null,
						}
					: {
							availability: {
								status: "unavailable",
								reason: daemon.status === "failed" ? daemon.reason : "Not ready.",
							},
							process: { status: daemon.status },
							daemon: null,
						},
			openFile: opened,
			save: saved,
			setDefaultSaveDirectory: (notebookId, directory) =>
				defaultSaveDirectories.set(notebookId, directory),
			connect: async (port, args, windowId) => {
				connections.push({ port, args, windowId });
			},
			dispose: disposed,
		};
	};

	return {
		create,
		created,
		connections,
		defaultSaveDirectories,
		started,
		opened,
		saved,
		disposed,
		/** The options the latest host service was created with. */
		options: () => created.at(-1)!,
		setDaemon: (next: RuntimedDaemonState) => {
			daemon = next;
		},
		setOpenFile: (next: typeof openFile) => {
			openFile = next;
		},
		setSaveResult: (next: NotebookSaveResult) => {
			saveResult = next;
		},
	};
}

export type FakeHostServices = ReturnType<typeof createFakeHostServices>;
