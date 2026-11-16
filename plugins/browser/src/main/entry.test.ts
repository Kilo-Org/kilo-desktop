import { describe, expect, it } from "vitest";

import type { KernelLogger, PluginRegistration } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import { Panes, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	BROWSER_DEFINITIONS,
	BROWSER_PANE_KIND,
	BrowserPages,
	FILE_OBJECT_TYPE,
	localFileUrl,
	pageKey,
	URL_OBJECT_TYPE,
} from "../contracts/index.js";
import { createFakeBrowserHost } from "../test/fake-browser-host.js";
import {
	browserPane,
	coreRegistration,
	createSessionsHost,
	filesOpener,
	SESSION_ID,
	type Authorize,
} from "../test/sessions-host.js";
import { createBrowserMainEntry } from "./entry.js";

interface BootOptions {
	readonly panes?: readonly Pane[];
	readonly withoutHost?: boolean;
	readonly withoutWorkspaces?: boolean;
	readonly withoutSessions?: boolean;
	readonly withoutCore?: boolean;
	readonly authorize?: Authorize;
	readonly logger?: KernelLogger;
}

async function boot(options: BootOptions = {}) {
	const fake = createFakeBrowserHost();
	const sessions = createSessionsHost({
		panes: options.panes ?? [browserPane("pane_a")],
		...(options.withoutWorkspaces ? {} : { authorize: options.authorize ?? (() => true) }),
	});
	const registrations: PluginRegistration[] = [
		...(options.withoutCore ? [] : [coreRegistration]),
		...(options.withoutSessions ? [] : [sessions.registration, filesOpener]),
		{
			manifest,
			definitions: BROWSER_DEFINITIONS,
			entry: createBrowserMainEntry({
				host: () => (options.withoutHost ? undefined : fake.host),
				windows: false,
			}),
		},
	];
	const { main } = await createTestKernelPair({
		main: registrations,
		renderer: [],
		...(options.logger ? { logger: options.logger } : {}),
	});
	const pages = main.kernelSdk.domainObjects.get(BrowserPages)!;
	const panes = () => main.kernelSdk.domainObjects.get(Panes)!;
	const tool = main.kernelSdk.extensions
		.list(Tool)
		.find((contribution) => contribution.key === "kilo.browser/open")!;
	const callTool = (input: unknown, workSessionId: string | null = SESSION_ID) => {
		const context: ToolCallContext = {
			workSessionId,
			workspaceId: null,
			chatId: workSessionId ? "chat" : null,
			callId: "call_1",
			external: workSessionId === null,
			signal: new AbortController().signal,
		};
		return Promise.resolve(
			tool.implementation!.run(tool.implementation!.input.parse(input), context),
		);
	};
	const settle = () => main.flush();
	const paneOf = (paneId: string) => sessions.panes().panes.find((pane) => pane.id === paneId);
	return { main, fake, sessions, pages, panes, callTool, settle, paneOf };
}

const target = { workSessionId: SESSION_ID, paneId: "pane_a" };

