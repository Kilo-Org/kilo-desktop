import { definePlugin, KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import { z } from "zod";

import {
	addColumn,
	Board,
	BOARD_MAX_COLUMNS,
	boardStateSchema,
	clearBoard,
	DEFAULT_BOARD,
	deleteColumn,
	moveColumn,
	placeSession,
	removeSession,
	renameColumn,
	renameSessions,
	type BoardState,
} from "../contracts";

interface PersistedBoard extends Record<string, unknown> {
	version: number;
	state: BoardState;
	importedFromOrigin: boolean;
	/** Whether the board kept under the plugin's previous id has been adopted. */
	adoptedPrevious?: boolean;
}

/** Origin's `workspace-board.json` and this plugin's own store share this shape. */
const storedSchema = z.object({
	version: z.literal(1),
	state: boardStateSchema,
	importedFromOrigin: z.boolean().catch(false),
});

export interface BoardMainOptions {
	/**
	 * Reads origin's saved board (kilo-ui's `workspace-board` kv file), adopted
	 * once: null when origin had none; throws when it can't be read now.
	 */
	readonly readOriginBoard?: (sdk: PluginSdk) => Promise<string | null>;
	/**
	 * Reads the board kept under the plugin's previous id (`kilo.board`'s
	 * `board` kv file), adopted once before origin's: null when there was
	 * none; throws when it can't be read now.
	 */
	readonly readPreviousBoard?: (sdk: PluginSdk) => Promise<string | null>;
}

/**
 * kilo.workspace-board's main entry: the board in kv, provided as `kilo.workspace-board/board`
 * to every window. Main is the only writer; windows apply the same pure
 * operations optimistically and wait for the revision their call returns.
 * Deleting a column never drops cards (they move to a neighbour) and the
 * last column stays. A stored board that does not validate reads as the
 * default board until the next change replaces it.
 *
 * Cards are Work Session ids. A deleted session's card is dropped on
 * kilo.sessions' `deleted` event; cards of sessions that aren't known are
 * kept (kilo.sessions may still be importing) and windows hide them.
 * The board kept under the plugin's previous id (`kilo.board`) is adopted
 * once, with whether origin's was already imported. Origin's board is adopted
 * once; cards it saved under a chat id move to the session holding that chat
 * when sessions are known. Either import is skipped for good once the board
 * changes here, so a read retried on a later launch never replaces it.
 */
export function createBoardMainEntry(options: BoardMainOptions = {}) {
	return definePlugin({
		async activate(sdk) {
			const store = mainHost(sdk).storage.kv<PersistedBoard>({
				namespace: "board",
				defaults: { version: 1, state: DEFAULT_BOARD, importedFromOrigin: false },
			});
			const read = (): BoardState => {
				const parsed = storedSchema.safeParse(store.snapshot());
				if (parsed.success) return parsed.data.state;
				sdk.logger.warn("The stored board is invalid; showing the default board until it changes.");
				return DEFAULT_BOARD;
			};
			// A board changed here is never replaced by an import retried on a later launch.
			const save = (state: BoardState) =>
				store.set({
					...store.snapshot(),
					version: 1,
					state,
					importedFromOrigin: true,
					adoptedPrevious: true,
				});

			const { readPreviousBoard, readOriginBoard } = options;
			if (readPreviousBoard && !store.snapshot().adoptedPrevious) {
				const previous = await readStored("the previous id's board", () => readPreviousBoard(sdk));
				if (previous !== "retry") {
					store.set({
						...store.snapshot(),
						...(previous
							? { state: previous.state, importedFromOrigin: previous.importedFromOrigin }
							: {}),
						adoptedPrevious: true,
					});
				}
			}
			if (readOriginBoard && !store.snapshot().importedFromOrigin) {
				const origin = await readStored("origin's board", () => readOriginBoard(sdk));
				if (origin !== "retry") {
					store.set({
						...store.snapshot(),
						version: 1,
						state: origin?.state ?? read(),
						importedFromOrigin: true,
					});
				}
			}

			let revision = 0;
			const board = sdk.domains.provide(Board, {
				initialState: { board: read(), revision },
				methods: {
					place: ({ sessionId, columnId, index }) => {
						const before = readWithColumn(columnId);
						return commit(before, placeSession(before, sessionId, columnId, index));
					},
					remove: ({ sessionId }) => {
						const before = read();
						return commit(before, removeSession(before, sessionId));
					},
					clear: () => {
						const before = read();
						return commit(before, clearBoard(before));
					},
					addColumn: ({ columnId, label }) => {
						const before = read();
						if (before.columns.some((column) => column.id === columnId)) {
							throw new KernelError("VALIDATION", "That column already exists.");
						}
						if (before.columns.length >= BOARD_MAX_COLUMNS) {
							throw new KernelError(
								"BUSINESS",
								`A board can have at most ${BOARD_MAX_COLUMNS} columns.`,
							);
						}
						return commit(before, addColumn(before, columnId, label));
					},
					renameColumn: ({ columnId, label }) => {
						const before = readWithColumn(columnId);
						return commit(before, renameColumn(before, columnId, label));
					},
					moveColumn: ({ columnId, index }) => {
						const before = readWithColumn(columnId);
						return commit(before, moveColumn(before, columnId, index));
					},
					deleteColumn: ({ columnId }) => {
						const before = readWithColumn(columnId);
						if (before.columns.length === 1) {
							throw new KernelError("BUSINESS", "A board needs at least one column.");
						}
						return commit(before, deleteColumn(before, columnId));
					},
				},
			});

			function readWithColumn(columnId: string): BoardState {
				const before = read();
				if (!before.columns.some((column) => column.id === columnId)) {
					throw new KernelError("NOT_FOUND", "Board column not found.");
				}
				return before;
			}
			function commit(before: BoardState, after: BoardState): number {
				if (after === before) return revision;
				const parsed = boardStateSchema.safeParse(after);
				// Inputs and column limits are checked before this, so only the card limit can fail.
				if (!parsed.success) throw new KernelError("VALIDATION", "The board is full.");
				try {
					save(parsed.data);
				} catch (error) {
					sdk.logger.error("Could not save the board", error);
					throw new KernelError("BUSINESS", "Could not save the board. Please try again.");
				}
				revision += 1;
				board.setState({ board: parsed.data, revision });
				return revision;
			}
			function adoptChatCards(sessions: readonly WorkSession[]): void {
				const before = read();
				const known = new Set(sessions.map((session) => session.id));
				const onBoard = before.columns.flatMap((column) => column.sessionIds);
				const unknown = new Set(onBoard.filter((id) => !known.has(id)));
				if (unknown.size === 0) return;
				const renames: Record<string, string> = {};
				for (const session of sessions) {
					for (const chatId of session.chatIds) {
						if (unknown.has(chatId)) renames[chatId] = session.id;
					}
				}
				if (Object.keys(renames).length > 0) commit(before, renameSessions(before, renames));
			}

			const stops: (() => void)[] = [];
			sdk.domains.track(WorkSessions, {
				added(sessions) {
					adoptChatCards(sessions.getState().sessions);
					stops.push(
						sessions.subscribe((state) => adoptChatCards(state.sessions)),
						sessions.on("deleted", ({ session }) => {
							const before = read();
							commit(before, removeSession(before, session.id));
						}),
					);
				},
				removed() {
					for (const stop of stops.splice(0)) stop();
				},
			});
			sdk.onDispose(() => {
				for (const stop of stops.splice(0)) stop();
			});

			/** A board saved elsewhere: null when there's none or it's invalid, `retry` when unreadable now. */
			async function readStored(
				what: string,
				readRaw: () => Promise<string | null>,
			): Promise<{ state: BoardState; importedFromOrigin: boolean } | null | "retry"> {
				let raw: string | null;
				try {
					raw = await readRaw();
				} catch (error) {
					sdk.logger.warn(`Could not read ${what}; trying again next time`, error);
					return "retry";
				}
				if (raw === null) return null;
				try {
					const parsed = storedSchema.safeParse(JSON.parse(raw));
					return parsed.success
						? { state: parsed.data.state, importedFromOrigin: parsed.data.importedFromOrigin }
						: null;
				} catch {
					return null;
				}
			}
		},
	});
}
