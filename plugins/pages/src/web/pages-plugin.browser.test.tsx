import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, KernelError, type PluginEntry } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	PaneKind,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessionsWindow,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { PAGES_DEFINITIONS, PAGES_PANE_KIND, PagesServer } from "../contracts/index.js";
import { pagesWebEntry } from "./index.js";

const kernels: { stop(): Promise<void> }[] = [];
afterEach(async () => {
	cleanup();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
});

type PrepareView = () => Promise<{ partition: string; url: string }>;

async function boot(options: { prepareView?: PrepareView; withoutMain?: boolean } = {}) {
	const opened: { kind: string }[] = [];
	const pagesMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(PagesServer, {
				initialState: { status: "stopped", origin: null, message: null },
				methods: {
					ensure: async () => ({ origin: "http://localhost:1" }),
					prepareView: options.prepareView ?? (() => new Promise(() => undefined)),
				},
			});
		},
	});
	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: { focus: null, activeWorkSessionId: "ws", view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: (input) => void opened.push(input),
				},
			});
			sdk.context.set("paneTargetActive", true);
		},
	});
	const { main, renderer } = await createTestKernelPair({
		main: [
			{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
			{
				manifest,
				definitions: PAGES_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: pagesMain }),
			},
		],
		renderer: [
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsWeb,
			},
			{ manifest, definitions: PAGES_DEFINITIONS, entry: pagesWebEntry },
		],
	});
	kernels.push(main);
	const paneKind = () =>
		renderer.kernelSdk.extensions.list(PaneKind).find((kind) => kind.key === PAGES_PANE_KIND)!;
	const props: PaneProps = {
		workSessionId: "ws",
		pane: { id: "pane_1", kind: PAGES_PANE_KIND, title: "Pages" } as PaneProps["pane"],
		workspaceId: null,
		directory: null,
		visible: true,
	};
	const renderPane = () =>
		render(
			<KernelProvider kernel={renderer}>
				<RenderContribution
					contribution={paneKind()}
					props={props}
					select={(implementation: PaneImplementation) => implementation.component}
				/>
			</KernelProvider>,
		);
	return { renderer, paneKind, renderPane, opened };
}

describe("kilo.pages' web entry", () => {
	it("contributes the Pages pane kind, kept alive, one per session, desktop only", async () => {
		const host = await boot();

		expect(host.paneKind().metadata).toMatchObject({
			title: "Pages",
			keepAlive: true,
			singleton: true,
			launch: { newSession: true, inSession: true },
			availableWhen: { all: ["kernel/desktop"] },
			openCommand: "kilo.pages/open",
		});
	});

	it("Open Pages opens a Pages pane through the window", async () => {
		const host = await boot();

		await host.renderer.commands.execute("kilo.pages/open");

		expect(host.opened).toEqual([{ kind: PAGES_PANE_KIND }]);
	});

	it("shows Pages in a webview on the browser partition, signing in first", async () => {
		const host = await boot({
			prepareView: async () => ({
				partition: "persist:test",
				url: "http://localhost:1/api/auth/login?return_to=/pages",
			}),
		});

		host.renderPane();

		await expect.element(page.getByTestId("pages-webview")).toBeInTheDocument();
		const webview = page.getByTestId("pages-webview").element();
		expect(webview.tagName.toLowerCase()).toBe("webview");
		expect(webview.getAttribute("partition")).toBe("persist:test");
		expect(webview.getAttribute("src")).toBe("http://localhost:1/api/auth/login?return_to=/pages");
	});

	it("says it is opening while the server starts", async () => {
		const host = await boot();

		host.renderPane();

		await expect.element(page.getByTestId("pages-starting")).toBeInTheDocument();
	});

	it("shows why Pages couldn't start, and tries again", async () => {
		const prepareView = vi
			.fn<PrepareView>()
			.mockRejectedValueOnce(new KernelError("UNAVAILABLE", "celld isn't installed."))
			.mockResolvedValue({ partition: "persist:test", url: "http://localhost:1/" });
		const host = await boot({ prepareView });
		host.renderPane();

		await expect.element(page.getByText("celld isn't installed.")).toBeInTheDocument();
		await page.getByTestId("pages-retry").click();

		await expect.element(page.getByTestId("pages-webview")).toBeInTheDocument();
		expect(prepareView).toHaveBeenCalledTimes(2);
	});

	it("says Pages isn't available without its main process", async () => {
		const host = await boot({ withoutMain: true });

		host.renderPane();

		await expect.element(page.getByTestId("pages-unavailable")).toBeInTheDocument();
	});
});
