import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeSdk,
	createFakeTheme,
} from "@anaconda-agentic-desktop/testing";

import {
	NOTEBOOK_DIRTY_CHANGED_EVENT,
	NOTEBOOK_TITLE_CHANGED_EVENT,
	notebookContract,
	type NotebookService,
} from "../../contracts/schemas.js";
import type { ChatRightPanelCapability } from "./notebook-webmcp-tools.js";

import {
	NOTEBOOK_THEME_MESSAGE_TYPE,
	NOTEBOOK_THEME_READY_MESSAGE_TYPE,
} from "./notebook-theme.js";
import {
	NotebookView,
	notebookHostConnectionArgs,
	notebookOriginFrom,
	nteractSrcFor,
	type NotebookViewProps,
} from "./NotebookView.js";

const DEFAULT_PROPS: NotebookViewProps = {
	sessionId: "session-1",
	instanceId: "instance-1",
	title: "Notebook 1",
};

function renderView(
	viewProps: Partial<NotebookViewProps> = {},
	options: {
		panel?: Partial<ChatRightPanelCapability>;
		save?: NotebookService["save"];
		setDefaultSaveDirectory?: NotebookService["setDefaultSaveDirectory"];
		theme?: ReturnType<typeof createFakeTheme>;
	} = {},
) {
	const save = options.save ?? (async () => ({ outcome: "saved" as const }));
	const setDefaultSaveDirectory = options.setDefaultSaveDirectory ?? (async () => undefined);
	const sdk = createFakeSdk({
		featureId: "notebook",
		channels: notebookContract,
		...(options.theme ? { theme: options.theme } : {}),
		handlers: {
			status: async () => ({
				availability: { status: "unavailable" as const },
				process: { status: "failed" as const, reason: "Not staged for this test." },
				daemon: null,
			}),
			openFile: async ({ path }: { path: string }) => ({
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				path,
				title: "analysis.ipynb",
			}),
			save,
			setDefaultSaveDirectory,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { notebook: sdk } });
	if (options.panel) {
		system
			.getSdk("kilo-ui")
			.plugins.expose("chatRightPanel", options.panel as Record<string, unknown>);
	}
	return {
		...render(
			<SdkProvider system={system}>
				<NotebookView {...DEFAULT_PROPS} {...viewProps} />
			</SdkProvider>,
		),
		sdk,
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
});

describe("NotebookView", () => {
	it("derives the notebook origin by substituting the host on our own", () => {
		// The renderer cannot read app.isPackaged, so the scheme has to come from its
		// own origin — otherwise a dev build would frame the production host.
		expect(notebookOriginFrom("anaconda-agentic-desktop://app")).toBe(
			"anaconda-agentic-desktop://notebook",
		);
		expect(notebookOriginFrom("anaconda-agentic-desktop-dev://app")).toBe(
			"anaconda-agentic-desktop-dev://notebook",
		);
	});

	it("has no notebook origin in browser mode, where the protocol does not exist", () => {
		expect(notebookOriginFrom("http://localhost:5173")).toBeUndefined();
		expect(notebookOriginFrom("https://anaconda.com")).toBeUndefined();
		expect(notebookOriginFrom("not a url")).toBeUndefined();
	});

	it("selects the Electron host and exact parent origin under the desktop scheme", () => {
		const src = nteractSrcFor("669d39ec-39d6-4160-815c-b46e170cde8d", {
			protocol: "anaconda-agentic-desktop:",
			host: "app",
		});
		const url = new URL(src!);

		expect(`${url.protocol}//${url.host}`).toBe("anaconda-agentic-desktop://notebook");
		expect(url.searchParams.get("notebook_id")).toBe("669d39ec-39d6-4160-815c-b46e170cde8d");
		expect(url.searchParams.get("nteract-host")).toBe("electron");
		expect(url.searchParams.get("nteract-parent-origin")).toBe("anaconda-agentic-desktop://app");
	});

	it("shows a placeholder while nteract's bundle is not served from our protocol", async () => {
		renderView();

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});

	it("frames nteract's dev server when an origin is configured", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView();

		const frame = document.querySelector('[data-qa-id="notebook-frame"]');
		expect(document.querySelector('[data-qa-id="notebook-title"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="notebook-status"]')).toBeNull();
		// The stable tab instance id becomes nteract's recoverable room id.
		expect(frame?.getAttribute("src")).toBe("http://localhost:8737/?notebook_id=instance-1");
		expect(document.querySelector('[data-qa-id="notebook-placeholder"]')).toBeNull();
	});

	it("uses distinct pane instance ids for distinct scratch notebooks", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView({ instanceId: "instance-2", title: "Notebook 2" });

		expect(document.querySelector('[data-qa-id="notebook-frame"]')?.getAttribute("src")).toBe(
			"http://localhost:8737/?notebook_id=instance-2",
		);
	});

	it("shows an opening state before a file-backed notebook has a daemon id", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView({
			instanceId: "panel-tab-1",
			title: "analysis.ipynb",
			metadata: {
				notebookOpenState: "opening",
				notebookPath: "/projects/analysis.ipynb",
			},
		});

		await expect.element(page.getByTestId("notebook-file-opening")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});

	it("shows the file-open error in the notebook tab", async () => {
		renderView({
			instanceId: "panel-tab-1",
			title: "analysis.ipynb",
			metadata: {
				notebookOpenError: "Could not open notebook: lock held",
				notebookOpenState: "error",
				notebookPath: "/projects/analysis.ipynb",
			},
		});

		await expect
			.element(page.getByTestId("notebook-file-open-error"))
			.toHaveTextContent("Could not open notebook: lock held");
	});

	it("uses a file tab's daemon identity and persisted path for the Electron host", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		const props = {
			instanceId: "panel-tab-1",
			sessionId: "session-1",
			title: "analysis.ipynb",
			metadata: {
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				notebookOpenState: "ready",
				notebookPath: "/projects/analysis.ipynb",
			},
		};

		expect(notebookHostConnectionArgs(props)).toEqual({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			sessionId: "session-1",
			title: "analysis.ipynb",
			notebookPath: "/projects/analysis.ipynb",
		});
		renderView(props);

		expect(document.querySelector('[data-qa-id="notebook-frame"]')?.getAttribute("src")).toBe(
			"http://localhost:8737/?notebook_id=669d39ec-39d6-4160-815c-b46e170cde8d",
		);
	});

	it("strips a legacy notebook.notebook: prefix before framing nteract", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView({ instanceId: "notebook.notebook:legacy-uuid" });

		expect(document.querySelector('[data-qa-id="notebook-frame"]')?.getAttribute("src")).toBe(
			"http://localhost:8737/?notebook_id=legacy-uuid",
		);
	});

	it("registers generic tab lifecycle and projects notebook dirty events", async () => {
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		const instanceId = "panel-tab-1";
		const updateTab = vi.fn();
		let lifecycle:
			| Parameters<NonNullable<ChatRightPanelCapability["registerTabLifecycle"]>>[2]
			| undefined;
		const registerTabLifecycle = vi.fn((_sessionId, _instanceId, nextLifecycle) => {
			lifecycle = nextLifecycle;
			return vi.fn();
		});
		const save = vi.fn(async () => ({ outcome: "saved" as const }));
		const { sdk } = renderView(
			{
				instanceId,
				metadata: {
					notebookId,
					notebookOpenState: "ready",
					notebookPath: "/projects/analysis.ipynb",
				},
			},
			{
				panel: { updateTab, registerTabLifecycle },
				save,
			},
		);

		await vi.waitFor(() => expect(registerTabLifecycle).toHaveBeenCalledOnce());
		sdk.events.emit("dirty-changed", {
			notebookId,
			sessionId: "session-1",
			dirty: true,
		});
		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", instanceId, { dirty: true }),
		);
		sdk.events.emit("title-changed", {
			notebookId,
			sessionId: "session-1",
			title: "analysis.ipynb",
		});
		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", instanceId, {
				title: "analysis.ipynb",
			}),
		);
		await expect(lifecycle?.save?.()).resolves.toEqual({ outcome: "saved" });
		await expect(lifecycle?.discard?.()).resolves.toBeUndefined();
		expect(save).toHaveBeenCalledWith({ notebookId });
		expect(NOTEBOOK_DIRTY_CHANGED_EVENT).toBe("notebook.dirty-changed");
		expect(NOTEBOOK_TITLE_CHANGED_EVENT).toBe("notebook.title-changed");
	});

	it("pushes the host appearance into the framed notebook", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "https://notebook.test");
		document.documentElement.style.setProperty("--background", "#111111");
		document.documentElement.style.setProperty("--pane-surface", "#181818");
		document.documentElement.style.setProperty("--foreground", "#fafafa");
		const theme = createFakeTheme({
			mode: "dark",
			themeId: "kilo",
			terminal: null,
			shiki: "github-dark",
		});
		renderView({}, { theme });
		const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="notebook-frame"]');
		if (!frame?.contentWindow) throw new Error("Expected notebook iframe window");
		const postMessage = vi
			.spyOn(frame.contentWindow, "postMessage")
			.mockImplementation(() => undefined);
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://notebook.test",
				source: frame.contentWindow,
				data: { type: NOTEBOOK_THEME_READY_MESSAGE_TYPE },
			}),
		);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
		expect(postMessage.mock.calls.at(-1)?.[0]).toEqual({
			type: NOTEBOOK_THEME_MESSAGE_TYPE,
			mode: "dark",
			tokens: expect.objectContaining({
				background: "rgb(24, 24, 24)",
				foreground: "rgb(250, 250, 250)",
			}),
		});
		expect(postMessage.mock.calls.at(-1)?.[1]).toBe("https://notebook.test");

		document.documentElement.style.setProperty("--background", "#fafaf7");
		document.documentElement.style.setProperty("--pane-surface", "#ffffff");
		document.documentElement.style.setProperty("--foreground", "#1f1f1f");
		await act(async () =>
			theme.setAppearance({
				mode: "light",
				themeId: "kilo",
				terminal: null,
				shiki: "github-light",
			}),
		);
		await vi.waitFor(() =>
			expect(postMessage.mock.calls.at(-1)?.[0]).toEqual({
				type: NOTEBOOK_THEME_MESSAGE_TYPE,
				mode: "light",
				tokens: expect.objectContaining({
					background: "rgb(255, 255, 255)",
					foreground: "rgb(31, 31, 31)",
				}),
			}),
		);
		document.documentElement.style.removeProperty("--background");
		document.documentElement.style.removeProperty("--pane-surface");
		document.documentElement.style.removeProperty("--foreground");
	});

	it("keeps the notebook host's default save directory synchronized with its workspace", async () => {
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		const setDefaultSaveDirectory = vi.fn(async () => undefined);
		renderView(
			{ instanceId: notebookId, workspaceDirectory: "/projects/analysis" },
			{ setDefaultSaveDirectory },
		);

		await vi.waitFor(() =>
			expect(setDefaultSaveDirectory).toHaveBeenCalledWith({
				notebookId,
				directory: "/projects/analysis",
			}),
		);
	});
});
