import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	KernelDialogs,
	KernelError,
	KernelOs,
	KernelServices,
	type KernelLogger,
} from "@kilo-desktop/kernel";
import {
	AgentExtension,
	ServerEnv,
	Tool,
	type ServerEnvSource,
} from "@kilo-desktop/plugin-core/contracts";

import {
	FILE_OBJECT_TYPE,
	NOTEBOOK_HOST_PORT,
	NOTEBOOK_PANE_KIND,
	NOTEBOOK_TELEMETRY_FLAG,
	RUNTIMED_SERVICE_KEY,
} from "../contracts/index.js";
import { findRuntimedArtifact } from "../packaging/artifacts.js";
import { NOTEBOOK_ID } from "../test/fake-host-service.js";
import { notebookPane, SESSION_ID } from "../test/sessions-host.js";
import type { NotebookMainOptions } from "./entry.js";
import { resolveDaemonSocketPath } from "./runtime/socket-path.js";
import type { OpenTelemetryRegistration } from "./runtime/NotebookTelemetryPermission.js";
import {
	bootNotebookMain as boot,
	NEW_ID,
	recordingLogger,
	removeLater,
	RUNTIMED_NODE_ENTRY,
	SOCKET_PATH,
	stopNotebookMains,
} from "./test-boot.js";

const WAIT = { timeout: 5_000 };

afterEach(async () => {
	vi.unstubAllEnvs();
	await stopNotebookMains();
});

const tempDir = async (prefix: string) =>
	removeLater(await mkdtemp(path.join(os.tmpdir(), prefix)));

const serverEnvOf = (host: Awaited<ReturnType<typeof boot>>) =>
	host.main.kernelSdk.extensions
		.list(ServerEnv)
		.find((contribution) => contribution.pluginId === "kilo.notebook")?.implementation as
		| ServerEnvSource
		| undefined;

/** The kernel reports kilo.notebook's manifest contributions to absent plugins; the entry says nothing. */
const ownMessages = (messages: unknown[][]) =>
	messages.filter(([message]) => !String(message).startsWith("[kilo.notebook] Contribution"));

