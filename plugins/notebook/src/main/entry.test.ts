import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelDialogs,
	KernelError,
	KernelServices,
	KernelShell,
	type EmbeddedHostRegistration,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestKernelPair,
	testPlugin,
} from "@kilo-desktop/kernel/testing";
import {
	AgentTool,
	RuntimeConfigPoint,
	toolWireName,
	type RuntimeConfigSource,
	type ToolCallContext,
} from "@kilo-desktop/plugin-agent/contracts";
import { Flags, FLAGS_DEFINITIONS } from "@kilo-desktop/plugin-flags/contracts";
import { Panes, type Pane } from "@kilo-desktop/plugin-sessions/contracts";

import manifest from "../../plugin.json";
import {
	FILE_OBJECT_TYPE,
	NOTEBOOK_DEFINITIONS,
	NOTEBOOK_HOST_PORT,
	NOTEBOOK_PANE_KIND,
	Notebooks,
	RUNTIMED_SERVICE_KEY,
} from "../contracts/index.js";
import { createFakeHostServices, NOTEBOOK_ID } from "../test/fake-host-service.js";
import {
	agentPoints,
	createSessionsHost,
	filesOpener,
	notebookPane,
	SESSION_ID,
} from "../test/sessions-host.js";
import { createNotebookMainEntry, type NotebookMainOptions } from "./entry.js";
import { resolveDaemonSocketPath } from "./runtime/socket-path.js";
import type { OpenTelemetryRegistration } from "./runtime/NotebookTelemetryPermission.js";

const WAIT = { timeout: 5_000 };
const NEW_ID = "11111111-2222-4333-8444-555555555555";

interface BootOptions {
	readonly useDefaultSocket?: boolean;
	readonly panes?: readonly Pane[];
	readonly entry?: Partial<NotebookMainOptions>;
	readonly withoutSessions?: boolean;
	readonly withoutEmbeddedHosts?: boolean;
	readonly flags?: Record<string, unknown>;
	readonly allowed?: boolean;
}

const temporaryDirectories: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function flagsPlugin(flags: Record<string, unknown>) {
	return testPlugin("kilo.flags", {
		manifest: { domains: [{ id: "flags", home: "main" }] },
		definitions: FLAGS_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domains.provide(Flags, { initialState: { flags, ready: true }, methods: {} });
			},
		}),
	});
}

async function boot(options: BootOptions = {}) {
	const services = createFakeHostServices();
	const sessions = createSessionsHost(options.panes ?? []);
	const storage = createMemoryStorage("/memory/kilo.notebook");
	const embedded: EmbeddedHostRegistration[] = [];
	const registrations: PluginRegistration[] = [
		agentPoints,
		...(options.flags ? [flagsPlugin(options.flags)] : []),
		...(options.withoutSessions ? [] : [sessions.registration, filesOpener]),
		{
			manifest,
			definitions: NOTEBOOK_DEFINITIONS,
			entry: createNotebookMainEntry({
				createHostService: services.create,
				...(options.useDefaultSocket ? {} : { socketPath: "/tmp/runtimed.sock" }),
				warmStart: false,
				createId: () => NEW_ID,
				resolveRuntimedBinary: () => "/resources/runtimed/runtimed-nightly",
				resolveBundleRoot: () => "/resources/notebook",
				resolveKiloPluginEntry: () => "/resources/kilo-plugin/index.js",
				resolveRuntimedNodeEntry: () => "/app.asar.unpacked/node_modules/@runtimed/node/index.cjs",
				...options.entry,
			}),
		},
	];
	const { main, renderer } = await createTestKernelPair({
		main: registrations,
		renderer: [
			{ manifest, definitions: NOTEBOOK_DEFINITIONS, entry: definePlugin({ activate() {} }) },
		],
		mainHostServices: (pluginId) =>
			pluginId === "kilo.notebook"
				? {
						storage,
						...(options.withoutEmbeddedHosts
							? {}
							: {
									embeddedHosts: {
										register: (registration: EmbeddedHostRegistration) => {
											embedded.push(registration);
											return () => undefined;
										},
									},
								}),
					}
				: {},
	});
	main.kernelSdk.domains.provide(KernelDataCollection, {
		initialState: {
			choice: true,
			allowed: options.allowed ?? false,
			installationId: "install",
			environment: "development",
		},
		methods: { setChoice: () => undefined },
	});
	await main.flush();
	const notebooks = main.kernelSdk.domains.get(Notebooks)!;
	const panes = () => main.kernelSdk.domains.get(Panes)!;
	const paneOf = (paneId: string) => sessions.panes().panes.find((pane) => pane.id === paneId);
	const tool = (id: string) =>
		main.kernelSdk.extensions
			.list(AgentTool)
			.find((contribution) => contribution.key === `kilo.notebook/${id}`)!;
	const callTool = (id: string, input: unknown = {}, sessionId: string | null = SESSION_ID) => {
		const context: ToolCallContext = {
			sessionId,
			chatId: sessionId ? "chat" : null,
			callId: "call_1",
			external: false,
			signal: new AbortController().signal,
		};
		const { implementation } = tool(id);
		return Promise.resolve().then(() =>
			implementation!.run(implementation!.input.parse(input), context),
		);
	};
	return {
		main,
		renderer,
		services,
		sessions,
		storage,
		embedded,
		notebooks,
		panes,
		paneOf,
		tool,
		callTool,
	};
}

