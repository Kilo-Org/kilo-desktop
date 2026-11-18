// Boots kilo.workspace-board's main entry on a real main kernel, with a
// stand-in for kilo.work-sessions under its real manifest: only
// `kilo.work-sessions/work-sessions`, a work session list the test sets and a
// `deleted` event it emits. Origin's and the previous id's board files are
// real files in a temp folder. The stand-in can be left out to check the board
// works without kilo.work-sessions.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	definePlugin,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	type WorkSession,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { Board, BOARD_DEFINITIONS, type BoardState } from "../contracts";
import { createBoardMainEntry } from "./entry";

export const workSession = (id: string, chatIds: string[] = []): WorkSession => ({
	id,
	title: id,
	titleSource: "user",
	pinned: false,
	archived: false,
	archiveChangedAt: 0,
	workspaceId: null,
	branch: null,
	directory: null,
	chatIds,
	createdAt: 1,
	updatedAt: 1,
});

const kernels: MainKernel[] = [];
const directories: string[] = [];

/** Stops every kernel and removes every folder made since the last call (an `afterEach`). */
export async function stopBoardMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

const unused = () => {
	throw new Error("unused");
};

/** Stands in for kilo.work-sessions in main: the work session list and its `deleted` event. */
function workSessionsStandIn(initial: readonly WorkSession[]) {
	let provider: DomainObjectProvider<typeof WorkSessions> | undefined;
	const registration: PluginRegistration = {
		manifest: workSessionsManifest,
		definitions: WORK_SESSIONS_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				provider = sdk.domainObjects.provide(WorkSessions, {
					initialState: { workSessions: [...initial] },
					methods: {
						create: unused,
						createChat: unused,
						forkChat: unused,
						rename: unused,
						setPinned: unused,
						setArchived: unused,
						setBranch: unused,
						remove: unused,
						isolationOptions: unused,
					},
				});
			},
		}),
	};
	return {
		registration,
		set(workSessions: WorkSession[]) {
			provider!.setState({ workSessions });
		},
		delete(id: string) {
			const deleted = provider!.state.workSessions.find((candidate) => candidate.id === id)!;
			provider!.setState({
				workSessions: provider!.state.workSessions.filter((candidate) => candidate.id !== id),
			});
			provider!.emit("deleted", { workSession: deleted });
		},
	};
}

async function readOrNull(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export interface BootOptions {
	/** Origin's `workspace-board.json`: raw text, a board (saved as origin did), or a folder (unreadable). */
	readonly origin?: string | BoardState | "directory";
	/** The board file kept under the plugin's previous id, kilo.board. */
	readonly previous?: Record<string, unknown> | "directory";
	readonly storage?: ReturnType<typeof createMemoryStorage>;
	readonly workSessions?: WorkSession[];
	/** Leaves kilo.work-sessions out entirely. */
	readonly withoutWorkSessions?: boolean;
	readonly logger?: KernelLogger;
}

/** kilo.workspace-board's main entry with its stand-in. */
export async function bootBoardMain(options: BootOptions = {}) {
	const dir = await mkdtemp(path.join(tmpdir(), "board-"));
	directories.push(dir);
	const originFile = path.join(dir, "workspace-board.json");
	if (options.origin === "directory") await mkdir(originFile);
	else if (typeof options.origin === "string") await writeFile(originFile, options.origin);
	else if (options.origin) {
		await writeFile(originFile, JSON.stringify({ version: 1, state: options.origin }));
	}
	const previousFile = path.join(dir, "previous-board.json");
	if (options.previous === "directory") await mkdir(previousFile);
	else if (options.previous) await writeFile(previousFile, JSON.stringify(options.previous));

	const storage = options.storage ?? createMemoryStorage("/data/kilo.workspace-board");
	const workSessions = workSessionsStandIn(options.workSessions ?? []);
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...(options.withoutWorkSessions ? [] : [workSessions.registration]),
			{
				manifest,
				definitions: BOARD_DEFINITIONS,
				entry: createBoardMainEntry({
					readOriginBoard: () => readOrNull(originFile),
					readPreviousBoard: () => readOrNull(previousFile),
				}),
			},
		],
		hostServices: (pluginId) => ({
			storage: pluginId === manifest.id ? storage : createMemoryStorage(`/data/${pluginId}`),
		}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(kernel);
	await kernel.start();
	const board = kernel.kernelSdk.domainObjects.get(Board)!;
	const columns = () => board.getState().board.columns;
	const cards = () => Object.fromEntries(columns().map((c) => [c.id, c.sessionIds]));
	return { kernel, board, columns, cards, storage, workSessions };
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}