describe("kilo.browser in main", () => {
	it("prepares the guests' partition and answers local files from kilo.work-sessions' workspaces", async () => {
		const asked: unknown[] = [];
		const { fake, pages } = await boot({
			authorize: (input) => {
				asked.push(input);
				return input.path.startsWith("/work/");
			},
		});

		expect(await pages.methods.prepare(undefined)).toEqual({ partition: "persist:test-browser" });
		expect(fake.host.initialize).toHaveBeenCalledOnce();
		expect(await fake.authorize("/work/app/index.html")).toBe(true);
		expect(await fake.authorize("/etc/secret.html")).toBe(false);
		expect(asked[0]).toEqual({ path: "/work/app/index.html", rule: "inside" });
	});

	it("serves no local files without kilo.work-sessions' workspaces, or when they fail", async () => {
		const absent = await boot({ withoutWorkspaces: true });
		expect(await absent.fake.authorize("/work/index.html")).toBe(false);

		const failing = await boot({
			authorize: () => {
				throw new Error("broken");
			},
		});
		expect(await failing.fake.authorize("/work/index.html")).toBe(false);
	});

	it("is unavailable without the host's browser", async () => {
		const { pages } = await boot({ withoutHost: true });

		await expect(pages.methods.prepare(undefined)).rejects.toThrow("isn't available here");
		await expect(pages.methods.attach({ ...target, webContentsId: 1 })).rejects.toThrow(
			"isn't available here",
		);
	});

	it("activates without kilo.work-sessions, kilo.core and the host's browser, saying nothing", async () => {
		const warnings: unknown[][] = [];
		const errors: unknown[][] = [];
		const logger: KernelLogger = {
			debug: () => {},
			info: () => {},
			warn: (...args) => void warnings.push(args),
			error: (...args) => void errors.push(args),
		};
		const { main } = await createTestKernelPair({
			main: [{ manifest, definitions: BROWSER_DEFINITIONS, entry: createBrowserMainEntry() }],
			renderer: [],
			logger,
		});
		await main.flush();

		const pages = main.kernelSdk.domainObjects.get(BrowserPages)!;
		await expect(pages.methods.prepare(undefined)).rejects.toThrow("isn't available here");
		expect(main.kernelSdk.extensions.list(Tool)).toEqual([]);
		// The kernel reports kilo.browser's manifest contributions to absent plugins; the entry says nothing.
		const own = warnings.filter(
			([message]) => !String(message).startsWith("[kilo.browser] Contribution"),
		);
		expect(own).toEqual([]);
		expect(errors).toEqual([]);
	});

	it("attaches a pane's guest, publishes its page and drives it", async () => {
		const { fake, pages, settle } = await boot();

		const page = await pages.methods.attach({ ...target, webContentsId: 42 });
		expect(page).toMatchObject({ ...target, webContentsId: 42, url: "", zoomFactor: 1 });
		await settle();
		expect(pages.getState().pages[pageKey(SESSION_ID, "pane_a")]).toEqual(page);

		await pages.methods.navigate({ ...target, url: "localhost:5173" });
		await pages.methods.command({ ...target, command: "back" });
		await pages.methods.command({ ...target, command: "zoomIn" });
		await pages.methods.command({ ...target, command: "openDevTools" });
		const { controller } = fake.guest(42);
		expect(controller.navigate).toHaveBeenCalledWith("http://localhost:5173/");
		expect(controller.goBack).toHaveBeenCalledOnce();
		expect(controller.zoomIn).toHaveBeenCalledOnce();
		expect(controller.openDevTools).toHaveBeenCalledOnce();

		fake.guest(42).emit({ loading: true, zoomFactor: 1.1 });
		await settle();
		expect(pages.getState().pages[pageKey(SESSION_ID, "pane_a")]).toMatchObject({
			loading: true,
			zoomFactor: 1.1,
		});
	});

	it("refuses unsupported URLs and commands for a pane without a guest", async () => {
		const { pages } = await boot();
		await pages.methods.attach({ ...target, webContentsId: 42 });

		await expect(pages.methods.navigate({ ...target, url: "file:///etc/passwd" })).rejects.toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		await expect(
			pages.methods.command({ workSessionId: SESSION_ID, paneId: "pane_b", command: "reload" }),
		).rejects.toThrow("Browser tab is not ready.");
	});

	it("reports a guest the host refuses", async () => {
		const { fake, pages } = await boot();
		fake.refuseAttach("Browser guest is not attached to a trusted application window.");

		await expect(pages.methods.attach({ ...target, webContentsId: 7 })).rejects.toThrow(
			"trusted application window",
		);
	});

	it("keeps one guest per pane and ignores a stale detach", async () => {
		const { fake, pages, settle } = await boot();
		await pages.methods.attach({ ...target, webContentsId: 42 });
		await pages.methods.attach({ ...target, webContentsId: 84 });

		expect(fake.guest(42).controller.dispose).toHaveBeenCalledOnce();
		fake.guest(42).emit({ url: "https://stale.example/" });
		await pages.methods.detach({ ...target, webContentsId: 42 });
		await settle();
		expect(pages.getState().pages[pageKey(SESSION_ID, "pane_a")]).toMatchObject({
			webContentsId: 84,
			url: "",
		});
		expect(fake.guest(84).controller.dispose).not.toHaveBeenCalled();

		await pages.methods.detach({ ...target, webContentsId: 84 });
		await settle();
		expect(fake.guest(84).controller.dispose).toHaveBeenCalledOnce();
		expect(pages.getState().pages).toEqual({});
	});

	it("titles its pane after the page and records the page it shows", async () => {
		const { fake, pages, sessions, settle, paneOf } = await boot();
		await pages.methods.attach({ ...target, webContentsId: 42 });
		await settle();
		expect(sessions.updates).toEqual([]);

		fake.guest(42).emit({
			url: "https://example.com/docs",
			title: " Docs ",
			faviconUrl: "data:image/png;base64,AA==",
		});
		await settle();
		expect(paneOf("pane_a")).toMatchObject({
			title: "Docs",
			iconKey: "data:image/png;base64,AA==",
			object: { type: URL_OBJECT_TYPE, id: "https://example.com/docs" },
			metadata: { url: "https://example.com/docs" },
		});

		const before = sessions.updates.length;
		fake.guest(42).emit({ loading: true });
		await settle();
		expect(sessions.updates).toHaveLength(before);

		fake.guest(42).emit({ url: localFileUrl("/work/Chart one.html"), title: "", faviconUrl: "" });
		await settle();
		expect(paneOf("pane_a")).toMatchObject({
			title: "Docs",
			iconKey: "globe",
			object: { type: FILE_OBJECT_TYPE, id: "/work/Chart one.html" },
		});
	});

	it("closes a pane's page when the pane closes or its work session is deleted", async () => {
		const { fake, pages, sessions, settle } = await boot({
			panes: [browserPane("pane_a"), browserPane("pane_b")],
		});
		await pages.methods.attach({ ...target, webContentsId: 1 });
		await pages.methods.attach({ workSessionId: SESSION_ID, paneId: "pane_b", webContentsId: 2 });

		await sessions.close("pane_a");
		await settle();
		expect(fake.guest(1).controller.dispose).toHaveBeenCalledOnce();
		expect(Object.keys(pages.getState().pages)).toEqual([pageKey(SESSION_ID, "pane_b")]);

		sessions.deleteSession();
		await settle();
		expect(fake.guest(2).controller.dispose).toHaveBeenCalledOnce();
		expect(pages.getState().pages).toEqual({});
	});

	it("disposes every guest when it deactivates", async () => {
		const { main, fake, pages } = await boot();
		await pages.methods.attach({ ...target, webContentsId: 42 });

		await main.stop();

		expect(fake.guest(42).controller.dispose).toHaveBeenCalled();
	});
});

