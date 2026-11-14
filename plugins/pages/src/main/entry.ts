/**
 * kilo.pages in main: nteract Pages served on this device by celld, for
 * Pages panes and for the agent.
 *
 * Ownership and lifecycle:
 * - The `server` kernel service (`first-use`) owns one run: the identity
 *   bridge (a fake Kilo app with a new exchange secret each run), the celld
 *   project folder under this plugin's storage (`server/`, whose `.celld/`
 *   holds every page) and the `celld dev` process. Stopping the service ends
 *   all three; a crash goes to the kernel's restart policy. Once the app is
 *   ready the service is started anyway, so the agent's MCP connection finds
 *   it, unless `KILO_PAGES_DEFER_SERVER=1` (packaged e2e).
 * - `kilo.pages/server` publishes the run's status and origin; `ensure` and
 *   `prepareView` start it (restarting it once it has given up) and fail with
 *   the run's own message when it can't.
 * - What must not change between runs is kept in kv: the port (page links
 *   and the agent's MCP URL carry it), Pages' session secret, and the key
 *   that signs the agent's long-lived token (so the Kilo server's
 *   environment, which restarts it when it changes, stays the same).
 * - The agent reaches Pages through the `pages-local` `kilo.core/mcp-server`
 *   entry, whose URL and bearer token are `{env:…}` references filled by the
 *   `pages` `kilo.core/server-env` source: the token never lands in Kilo's
 *   config file. Both appear once the port is known and only when the build
 *   and celld were found.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
	definePlugin,
	environmentReady,
	KernelApp,
	KernelError,
	KernelService,
	KernelServices,
	mainHost,
	type MainHostServices,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { McpServer, ServerEnv } from "@kilo-desktop/plugin-core/contracts";

import {
	PAGES_SERVER_ENV,
	PAGES_SERVICE_KEY,
	PagesServer,
	type PagesServerState,
} from "../contracts/index.js";
import { defaultCelld, defaultServerBuild, localUser } from "./assets.js";
import { CelldProcess } from "./celld-process.js";
import {
	createAgentToken,
	startIdentityBridge,
	verifyAgentToken,
	type IdentityBridge,
	type PagesUser,
} from "./identity-bridge.js";
import {
	allocateLoopbackPort,
	choosePort,
	isLoopbackPortFree,
	reclaimStaleCelld,
} from "./ports.js";
import { pagesPublicOrigin, prepareServerFolder } from "./server-folder.js";

export interface PagesMainOptions {
	/** The celld executable; defaults to `PAGES_CELLD_PATH`, then `resources/celld/celld`. */
	readonly resolveCelld?: (host: MainHostServices) => string | undefined;
	/** Pages' build folder; defaults to `PAGES_SERVER_DIR`, then `resources/pages-server`. */
	readonly resolveServerBuild?: (host: MainHostServices) => string | undefined;
	/** Arguments before celld's own (tests run a Node stand-in). */
	readonly celldArgs?: readonly string[];
	readonly allocatePort?: () => Promise<number>;
	readonly isPortFree?: (port: number) => Promise<boolean>;
	readonly reclaimPort?: (port: number) => Promise<void>;
	readonly user?: PagesUser;
	readonly readyTimeoutMs?: number;
	/** Starts the server once the app is ready (default: unless `KILO_PAGES_DEFER_SERVER=1`). */
	readonly warmStart?: boolean;
}

interface SavedServer extends Record<string, unknown> {
	port: number | null;
	sessionSecret: string;
	signingKey: string;
	agentToken: string;
}

export const PAGES_AUDIENCE = "pages-desktop";
export const PAGES_MCP_ENTRY = "pages-local";
const LOGIN_PATH = "/api/auth/login?return_to=/pages";
/** A token is replaced this long before it expires. */
const TOKEN_RENEWAL_SECONDS = 30 * 24 * 60 * 60;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const secret = () => randomBytes(32).toString("hex");