describe("kilo.notebook in main", () => {
	it("uses the stable singleton for the pinned notebook release", async () => {
		vi.stubEnv("RUNTIMED_SOCKET_PATH", "");
		const host = await boot({ useDefaultSocket: true });
		await host.notebooks.methods.status(undefined);
		expect(host.services.options()).toMatchObject({
			runtimeChannel: "stable",
		});
		const source = host.main.kernelSdk.extensions
			.list(RuntimeConfigPoint)
			.find((contribution) => contribution.pluginId === "kilo.notebook")!
			.implementation as RuntimeConfigSource;
		expect(source.read().env?.["RUNTIMED_SOCKET_PATH"]).toBe(
			resolveDaemonSocketPath({ channel: "stable" }),
		);
	});

	it("opens workspace notebooks in a Notebook pane, ahead of Files", async () => {
		const host = await boot();

		const notebook = await host.panes().methods.openObject({
			sessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/analysis.ipynb" },
		});
		const script = await host.panes().methods.openObject({
			sessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/app.py" },
		});

		expect(notebook?.kind).toBe(NOTEBOOK_PANE_KIND);
		expect(script?.kind).toBe("kilo.files/files");
		await vi.waitFor(
			() =>
				expect(host.paneOf(notebook!.id)).toMatchObject({
					title: "analysis.ipynb",
					metadata: {
						objectType: FILE_OBJECT_TYPE,
						objectId: "/work/analysis.ipynb",
						notebookPath: "/work/analysis.ipynb",
						notebookId: NOTEBOOK_ID,
						notebookOpenState: "ready",
					},
				}),
			WAIT,
		);
		expect(host.services.opened).toHaveBeenCalledExactlyOnceWith("/work/analysis.ipynb");
	});

	it("shows why a notebook file could not be opened", async () => {
		const host = await boot();
		host.services.setOpenFile(async () => {
			throw new KernelError("BUSINESS", "Could not open notebook: lock held");
		});

		const pane = await host.panes().methods.openObject({
			sessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/analysis.ipynb" },
		});

		await vi.waitFor(
			() =>
				expect(host.paneOf(pane!.id)?.metadata).toEqual({
					objectType: FILE_OBJECT_TYPE,
					objectId: "/work/analysis.ipynb",
					notebookPath: "/work/analysis.ipynb",
					notebookOpenState: "error",
					notebookOpenError: "Could not open notebook: lock held",
				}),
			WAIT,
		);
	});

	it("gives new Notebook panes a notebook of their own", async () => {
		const host = await boot();

		const pane = await host
			.panes()
			.methods.open({ sessionId: SESSION_ID, kind: NOTEBOOK_PANE_KIND });

		await vi.waitFor(() => expect(host.paneOf(pane.id)?.metadata.notebookId).toBe(NEW_ID), WAIT);
		expect(host.services.created).toHaveLength(0);
	});

	it("resolves a pane on request, and leaves panes that have a notebook alone", async () => {
		const host = await boot({
			panes: [
				notebookPane("pane_restored", {
					notebookPath: "/work/a.ipynb",
					notebookOpenState: "opening",
				}),
				notebookPane(NOTEBOOK_ID),
			],
		});

		await host.notebooks.methods.resolvePane({ sessionId: SESSION_ID, paneId: "pane_restored" });
		await host.notebooks.methods.resolvePane({ sessionId: SESSION_ID, paneId: NOTEBOOK_ID });

		expect(host.paneOf("pane_restored")?.metadata.notebookOpenState).toBe("ready");
		expect(host.paneOf(NOTEBOOK_ID)?.metadata).toEqual({});
		await expect(
			host.notebooks.methods.resolvePane({ sessionId: SESSION_ID, paneId: "pane_missing" }),
		).rejects.toThrow("Notebook pane not found.");
	});

	it("starts the runtime as a kernel service on first use and reports its status", async () => {
		const host = await boot();

		await expect(host.notebooks.methods.status(undefined)).resolves.toMatchObject({
			availability: { status: "available" },
		});
		expect(host.services.started).toHaveBeenCalled();
		expect(host.services.options()).toMatchObject({
			socketPath: "/tmp/runtimed.sock",
			runtimedBinaryPath: "/resources/runtimed/runtimed-nightly",
		});
		expect(
			host.main.kernelSdk.domains.get(KernelServices)!.getState().services[RUNTIMED_SERVICE_KEY],
		).toMatchObject({ status: "ready" });
	});

	it("reports a runtime that fails to start, in Diagnostics and to the pane", async () => {
		const host = await boot();
		host.services.setDaemon({
			status: "failed",
			reason: "The bundled runtimed daemon is unavailable.",
		});

		await expect(host.notebooks.methods.status(undefined)).resolves.toMatchObject({
			availability: {
				status: "unavailable",
				reason: "The bundled runtimed daemon is unavailable.",
			},
		});
		expect(
			host.main.kernelSdk.domains.get(KernelServices)!.getState().services[RUNTIMED_SERVICE_KEY]
				?.status,
		).toBe("failed");
	});

	it("releases the runtime when its service stops, and starts a new one on next use", async () => {
		const host = await boot();
		await host.notebooks.methods.status(undefined);

		await host.main.kernelSdk.domains
			.get(KernelServices)!
			.methods.restart({ key: RUNTIMED_SERVICE_KEY });
		await host.notebooks.methods.status(undefined);

		expect(host.services.disposed).toHaveBeenCalled();
		expect(host.services.created.length).toBeGreaterThanOrEqual(2);
	});

	it("starts the runtime once the app is ready, unless deferred", async () => {
		const warm = await boot({ entry: { warmStart: true } });
		await warm.main.windowShown();
		await vi.waitFor(() => expect(warm.services.started).toHaveBeenCalled(), WAIT);

		vi.stubEnv("KILO_NOTEBOOK_DEFER_RUNTIMED", "1");
		const deferred = await boot({
			entry: { warmStart: undefined } as unknown as Partial<NotebookMainOptions>,
		});
		await deferred.main.windowShown();
		await deferred.main.flush();
		expect(deferred.services.started).not.toHaveBeenCalled();
	});

	it("saves notebooks and tracks unsaved ones", async () => {
		const host = await boot();
		await host.notebooks.methods.status(undefined);
		const { platform, onNotebookDisconnected } = host.services.options();

		platform.events.emit("dirty-changed", {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			dirty: true,
		});
		expect(host.notebooks.getState().dirty).toEqual({ [NOTEBOOK_ID]: true });
		platform.events.emit("dirty-changed", {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			dirty: true,
		});
		host.services.setSaveResult({ outcome: "failed", reason: "Disk full." });
		await expect(host.notebooks.methods.save({ notebookId: NOTEBOOK_ID })).resolves.toEqual({
			outcome: "failed",
			reason: "Disk full.",
		});
		onNotebookDisconnected?.(NOTEBOOK_ID);
		expect(host.notebooks.getState().dirty).toEqual({});
	});

	it("titles a pane after the notebook it shows", async () => {
		const host = await boot({ panes: [notebookPane("pane_a", { notebookId: NOTEBOOK_ID })] });
		await host.notebooks.methods.status(undefined);

		host.services.options().platform.events.emit("title-changed", {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			title: "renamed.ipynb",
		});
		host.services.options().platform.events.emit("title-changed", {
			notebookId: "00000000-0000-4000-8000-000000000000",
			sessionId: SESSION_ID,
			title: "elsewhere.ipynb",
		});

		await vi.waitFor(() => expect(host.paneOf("pane_a")?.title).toBe("renamed.ipynb"), WAIT);
	});

	it("keeps settings in kv and its state, and takes origin's over once", async () => {
		const originDir = await mkdtemp(path.join(os.tmpdir(), "notebook-origin-"));
		temporaryDirectories.push(originDir);
		await writeFile(
			path.join(originDir, "settings.json"),
			JSON.stringify({ autoCreateEnvironmentFile: false, trustNewNotebooks: true }),
		);
		await writeFile(
			path.join(originDir, "notebook-state.json"),
			JSON.stringify({ createdNotebookIds: [NOTEBOOK_ID], preparedNotebookIds: [] }),
		);
		const host = await boot({ entry: { originStorageDir: () => originDir } });

		await vi.waitFor(
			() =>
				expect(host.notebooks.getState().settings).toEqual({
					autoCreateEnvironmentFile: false,
					trustNewNotebooks: true,
				}),
			WAIT,
		);
		await expect(
			host.notebooks.methods.updateSettings({ trustNewNotebooks: false }),
		).resolves.toEqual({ autoCreateEnvironmentFile: false, trustNewNotebooks: false });
		expect(host.storage.saved.get("settings")).toMatchObject({ trustNewNotebooks: false });
		expect(host.storage.saved.get("notebook-state")).toMatchObject({
			createdNotebookIds: [NOTEBOOK_ID],
			importedFromOrigin: true,
		});
	});

	it("skips a missing origin folder and retries one it can't read next launch", async () => {
		const missing = await boot({ entry: { originStorageDir: () => "/no/such/origin" } });
		await vi.waitFor(
			() =>
				expect(missing.storage.saved.get("notebook-state")).toMatchObject({
					importedFromOrigin: true,
				}),
			WAIT,
		);

		const originDir = await mkdtemp(path.join(os.tmpdir(), "notebook-origin-"));
		temporaryDirectories.push(originDir);
		await mkdir(path.join(originDir, "settings.json"));
		const broken = await boot({ entry: { originStorageDir: () => originDir } });
		await broken.main.flush();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(broken.storage.saved.get("notebook-state")?.importedFromOrigin).not.toBe(true);
	});

	it("prepares a new notebook's environment once", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "notebook-workspace-"));
		temporaryDirectories.push(workspace);
		const host = await boot({ entry: { homeDirectory: os.tmpdir() } });

		const first = await host.notebooks.methods.prepareEnvironment({
			notebookId: NOTEBOOK_ID,
			workingDirectory: workspace,
		});
		const again = await host.notebooks.methods.prepareEnvironment({
			notebookId: NOTEBOOK_ID,
			workingDirectory: workspace,
		});

		expect(first).toMatchObject({ outcome: "created" });
		expect(again).toMatchObject({ outcome: "existing" });
	});

	it("gives the Kilo server the notebook tool plugin and where the runtime is", async () => {
		const host = await boot();
		const source = host.main.kernelSdk.extensions
			.list(RuntimeConfigPoint)
			.find((contribution) => contribution.pluginId === "kilo.notebook")!
			.implementation as RuntimeConfigSource;

		expect(source.read()).toEqual({
			kiloPlugins: { notebooks: "/resources/kilo-plugin/index.js" },
			env: {
				NTERACT_RUNTIMED_NODE_PATH: "/app.asar.unpacked/node_modules/@runtimed/node/index.cjs",
				RUNTIMED_SOCKET_PATH: "/tmp/runtimed.sock",
			},
		});

		const bare = await boot({ entry: { resolveKiloPluginEntry: () => undefined } });
		const bareSource = bare.main.kernelSdk.extensions
			.list(RuntimeConfigPoint)
			.find((contribution) => contribution.pluginId === "kilo.notebook")!
			.implementation as RuntimeConfigSource;
		expect(bareSource.read()).toEqual({});
	});

	it("serves the notebook UI on its embedded host, outputs confined", async () => {
		const host = await boot();

		expect(host.embedded).toEqual([
			{
				host: "notebook",
				root: "/resources/notebook",
				securityProfiles: { "/output-frame.html": "active-untrusted-content" },
				permissions: ["clipboard-sanitized-write"],
			},
		]);
		const without = await boot({ withoutEmbeddedHosts: true });
		expect(without.embedded).toEqual([]);
	});

	it("connects a pane's frame to its notebook over the host port", async () => {
		const host = await boot();
		const frameEnd = host.renderer.sdkFor("kilo.notebook").ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			title: "Notebook",
			workingDirectory: "/work",
		});
		const received: unknown[] = [];
		frameEnd.onmessage = (event) => received.push(event.data);

		await vi.waitFor(() => expect(host.services.connections).toHaveLength(1), WAIT);
		const [connection] = host.services.connections;
		expect(connection).toMatchObject({
			args: {
				notebookId: NOTEBOOK_ID,
				sessionId: SESSION_ID,
				title: "Notebook",
				workingDirectory: "/work",
			},
			windowId: "main",
		});
		expect(host.services.defaultSaveDirectories.get(NOTEBOOK_ID)).toBe("/work");

		const listener = vi.fn();
		connection!.port.on("message", listener);
		connection!.port.on("message", listener);
		connection!.port.start();
		frameEnd.postMessage("from frame");
		connection!.port.postMessage("to frame");
		await vi.waitFor(
			() => expect(listener).toHaveBeenCalledExactlyOnceWith({ data: "from frame" }),
			WAIT,
		);
		await vi.waitFor(() => expect(received).toEqual(["to frame"]), WAIT);
		connection!.port.off("message", listener);
		const closed = vi.fn();
		connection!.port.on("close", closed);
		connection!.port.close();
		expect(closed).toHaveBeenCalled();
		frameEnd.close();
	});

	it("refuses a frame connection with bad arguments", async () => {
		const host = await boot();
		const sdk = host.renderer.sdkFor("kilo.notebook");

		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: "not-a-uuid",
			sessionId: SESSION_ID,
			title: "x",
		});
		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			title: "x",
			notebookPath: "/work/notes.txt",
		});
		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			title: "x",
			workingDirectory: "relative",
		});
		await host.main.flush();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(host.services.connections).toEqual([]);
	});

	it("lets the notebook UI use the app's dialogs, links and window focus", async () => {
		const host = await boot();
		const dialogs = {
			open: vi.fn((_input: unknown) => ({ paths: ["/work/data.csv"] })),
			save: vi.fn((_input: unknown) => ({ path: "/work/out.ipynb" })),
			message: vi.fn(() => ({ response: 0 })),
		};
		const openExternal = vi.fn(() => true);
		host.main.kernelSdk.domains.provide(KernelDialogs, {
			initialState: {},
			methods: dialogs as never,
		});
		host.main.kernelSdk.domains.provide(KernelShell, {
			initialState: {},
			methods: { openExternal } as never,
		});
		await host.notebooks.methods.status(undefined);
		const platform = host.services.options().platform.host!;
		const filters = [{ name: "Notebooks", extensions: ["ipynb"] }];

		await expect(platform.dialog.openFile("main", { defaultPath: "/work", filters })).resolves.toBe(
			"/work/data.csv",
		);
		await expect(platform.dialog.saveFile("main", { defaultPath: "/work", filters })).resolves.toBe(
			"/work/out.ipynb",
		);
		expect(dialogs.save.mock.calls[0]?.[0]).toEqual({ defaultPath: "/work", filters });
		await expect(platform.externalLinks.open("https://nteract.io")).resolves.toBe(true);
		await expect(platform.externalLinks.open("file:///etc/passwd")).resolves.toBe(false);
		await expect(platform.externalLinks.open("not a url")).resolves.toBe(false);
		expect(openExternal).toHaveBeenCalledOnce();
		expect(platform.paths.defaultSaveDirectory()).toEqual(expect.any(String));

		const focus = vi.fn();
		const stop = platform.window.onFocusChange("main", focus);
		host.main.windowEvents.opened("main", { role: "main" });
		host.main.windowEvents.focused("main");
		host.main.windowEvents.blurred("other");
		host.main.windowEvents.blurred("main");
		await host.main.flush();
		expect(focus.mock.calls).toEqual([[true], [false]]);
		expect(platform.window.isFocused("main")).toBe(false);
		expect(platform.window.isFocused("unknown")).toBe(true);
		stop();
	});

	it("has no dialogs or links without the host's primitives", async () => {
		const host = await boot();
		await host.notebooks.methods.status(undefined);
		const platform = host.services.options().platform.host!;

		await expect(platform.dialog.openFile("main")).resolves.toBeNull();
		await expect(platform.dialog.saveFile("main")).resolves.toBeNull();
		await expect(platform.externalLinks.open("https://nteract.io")).resolves.toBe(false);
	});

	it("trusts notebooks created here while the setting is on", async () => {
		const openTrustSession = vi.fn(() => new Promise<never>(() => undefined));
		const host = await boot({ entry: { openTrustSession } });
		await host.notebooks.methods.updateSettings({ trustNewNotebooks: true });
		await host.notebooks.methods.status(undefined);
		const { onNotebookConnected, onNotebookDisconnected } = host.services.options();

		onNotebookConnected?.({ notebookId: NOTEBOOK_ID, untitled: true });
		onNotebookConnected?.({ notebookId: NEW_ID, untitled: false });

		await vi.waitFor(
			() =>
				expect(openTrustSession).toHaveBeenCalledExactlyOnceWith(NOTEBOOK_ID, "/tmp/runtimed.sock"),
			WAIT,
		);
		onNotebookDisconnected?.(NOTEBOOK_ID);
	});

	it("grants the runtime telemetry only with consent, the flag and an open notebook", async () => {
		const registration = {
			updatePermission: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const openTelemetryRegistration = vi.fn<OpenTelemetryRegistration>(
			async (_options) => registration,
		);
		const host = await boot({
			entry: { openTelemetryRegistration },
			allowed: true,
			flags: { "notebook-host-telemetry": true },
		});
		await host.notebooks.methods.status(undefined);

		host.services.options().onNotebookConnected?.({ notebookId: NOTEBOOK_ID, untitled: false });

		await vi.waitFor(() => expect(openTelemetryRegistration).toHaveBeenCalled(), WAIT);
		expect(openTelemetryRegistration.mock.lastCall?.[0]).toMatchObject({
			socketPath: "/tmp/runtimed.sock",
		});
	});

	describe("agent tools", () => {
		it("lists the calling session's notebooks", async () => {
			const host = await boot({
				panes: [
					notebookPane("pane_a", { notebookId: NOTEBOOK_ID }),
					notebookPane("pane_b", { notebookOpenState: "opening", notebookPath: "/w/b.ipynb" }),
				],
			});
			await host.panes().methods.activate({ sessionId: SESSION_ID, paneId: "pane_a" });

			await expect(host.callTool("list_open")).resolves.toEqual({
				sessionId: SESSION_ID,
				notebooks: [{ notebook_id: NOTEBOOK_ID, title: "Notebook", active: true }],
			});
			await expect(host.callTool("list_open", {}, "wses_other")).resolves.toEqual({
				sessionId: "wses_other",
				notebooks: [],
			});
		});

		it("opens a new notebook in the calling session", async () => {
			const host = await boot();

			await expect(host.callTool("open")).resolves.toEqual({
				sessionId: SESSION_ID,
				notebook_id: NEW_ID,
				title: "Notebook",
			});
			expect(host.sessions.panes().panes.map((pane) => pane.kind)).toEqual([NOTEBOOK_PANE_KIND]);
		});

		it("opens a notebook file, reusing the pane already showing it", async () => {
			const host = await boot();

			const first = await host.callTool("open_file", { path: "/work/analysis.ipynb" });
			const again = await host.callTool("open_file", { path: "/work/analysis.ipynb" });

			expect(first).toEqual({
				sessionId: SESSION_ID,
				notebook_id: NOTEBOOK_ID,
				title: "analysis.ipynb",
				path: "/work/analysis.ipynb",
			});
			expect(again).toEqual(first);
			expect(host.sessions.panes().panes).toHaveLength(1);
			expect(host.services.opened).toHaveBeenCalledOnce();
		});

		it("reopens a file whose pane failed to open it", async () => {
			const host = await boot({
				panes: [
					notebookPane("pane_a", {
						notebookPath: "/work/analysis.ipynb",
						notebookOpenState: "error",
						notebookOpenError: "lock held",
					}),
				],
			});

			await expect(
				host.callTool("open_file", { path: "/work/analysis.ipynb" }),
			).resolves.toMatchObject({
				notebook_id: NOTEBOOK_ID,
			});
			expect(host.paneOf("pane_a")?.metadata.notebookOpenState).toBe("ready");
		});

		it("refuses callers without a session, relative paths, and files it can't open", async () => {
			const host = await boot();
			host.services.setOpenFile(async () => {
				throw new Error("broken");
			});

			await expect(host.callTool("list_open", {}, null)).rejects.toThrow(
				"require an originating Kilo chat session",
			);
			await expect(host.callTool("open", {}, null)).rejects.toThrow(
				"originating Kilo chat session",
			);
			await expect(host.callTool("open_file", { path: "analysis.ipynb" })).rejects.toThrow(
				"must be absolute",
			);
			await expect(host.callTool("open_file", { path: "/work/analysis.ipynb" })).rejects.toThrow(
				"broken",
			);
			await expect(host.callTool("open_file", { path: "/work/data.csv" })).rejects.toThrow(
				"can't be opened in a pane",
			);
		});

		it("is unavailable without kilo.sessions", async () => {
			const host = await boot({ withoutSessions: true });

			await expect(host.callTool("list_open")).rejects.toThrow("Panes are unavailable");
			await expect(host.callTool("open")).rejects.toThrow("Panes are unavailable");
			await expect(host.callTool("open_file", { path: "/w/a.ipynb" })).rejects.toThrow(
				"Panes are unavailable",
			);
			await expect(
				host.notebooks.methods.resolvePane({ sessionId: SESSION_ID, paneId: "pane_a" }),
			).rejects.toThrow("Panes are unavailable");
		});

		it("declares origin's tool names, sign-in prompt, and Kilo-only use", async () => {
			const host = await boot();
			const metadata = host.tool("open_file").metadata;

			expect(metadata).toMatchObject({
				requiresSignIn: true,
				external: false,
				signInPrompt: { title: "Sign in to use embedded notebooks?" },
			});
			expect(host.tool("list_open").metadata.readOnly).toBe(true);
			expect(
				["list_open", "open", "open_file"].map((id) => toolWireName(host.tool(id).key)),
			).toEqual([
				"desktop_notebook_list_open",
				"desktop_notebook_open",
				"desktop_notebook_open_file",
			]);
		});
	});
});