describe("kilo.browser's openers", () => {
	it("opens a web page in a Browser pane titled with its host, reusing it", async () => {
		const { panes, settle, sessions } = await boot({ panes: [] });

		const pane = await panes().methods.openObject({
			workSessionId: SESSION_ID,
			ref: { type: URL_OBJECT_TYPE, id: "https://example.com/docs" },
		});
		await settle();
		expect(pane?.kind).toBe(BROWSER_PANE_KIND);
		expect(sessions.panes().panes).toEqual([
			expect.objectContaining({ id: pane?.id, title: "example.com" }),
		]);

		const again = await panes().methods.openObject({
			workSessionId: SESSION_ID,
			ref: { type: URL_OBJECT_TYPE, id: "https://example.com/docs" },
		});
		expect(again?.id).toBe(pane?.id);
		expect(sessions.panes().panes).toHaveLength(1);
	});

	it("opens a workspace's HTML files ahead of kilo.files, titled with their name", async () => {
		const { panes, settle, paneOf } = await boot({ panes: [] });
		const open = (id: string) =>
			panes().methods.openObject({
				workSessionId: SESSION_ID,
				ref: { type: FILE_OBJECT_TYPE, id },
			});

		const html = await open("/work/site/Index.HTML");
		const htm = await open("/work/site/old.htm");
		const text = await open("/work/site/notes.txt");
		await settle();

		expect(html?.kind).toBe(BROWSER_PANE_KIND);
		expect(htm?.kind).toBe(BROWSER_PANE_KIND);
		expect(text?.kind).toBe("kilo.files/files");
		expect(paneOf(html!.id)?.title).toBe("Index.HTML");
		expect(paneOf(text!.id)?.title).toBe("Files");
	});
});

describe("the open agent tool", () => {
	it("opens a web page in the calling chat's work session", async () => {
		const { callTool, sessions } = await boot({ panes: [] });

		const result = await callTool({ url: "localhost:3000" });

		const [pane] = sessions.panes().panes;
		expect(result).toEqual({
			workSessionId: SESSION_ID,
			paneId: pane?.id,
			url: "http://localhost:3000/",
		});
		expect(pane?.object).toEqual({ type: URL_OBJECT_TYPE, id: "http://localhost:3000/" });
		expect(await callTool({ url: "http://localhost:3000" })).toEqual(result);
	});

	it("needs a calling work session, web URLs and kilo.work-sessions", async () => {
		const { callTool } = await boot();
		await expect(callTool({ url: "example.com" }, null)).rejects.toThrow(
			"originating Kilo chat session",
		);
		await expect(callTool({ url: localFileUrl("/work/a.html") })).rejects.toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		await expect(callTool({ url: "ftp://example.com" })).rejects.toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);

		const alone = await boot({ withoutSessions: true });
		await expect(alone.callTool({ url: "example.com" })).rejects.toThrow(
			"The session's panes are unavailable.",
		);
	});
});