describe("kilo.notebook in main", () => {
	it("uses the stable singleton for the pinned notebook release", async () => {
		vi.stubEnv("RUNTIMED_SOCKET_PATH", "");
		const host = await boot({ useDefaultSocket: true });
		await host.notebooks.methods.status(undefined);
		expect(host.services.options()).toMatchObject({
			runtimeChannel: "stable",
		});
		const source = serverEnvOf(host)!;
		expect(source.read()["RUNTIMED_SOCKET_PATH"]).toBe(
			resolveDaemonSocketPath({ channel: "stable" }),
		);
	});

	it("opens workspace notebooks in a Notebook pane, ahead of Files", async () => {
		const host = await boot();

		const notebook = await host.panes().methods.openObject({
			workSessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/analysis.ipynb" },
		});
		const script = await host.panes().methods.openObject({
			workSessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/app.py" },
		});

		expect(notebook?.kind).toBe(NOTEBOOK_PANE_KIND);
		expect(script?.kind).toBe("kilo.files/files");
		await vi.waitFor(
			() =>
				expect(host.paneOf(notebook!.id)).toMatchObject({
					title: "analysis.ipynb",
					object: { type: FILE_OBJECT_TYPE, id: "/work/analysis.ipynb" },
					metadata: {
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
			workSessionId: SESSION_ID,
			ref: { type: FILE_OBJECT_TYPE, id: "/work/analysis.ipynb" },
		});

		await vi.waitFor(
			() =>
				expect(host.paneOf(pane!.id)?.metadata).toEqual({
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
			.methods.open({ workSessionId: SESSION_ID, kind: NOTEBOOK_PANE_KIND });

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

		await host.notebooks.methods.resolvePane({
			workSessionId: SESSION_ID,
			paneId: "pane_restored",
		});
		await host.notebooks.methods.resolvePane({ workSessionId: SESSION_ID, paneId: NOTEBOOK_ID });

		expect(host.paneOf("pane_restored")?.metadata.notebookOpenState).toBe("ready");
		expect(host.paneOf(NOTEBOOK_ID)?.metadata).toEqual({});
		await expect(
			host.notebooks.methods.resolvePane({ workSessionId: SESSION_ID, paneId: "pane_missing" }),
		).rejects.toThrow("Notebook pane not found.");
	});

	it("starts the runtime as a kernel service on first use and reports its status", async () => {
		const host = await boot();

		await expect(host.notebooks.methods.status(undefined)).resolves.toMatchObject({
			availability: { status: "available" },
		});
		expect(host.services.started).toHaveBeenCalled();
		expect(host.services.options()).toMatchObject({
			socketPath: SOCKET_PATH,
			runtimedBinaryPath: "/resources/runtimed/runtimed-nightly",
		});
		expect(
			host.main.kernelSdk.domainObjects.get(KernelServices)!.getState().services[
				RUNTIMED_SERVICE_KEY
			],
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
			host.main.kernelSdk.domainObjects.get(KernelServices)!.getState().services[
				RUNTIMED_SERVICE_KEY
			]?.status,
		).toBe("failed");
	});

	it("releases the runtime when its service stops, and starts a new one on next use", async () => {
		const host = await boot();
		await host.notebooks.methods.status(undefined);

		await host.main.kernelSdk.domainObjects
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
			workSessionId: SESSION_ID,
			dirty: true,
		});
		expect(host.notebooks.getState().dirty).toEqual({ [NOTEBOOK_ID]: true });
		platform.events.emit("dirty-changed", {
			notebookId: NOTEBOOK_ID,
			workSessionId: SESSION_ID,
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
			workSessionId: SESSION_ID,
			title: "renamed.ipynb",
		});
		host.services.options().platform.events.emit("title-changed", {
			notebookId: "00000000-0000-4000-8000-000000000000",
			workSessionId: SESSION_ID,
			title: "elsewhere.ipynb",
		});

		await vi.waitFor(() => expect(host.paneOf("pane_a")?.title).toBe("renamed.ipynb"), WAIT);
	});

	it("keeps settings in kv and its state, and takes origin's over once", async () => {
		const originDir = await tempDir("notebook-origin-");
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

		const originDir = await tempDir("notebook-origin-");
		await mkdir(path.join(originDir, "settings.json"));
		const { logger, warnings } = recordingLogger();
		const broken = await boot({ entry: { originStorageDir: () => originDir }, logger });
		await vi.waitFor(
			() =>
				expect(warnings.flat().join("\n")).toContain(
					`Could not import notebook settings from ${originDir}`,
				),
			WAIT,
		);
		expect(broken.storage.saved.get("notebook-state")?.importedFromOrigin).not.toBe(true);
	});

	it("prepares a new notebook's environment once", async () => {
		const workspace = await tempDir("notebook-workspace-");
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

		expect(
			host.main.kernelSdk.extensions
				.list(AgentExtension)
				.find((contribution) => contribution.pluginId === "kilo.notebook")?.metadata,
		).toMatchObject({ type: "kilo-plugin" });
		expect(serverEnvOf(host)?.read()).toEqual({
			NTERACT_RUNTIMED_NODE_PATH: RUNTIMED_NODE_ENTRY,
			RUNTIMED_SOCKET_PATH: SOCKET_PATH,
		});
	});

	it("gives the Kilo server no environment, and says so, without the runtimed node entry", async () => {
		const { logger, warnings } = recordingLogger();
		const bare = await boot({ entry: { resolveRuntimedNodeEntry: () => undefined }, logger });

		expect(serverEnvOf(bare)?.read()).toEqual({});
		expect(warnings.flat().join("\n")).toContain("@runtimed/node entry is unavailable");
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

	it("finds the runtime and the notebook UI among the files it ships", async () => {
		const artifact = findRuntimedArtifact();
		const resources = await tempDir("notebook-assets-");
		await mkdir(path.join(resources, "resources/notebook"), { recursive: true });
		await writeFile(path.join(resources, "resources/notebook/index.html"), "");
		if (artifact) {
			await mkdir(path.join(resources, "resources/runtimed", artifact.target), { recursive: true });
			await writeFile(
				path.join(resources, "resources/runtimed", artifact.target, artifact.executable),
				"",
			);
		}
		const defaults = {
			resolveRuntimedBinary: undefined,
			resolveBundleRoot: undefined,
		} as unknown as Partial<NotebookMainOptions>;
		const host = await boot({
			entry: defaults,
			assets: { resolve: (subpath) => path.join(resources, subpath) },
		});
		await host.notebooks.methods.status(undefined);

		expect(host.embedded[0]?.root).toBe(path.join(resources, "resources/notebook"));
		expect(host.services.options().runtimedBinaryPath).toBe(
			artifact
				? path.join(resources, "resources/runtimed", artifact.target, artifact.executable)
				: undefined,
		);

		const empty = await boot({ entry: defaults, assets: { resolve: () => "/no/such/file" } });
		const broken = await boot({
			entry: defaults,
			assets: {
				resolve: () => {
					throw new Error("no assets");
				},
			},
		});
		expect([empty.embedded[0]?.root, broken.embedded[0]?.root]).toEqual([undefined, undefined]);
	});

	it("connects a pane's frame to its notebook over the host port", async () => {
		const host = await boot();
		const frameEnd = host.renderer.sdkFor("kilo.notebook").ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			workSessionId: SESSION_ID,
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
				workSessionId: SESSION_ID,
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
		const { logger, warnings } = recordingLogger();
		const host = await boot({ logger });
		const sdk = host.renderer.sdkFor("kilo.notebook");

		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: "not-a-uuid",
			workSessionId: SESSION_ID,
			title: "x",
		});
		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			workSessionId: SESSION_ID,
			title: "x",
			notebookPath: "/work/notes.txt",
		});
		sdk.ports.open(NOTEBOOK_HOST_PORT, {
			notebookId: NOTEBOOK_ID,
			workSessionId: SESSION_ID,
			title: "x",
			workingDirectory: "relative",
		});
		await host.main.flush();
		await vi.waitFor(
			() =>
				expect(
					warnings.filter(([message]) =>
						String(message).includes("Refused a notebook connection with invalid arguments."),
					),
				).toHaveLength(3),
			WAIT,
		);

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
		host.main.kernelSdk.domainObjects.provide(KernelDialogs, {
			initialState: {},
			methods: dialogs as never,
		});
		host.main.kernelSdk.domainObjects.provide(KernelOs, {
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
			() => expect(openTrustSession).toHaveBeenCalledExactlyOnceWith(NOTEBOOK_ID, SOCKET_PATH),
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
			flags: { [NOTEBOOK_TELEMETRY_FLAG]: true },
		});
		await host.notebooks.methods.status(undefined);

		host.services.options().onNotebookConnected?.({ notebookId: NOTEBOOK_ID, untitled: false });

		await vi.waitFor(() => expect(openTelemetryRegistration).toHaveBeenCalled(), WAIT);
		expect(openTelemetryRegistration.mock.lastCall?.[0]).toMatchObject({
			socketPath: SOCKET_PATH,
		});
	});

	it("activates without kilo.work-sessions, kilo.core and kilo.shell, warning of nothing", async () => {
		const { logger, warnings, errors } = recordingLogger();
		const host = await boot({
			withoutWorkSessions: true,
			withoutCore: true,
			withoutShell: true,
			logger: logger satisfies KernelLogger,
		});

		expect(host.notebooks.getState().settings).toEqual({
			autoCreateEnvironmentFile: true,
			trustNewNotebooks: false,
		});
		expect(host.main.kernelSdk.extensions.list(Tool)).toEqual([]);
		expect(serverEnvOf(host)).toBeUndefined();
		await expect(host.notebooks.methods.status(undefined)).resolves.toMatchObject({
			availability: { status: "available" },
		});
		expect(ownMessages(warnings)).toEqual([]);
		expect(errors).toEqual([]);
	});

	describe("agent tools", () => {
		it("lists the calling work session's notebooks", async () => {
			const host = await boot({
				panes: [
					notebookPane("pane_a", { notebookId: NOTEBOOK_ID }),
					notebookPane("pane_b", { notebookOpenState: "opening", notebookPath: "/w/b.ipynb" }),
				],
			});
			await host.panes().methods.activate({ workSessionId: SESSION_ID, paneId: "pane_a" });

			await expect(host.callTool("list_open")).resolves.toEqual({
				workSessionId: SESSION_ID,
				notebooks: [{ notebook_id: NOTEBOOK_ID, title: "Notebook", active: true }],
			});
			await expect(host.callTool("list_open", {}, "wses_other")).resolves.toEqual({
				workSessionId: "wses_other",
				notebooks: [],
			});
		});

		it("opens a new notebook in the calling work session", async () => {
			const host = await boot();

			await expect(host.callTool("open")).resolves.toEqual({
				workSessionId: SESSION_ID,
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
				workSessionId: SESSION_ID,
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

		it("refuses callers without a work session, relative paths, and files it can't open", async () => {
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

		it("is unavailable without kilo.work-sessions", async () => {
			const host = await boot({ withoutWorkSessions: true });

			await expect(host.callTool("list_open")).rejects.toThrow("Panes are unavailable");
			await expect(host.callTool("open")).rejects.toThrow("Panes are unavailable");
			await expect(host.callTool("open_file", { path: "/w/a.ipynb" })).rejects.toThrow(
				"Panes are unavailable",
			);
			await expect(
				host.notebooks.methods.resolvePane({ workSessionId: SESSION_ID, paneId: "pane_a" }),
			).rejects.toThrow("Panes are unavailable");
		});

		it("asks the user to sign in, and marks list_open read-only", async () => {
			const host = await boot();

			expect(host.tool("open_file").metadata).toMatchObject({
				signInPrompt: { title: "Sign in to use embedded notebooks?" },
			});
			expect(host.tool("list_open").metadata.readOnly).toBe(true);
		});
	});
});
