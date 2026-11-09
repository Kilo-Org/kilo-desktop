import {
	definePlugin,
	mainHost,
	type DomainHandle,
	type DomainProvider,
	type KernelLogger,
	type KernelPort,
	type MainHostServices,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Panes, WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import {
	DEFAULT_TERMINAL_READ_LINES,
	TERMINAL_HOST,
	TERMINAL_PANE_KIND,
	TERMINAL_PORT,
	Terminals,
	type TerminalConnectionArgs,
	type TerminalIdentity,
	type TerminalReadout,
} from "../contracts";
import { implementTerminalTools } from "./agent-tools";
import { createTerminalCwdResolver } from "./cwd";
import { importOriginHistory } from "./import-origin";
import { createTerminalPortHandler } from "./port";
import type { TerminalExit } from "./sessions/TerminalSessionManager";
import {
	KnownTerminalPanes,
	locateTerminalPane,
	terminalIdentityOf,
	terminalPanesOf,
} from "./terminal-panes";

/** What the entry needs from the session manager (a fake in tests). */
export interface TerminalManagerLike {
	attach(port: KernelPort, args: TerminalConnectionArgs): Promise<void>;
	close(identity: TerminalIdentity, deleteHistory: boolean): Promise<void>;
	read(identity: TerminalIdentity, lines: number): Promise<TerminalReadout | null>;
	isRunning(identity: TerminalIdentity): boolean;
	dispose(): Promise<void>;
}

export interface TerminalManagerDeps {
	readonly storageDir: string;
	readonly resolveCwd: (cwd?: string) => Promise<string>;
	readonly onSessionExited: (identity: TerminalIdentity, exit: TerminalExit) => void;
	readonly onLabelChanged: (identity: TerminalIdentity, label: string) => void;
	readonly logger: KernelLogger;
}

export interface TerminalMainOptions {
	readonly createManager: (deps: TerminalManagerDeps) => TerminalManagerLike;
	/** Where terminals start when no folder is asked for. */
	readonly homeDirectory?: string;
	/** Origin's storage folder, whose transcripts are imported once. */
	readonly originStorageDir?: (sdk: PluginSdk) => string;
}

/** ghostty-web copies selections through navigator.clipboard; without this every copy falls back to execCommand. */
const CLIPBOARD_WRITE_PERMISSION = "clipboard-sanitized-write";

interface Persisted extends Record<string, unknown> {
	importedFromOrigin: boolean;
}

/**
 * kilo.terminal in main. The session manager owns every shell; this entry
 * ties shells to terminal panes. A pane's shell is its id under its session
 * (or the one origin saved it under, in the pane's metadata). Panes closing
 * (and deleted sessions, which drop their panes without `closed` events)
 * close their shells and delete their transcripts; a shell exiting closes its
 * pane; its label becomes the pane's title. Frames stream over the `session`
 * port, which waits for origin's transcripts to be imported (once, retried on
 * failure) so a reconnecting pane finds its history. Its agent tools open,
 * list and read the calling chat's session's terminals.
 */
export function createTerminalMainEntry(options: TerminalMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const ready = importOrigin(sdk, host, options.originStorageDir);
			const known = new KnownTerminalPanes();
			let panes: DomainHandle<typeof Panes> | null = null;
			const panesState = () => panes?.getState() ?? { bySession: {} };

			const listTerminals = (sessionId: string) =>
				terminalPanesOf(panesState(), sessionId).map((pane) => ({
					terminalId: pane.id,
					title: pane.title,
					running: manager.isRunning(terminalIdentityOf(sessionId, pane)),
				}));
			const readTerminal = async (sessionId: string, terminalId: string, lines: number) => {
				const pane = terminalPanesOf(panesState(), sessionId).find(
					(candidate) => candidate.id === terminalId,
				);
				if (!pane) return null;
				await ready;
				return manager.read(terminalIdentityOf(sessionId, pane), lines);
			};

			const terminals: DomainProvider<typeof Terminals> = sdk.domains.provide(Terminals, {
				initialState: {},
				methods: {
					list: ({ sessionId }) => listTerminals(sessionId),
					read: ({ sessionId, terminalId, lines }) =>
						readTerminal(sessionId, terminalId, lines ?? DEFAULT_TERMINAL_READ_LINES),
					close: async ({ sessionId, terminalId, deleteHistory }) => {
						const pane = terminalPanesOf(panesState(), sessionId).find(
							(candidate) => candidate.id === terminalId,
						);
						await manager.close(
							pane ? terminalIdentityOf(sessionId, pane) : { sessionId, terminalId },
							deleteHistory ?? false,
						);
					},
				},
			});

			const closeTerminal = (identity: TerminalIdentity) =>
				void manager.close(identity, true).catch((error: unknown) => {
					sdk.logger.warn("Could not close a terminal.", error);
				});

			const manager = options.createManager({
				storageDir: host.storage.dir,
				resolveCwd: createTerminalCwdResolver(
					() => sdk.domains.get(Workspaces),
					options.homeDirectory,
				),
				logger: sdk.logger,
				onSessionExited: (identity, exit) => {
					const located = locateTerminalPane(panesState(), identity);
					terminals.emit("exited", {
						sessionId: located?.sessionId ?? identity.sessionId,
						terminalId: identity.terminalId,
						...exit,
					});
					if (located && panes) {
						void panes.methods
							.close({ sessionId: located.sessionId, paneId: located.pane.id })
							.catch(() => closeTerminal(identity));
					} else closeTerminal(identity);
				},
				onLabelChanged: (identity, label) => {
					const located = locateTerminalPane(panesState(), identity);
					if (!located || !panes || located.pane.title === label) return;
					void panes.methods
						.update({ sessionId: located.sessionId, paneId: located.pane.id, title: label })
						.catch(() => undefined);
				},
			});
			sdk.onDispose(() => manager.dispose());

			sdk.onDispose(
				sdk.domains.track(Panes, {
					added: (handle) => {
						panes = handle;
						known.remember(handle.getState());
						const stopState = handle.subscribe((state) => known.remember(state));
						const stopClosed = handle.on("closed", ({ sessionId, pane }) => {
							if (pane.kind !== TERMINAL_PANE_KIND) return;
							known.forget(sessionId, pane.id);
							closeTerminal(terminalIdentityOf(sessionId, pane));
						});
						sdk.onDispose(() => {
							stopState();
							stopClosed();
						});
					},
					removed: () => {
						panes = null;
					},
				}),
			);
			sdk.onDispose(
				sdk.domains.track(WorkSessions, {
					added: (handle) => {
						sdk.onDispose(
							handle.on("deleted", ({ session }) => {
								const identities = new Map(
									[
										...known.takeSession(session.id),
										...terminalPanesOf(panesState(), session.id).map((pane) =>
											terminalIdentityOf(session.id, pane),
										),
									].map((identity) => [`${identity.sessionId}\0${identity.terminalId}`, identity]),
								);
								for (const identity of identities.values()) closeTerminal(identity);
							}),
						);
					},
					removed: () => {},
				}),
			);

			implementTerminalTools(sdk, {
				panes: () => panes,
				list: listTerminals,
				read: readTerminal,
			});

			sdk.ports.handle(TERMINAL_PORT, createTerminalPortHandler(manager, ready, sdk.logger));

			if (host.embeddedHosts) {
				sdk.onDispose(
					host.embeddedHosts.register({
						host: TERMINAL_HOST,
						root: frameRoot(host),
						permissions: [CLIPBOARD_WRITE_PERMISSION],
					}),
				);
			}
		},
	});
}

/** The built frame; undefined where this build ships none. */
function frameRoot(host: MainHostServices): string | undefined {
	try {
		return host.assets?.resolve("resources/terminal");
	} catch {
		return undefined;
	}
}

async function importOrigin(
	sdk: PluginSdk,
	host: MainHostServices,
	originStorageDir: TerminalMainOptions["originStorageDir"],
): Promise<void> {
	const store = host.storage.kv<Persisted>({
		namespace: "terminal",
		defaults: { importedFromOrigin: false },
	});
	if (!originStorageDir || store.get("importedFromOrigin")) return;
	const origin = originStorageDir(sdk);
	try {
		await importOriginHistory(origin, host.storage.dir);
		store.set({ importedFromOrigin: true });
	} catch (error) {
		sdk.logger.warn(
			`Could not import terminal history from ${origin}; will try again next launch: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