export function createPagesMainEntry(options: PagesMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const store = host.storage.kv<SavedServer>({
				namespace: "server",
				defaults: { port: null, sessionSecret: "", signingKey: "", agentToken: "" },
			});
			if (!store.get("sessionSecret")) store.set({ sessionSecret: secret() });
			if (!store.get("signingKey")) store.set({ signingKey: secret(), agentToken: "" });
			const user = options.user ?? localUser();
			const signingKey = store.get("signingKey");
			const tokenIsFresh = verifyAgentToken(store.get("agentToken"), {
				audience: PAGES_AUDIENCE,
				signingKey,
				nowSeconds: Math.floor(Date.now() / 1000) + TOKEN_RENEWAL_SECONDS,
			});
			if (!tokenIsFresh) {
				store.set({
					agentToken: createAgentToken({ audience: PAGES_AUDIENCE, signingKey, userId: user.id }),
				});
			}

			const celldPath = (options.resolveCelld ?? defaultCelld)(host);
			const buildDir = (options.resolveServerBuild ?? defaultServerBuild)(host);
			const missing = !celldPath
				? "celld isn't installed (set PAGES_CELLD_PATH or run prepare-assets)."
				: !buildDir
					? "The Pages build isn't installed (set PAGES_SERVER_DIR or run prepare-assets)."
					: null;

			const server = sdk.domainObjects.provide(PagesServer, {
				initialState: {
					status: missing ? "unavailable" : "stopped",
					origin: null,
					message: missing,
				},
				methods: {
					ensure: async () => ({ origin: await ensure() }),
					prepareView: async () => {
						const origin = await ensure();
						const browser = host.browser;
						if (!browser) {
							throw new KernelError("UNAVAILABLE", "This app can't show embedded web pages.");
						}
						browser.initialize();
						return { partition: browser.partition, url: `${origin}${LOGIN_PATH}` };
					},
				},
			});
			const setState = (patch: Partial<PagesServerState>) =>
				server.update((state) => ({ ...state, ...patch }));

			// --- What the agent is given: stable across runs once the port is known. ---
			const agentListeners = new Set<() => void>();
			const notifyAgent = () => {
				for (const listener of agentListeners) listener();
			};
			const subscribeAgent = (listener: () => void) => {
				agentListeners.add(listener);
				return () => void agentListeners.delete(listener);
			};
			const agentPort = () => (missing ? null : store.get("port"));
			const savePort = (port: number) => {
				if (store.get("port") === port) return;
				store.set({ port });
				notifyAgent();
			};
			if (!missing && store.get("port") === null) {
				void (options.allocatePort ?? allocateLoopbackPort)().then(
					(port) => {
						if (store.get("port") === null) savePort(port);
					},
					(error: unknown) =>
						sdk.logger.warn(`Could not choose a port for Pages: ${errorMessage(error)}`),
				);
			}
			sdk.extensions.implement(McpServer, PAGES_MCP_ENTRY, {
				read: () =>
					agentPort() === null
						? undefined
						: {
								type: "remote",
								url: `{env:${PAGES_SERVER_ENV.mcpUrl}}`,
								// A loopback server with a bearer token; skip Kilo's OAuth discovery.
								oauth: false,
								headers: { Authorization: `Bearer {env:${PAGES_SERVER_ENV.mcpToken}}` },
								enabled: true,
							},
				subscribe: subscribeAgent,
			});
			sdk.extensions.implement(ServerEnv, "pages", {
				read: () => {
					const port = agentPort();
					return port === null
						? {}
						: {
								[PAGES_SERVER_ENV.mcpUrl]: `http://127.0.0.1:${port}/mcp`,
								[PAGES_SERVER_ENV.mcpToken]: store.get("agentToken"),
							};
				},
				subscribe: subscribeAgent,
			});

			// --- The server run. ---
			let bridge: IdentityBridge | undefined;
			let celld: CelldProcess | undefined;
			const release = async () => {
				const [process, identity] = [celld, bridge];
				celld = undefined;
				bridge = undefined;
				await process?.stop();
				await identity?.close();
			};
			sdk.onDispose(release);

			sdk.extensions.implement(KernelService, "server", {
				start: async (context) => {
					if (missing || !celldPath || !buildDir) {
						setState({ status: "unavailable", message: missing });
						throw new KernelError("UNAVAILABLE", missing ?? "Pages is unavailable.");
					}
					setState({ status: "starting", message: null });
					try {
						await environmentReady(sdk);
						context.progress("Starting Pages…");
						const port = await choosePort({
							saved: store.get("port"),
							isFree: options.isPortFree ?? isLoopbackPortFree,
							allocate: options.allocatePort ?? allocateLoopbackPort,
							reclaim: options.reclaimPort ?? reclaimStaleCelld,
						});
						savePort(port);
						const origin = pagesPublicOrigin(port);
						bridge = await startIdentityBridge({
							audience: PAGES_AUDIENCE,
							signingKey,
							pagesOrigin: () => origin,
							user,
						});
						const serverDir = path.join(host.storage.dir, "server");
						const { copied } = await prepareServerFolder({
							buildDir,
							serverDir,
							vars: {
								port,
								kiloAppUrl: bridge.url,
								audience: PAGES_AUDIENCE,
								exchangeSecret: bridge.exchangeSecret,
								sessionSecret: store.get("sessionSecret"),
							},
						});
						if (copied) sdk.logger.info(`Copied the Pages build into ${serverDir}.`);
						celld = new CelldProcess({
							executable: celldPath,
							...(options.celldArgs ? { executableArgs: options.celldArgs } : {}),
							serverDir,
							port,
							logger: sdk.logger,
							...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
							onUnexpectedExit: (error) => {
								setState({ status: "error", message: error.message });
								context.fail(error);
							},
						});
						await celld.start(context.signal);
						setState({ status: "running", origin, message: null });
					} catch (error) {
						await release();
						setState({ status: "error", message: errorMessage(error) });
						throw error;
					}
				},
				stop: async () => {
					await release();
					if (server.state.status !== "unavailable") setState({ status: "stopped" });
				},
			});

			const ensure = async (): Promise<string> => {
				const services = sdk.domainObjects.get(KernelServices);
				const failed = services?.getState().services[PAGES_SERVICE_KEY]?.status === "failed";
				// A failed start shows in the state's message; the caller gets that.
				await (
					failed
						? services?.methods.restart({ key: PAGES_SERVICE_KEY })
						: services?.methods.ensureStarted({ key: PAGES_SERVICE_KEY })
				)?.catch(() => undefined);
				const { status, origin, message } = server.state;
				if (status === "running" && origin) return origin;
				throw new KernelError("UNAVAILABLE", message ?? "The Pages server isn't running.");
			};

			const warmStart = options.warmStart ?? process.env["KILO_PAGES_DEFER_SERVER"] !== "1";
			const app = sdk.domainObjects.get(KernelApp);
			if (warmStart && !missing && app) {
				const warm = () => void ensure().catch(() => undefined);
				if (app.getState().phase === "ready") warm();
				else {
					const stop = app.on("phase-changed", ({ phase }) => {
						if (phase !== "ready") return;
						stop();
						warm();
					});
					sdk.onDispose(stop);
				}
			}
		},
	});
}
