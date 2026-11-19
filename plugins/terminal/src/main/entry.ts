import {
	definePlugin,
	mainHost,
	type DomainObjectHandle,
	environmentReady,
	type DomainObjectProvider,
	type KernelLogger,
	type KernelPort,
	type MainHostServices,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Panes, WorkSessions, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	DEFAULT_TERMINAL_READ_LINES,
	TERMINAL_HOST,
	TERMINAL_PANE_KIND,
	TERMINAL_PORT,
	Terminals,
	type TerminalConnectionArgs,
	type TerminalIdentity,
	type TerminalProfile,
	type TerminalReadout,
} from "../contracts";
import { implementTerminalTools } from "./agent-tools";
import { createTerminalCwdResolver } from "./cwd";
import { importOriginHistory } from "./import-origin";
import { createTerminalPortHandler } from "./port";
import { ProfileService, type ShellDiscovery } from "./profiles/ProfileService";
import type { ShellCandidate } from "./sessions/shell-launch";
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
	/** Settles once the process environment is complete; shells start after it. */
	readonly environmentReady: () => Promise<void>;
	/** The shells a start tries, best first: the default profile, then automatic ones. */
	readonly resolveLaunch: () => Promise<readonly ShellCandidate[]>;
	readonly resolveCwd: (cwd?: string) => Promise<string>;
	readonly onSessionExited: (identity: TerminalIdentity, exit: TerminalExit) => void;
	readonly onLabelChanged: (identity: TerminalIdentity, label: string) => void;
	readonly logger: KernelLogger;
}

export interface TerminalMainOptions {
	readonly createManager: (deps: TerminalManagerDeps) => TerminalManagerLike;
	/** How shells are found on this machine (canned in tests). */
	readonly shells: ShellDiscovery;
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
 * ties shells to terminal panes. A pane's shell is its id under its work
 * session (or the one origin saved it under, in the pane's metadata). Panes
 * closing (and deleted work sessions, which drop their panes without `closed` events)
 * close their shells and delete their transcripts; a shell exiting closes its
 * pane; its label becomes the pane's title. Frames stream over the `session`
 * port, which waits for origin's transcripts to be imported (once, retried on
 * failure) so a reconnecting pane finds its history. Its agent tools open,
 * list and read the calling chat's work session's terminals. Shell profiles
 * (detected shells, the person's own, the default) live in `terminals`' state;
 * detection warms at activation and every shell start asks for the default.
 */
export function createTerminalMainEntry(options: TerminalMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const ready = importOrigin(sdk, host, options.originStorageDir);
			const known = new KnownTerminalPanes();
			let panes: DomainObjectHandle<typeof Panes> | null = null;
			const panesState = () => panes?.getState() ?? { byWorkSession: {} };

			const listTerminals = (workSessionId: string) =>
				terminalPanesOf(panesState(), workSessionId).map((pane) => ({
					terminalId: pane.id,
					title: pane.title,
					running: manager.isRunning(terminalIdentityOf(workSessionId, pane)),
				}));
			const readTerminal = async (workSessionId: string, terminalId: string, lines: number) => {
				const pane = terminalPanesOf(panesState(), workSessionId).find(
					(candidate) => candidate.id === terminalId,
				);
				if (!pane) return null;
				await ready;
				return manager.read(terminalIdentityOf(workSessionId, pane), lines);
			};

			const profiles = new ProfileService({
				storage: host.storage,
				discovery: options.shells,
				ready: () => environmentReady(sdk),
				logger: sdk.logger,
			});
			let disposed = false;
			sdk.onDispose(() => {
				disposed = true;
			});
			// Detection runs can overlap (a rescan while warming up); only the latest is published.
			let detectionRun = 0;
			const publishProfiles = (detection: Promise<TerminalProfile[]>) => {
				const run = ++detectionRun;
				return detection.then((list) => {
					if (run === detectionRun && !disposed)
						terminals.setState({ ...terminals.state, profiles: list });
					return list;
				});
			};
			const warnDetectionFailed = (error: unknown) =>
				sdk.logger.warn(
					`Could not detect the installed shells: ${error instanceof Error ? error.message : String(error)}`,
				);

			const terminals: DomainObjectProvider<typeof Terminals> = sdk.domainObjects.provide(
				Terminals,
				{
					initialState: { profiles: [], settings: profiles.settings() },
					methods: {
						updateSettings: (patch) => {
							const settings = profiles.updateSettings(patch);
							terminals.setState({ ...terminals.state, settings });
							void publishProfiles(profiles.profiles()).catch(warnDetectionFailed);
							return settings;
						},
						refreshProfiles: () => publishProfiles(profiles.refresh()),
						list: ({ workSessionId }) => listTerminals(workSessionId),
						read: ({ workSessionId, terminalId, lines }) =>
							readTerminal(workSessionId, terminalId, lines ?? DEFAULT_TERMINAL_READ_LINES),
						close: async ({ workSessionId, terminalId, deleteHistory }) => {
							const pane = terminalPanesOf(panesState(), workSessionId).find(
								(candidate) => candidate.id === terminalId,
							);
							await manager.close(
								pane
									? terminalIdentityOf(workSessionId, pane)
									: { sessionId: workSessionId, terminalId },
								deleteHistory ?? false,
							);
						},
					},
				},
			);

			const closeTerminal = (identity: TerminalIdentity) =>
				void manager.close(identity, true).catch((error: unknown) => {
					sdk.logger.warn("Could not close a terminal.", error);
				});

			void publishProfiles(profiles.profiles()).catch(warnDetectionFailed);

			const manager = options.createManager({
				storageDir: host.storage.dir,
				environmentReady: () => environmentReady(sdk),
				resolveLaunch: () => profiles.resolveLaunch(),
				resolveCwd: createTerminalCwdResolver(
					() => sdk.domainObjects.get(Workspaces),
					options.homeDirectory,
				),
				logger: sdk.logger,
				onSessionExited: (identity, exit) => {
					const located = locateTerminalPane(panesState(), identity);
					terminals.emit("exited", {
						workSessionId: located?.workSessionId ?? identity.sessionId,
						terminalId: identity.terminalId,
						...exit,
					});
					if (located && panes) {
						void panes.methods
							.close({ workSessionId: located.workSessionId, paneId: located.pane.id })
							.catch(() => closeTerminal(identity));
					} else closeTerminal(identity);
				},
				onLabelChanged: (identity, label) => {
					const located = locateTerminalPane(panesState(), identity);
					if (!located || !panes || located.pane.title === label) return;
					void panes.methods
						.update({
							workSessionId: located.workSessionId,
							paneId: located.pane.id,
							title: label,
						})
						.catch(() => undefined);
				},
			});
			sdk.onDispose(() => manager.dispose());

			sdk.onDispose(
				sdk.domainObjects.track(Panes, {
					added: (handle) => {
						panes = handle;
						known.remember(handle.getState());
						const stopState = handle.subscribe((state) => known.remember(state));
						const stopClosed = handle.on("closed", ({ workSessionId, pane }) => {
							if (pane.kind !== TERMINAL_PANE_KIND) return;
							known.forget(workSessionId, pane.id);
							closeTerminal(terminalIdentityOf(workSessionId, pane));
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
				sdk.domainObjects.track(WorkSessions, {
					added: (handle) => {
						sdk.onDispose(
							handle.on("deleted", ({ workSession }) => {
								const identities = new Map(
									[
										...known.takeWorkSession(workSession.id),
										...terminalPanesOf(panesState(), workSession.id).map((pane) =>
											terminalIdentityOf(workSession.id, pane),
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
