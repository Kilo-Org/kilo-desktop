import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { Pane } from "@kilo-desktop/plugin-sessions/contracts";

import {
	NOTEBOOK_THEME_MESSAGE_TYPE,
	NOTEBOOK_THEME_READY_MESSAGE_TYPE,
} from "../contracts/index.js";
import {
	bootNotebookHost,
	NOTEBOOK_ID,
	SIGNED_IN,
	SIGNED_OUT,
	type NotebookHostOptions,
} from "../test/notebook-host.js";
import { notebookPane, SESSION_ID } from "../test/sessions-host.js";

const WAIT = { timeout: 5_000 };
const DESKTOP_ORIGIN = "kilo-desktop://notebook";

const frame = () => document.querySelector<HTMLIFrameElement>('[data-qa-id="notebook-frame"]');

async function renderPane(
	pane: Pane,
	options: NotebookHostOptions = {},
	directory: string | null = null,
) {
	const host = await bootNotebookHost({ ...options, panes: [pane] });
	const view = host.renderPane({ pane, directory });
	return { ...host, ...view };
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("the Notebook pane", () => {
	it("asks a signed-out person to sign in instead of showing the notebook", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		const host = await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }), {
			identity: SIGNED_OUT,
		});

		await expect.element(page.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		await expect
			.element(page.getByText("Notebooks requires a Kilo account. Sign in to continue."))
			.toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-view"]')).toBeNull();
		expect(host.calls.status).toBe(0);

		await page.getByTestId("kilo-auth-gate-sign-in-button").click();
		await vi.waitFor(() => expect(host.signIns).toHaveLength(1), WAIT);
		await host.setIdentity(SIGNED_IN);
		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
	});

	it("shows its loading state until sign-in is known", async () => {
		await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }), {
			identity: { ...SIGNED_IN, authenticated: null, connection: "pending" },
		});

		await expect.element(page.getByTestId("notebook-view-loading")).toBeVisible();
	});

	it.each([
		{
			name: "shows the right-side rail with its drawer initially collapsed when supported",
			capabilities: ["presentation.rail"] as unknown,
			presentation: { rail: { visible: true, side: "right", initialCollapsed: true } },
		},
		{ name: "omits rail configuration when capabilities are absent", capabilities: undefined },
		{
			name: "omits rail configuration when its capability is absent",
			capabilities: ["another.capability"],
		},
		{ name: "does not accept a string as a capability list", capabilities: "presentation.rail" },
	])("$name", async ({ capabilities, presentation }) => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		const host = await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }));
		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
		const frameWindow = frame()!.contentWindow!;
		const channel = new MessageChannel();
		const openPort = vi.spyOn(host.sdk.ports, "open").mockReturnValue(channel.port1);
		const postMessage = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});
		try {
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: DESKTOP_ORIGIN,
					source: frameWindow,
					data: { type: "nteract:electron-host-ready", protocolVersion: 1, capabilities },
				}),
			);
			expect(openPort).toHaveBeenCalledExactlyOnceWith("host", {
				notebookId: NOTEBOOK_ID,
				sessionId: SESSION_ID,
				title: "Notebook",
			});
			expect(postMessage).toHaveBeenCalledExactlyOnceWith(
				{
					type: "nteract:electron-host-connect",
					bootstrap: {
						protocolVersion: 1,
						outputDocumentUrl: `${DESKTOP_ORIGIN}/output-frame.html`,
						...(presentation ? { presentation } : {}),
					},
				},
				DESKTOP_ORIGIN,
				[channel.port1],
			);
		} finally {
			postMessage.mockRestore();
			openPort.mockRestore();
			channel.port1.close();
			channel.port2.close();
		}
	});

	it("ignores a host-ready handshake from a foreign origin or source", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		const host = await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }));
		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
		const frameWindow = frame()!.contentWindow!;
		const openPort = vi.spyOn(host.sdk.ports, "open");
		const ready = { type: "nteract:electron-host-ready", protocolVersion: 1 };

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://evil.example",
				source: frameWindow,
				data: ready,
			}),
		);
		window.dispatchEvent(
			new MessageEvent("message", { origin: DESKTOP_ORIGIN, source: window, data: ready }),
		);
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: DESKTOP_ORIGIN,
				source: frameWindow,
				data: { ...ready, protocolVersion: 99 },
			}),
		);

		expect(openPort).not.toHaveBeenCalled();
		openPort.mockRestore();
	});

	it("passes a file notebook's path and the session's folder to its connection", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		const host = await renderPane(
			notebookPane("pane_a", {
				notebookId: NOTEBOOK_ID,
				notebookOpenState: "ready",
				notebookPath: "/projects/analysis.ipynb",
			}),
			{},
			"/projects",
		);
		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
		const channel = new MessageChannel();
		const openPort = vi.spyOn(host.sdk.ports, "open").mockReturnValue(channel.port1);
		const postMessage = vi
			.spyOn(frame()!.contentWindow!, "postMessage")
			.mockImplementation(() => {});

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: DESKTOP_ORIGIN,
				source: frame()!.contentWindow,
				data: { type: "nteract:electron-host-ready", protocolVersion: 1 },
			}),
		);

		expect(openPort).toHaveBeenCalledWith("host", {
			notebookId: NOTEBOOK_ID,
			sessionId: SESSION_ID,
			title: "Notebook",
			notebookPath: "/projects/analysis.ipynb",
			workingDirectory: "/projects",
		});
		expect(host.calls.prepare).toEqual([]);
		postMessage.mockRestore();
		openPort.mockRestore();
		channel.port1.close();
		channel.port2.close();
	});

	it("shows a placeholder while nteract's bundle is not served from our protocol", async () => {
		await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }));

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(frame()).toBeNull();
	});

	it("frames nteract's dev server when an origin is configured", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		const host = await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }));

		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
		expect(frame()?.getAttribute("src")).toBe(`http://localhost:8737/?notebook_id=${NOTEBOOK_ID}`);
		expect(host.calls.status).toBe(0);
	});

	it("frames origin's notebooks by their pane id, legacy prefix stripped", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		await renderPane(notebookPane(`notebook.notebook:${NOTEBOOK_ID}`));

		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
		expect(frame()?.getAttribute("src")).toBe(`http://localhost:8737/?notebook_id=${NOTEBOOK_ID}`);
	});

	it("asks main for a notebook while the pane has none, and shows it opening", async () => {
		const host = await renderPane(
			notebookPane("pane_a", { notebookOpenState: "opening", notebookPath: "/projects/a.ipynb" }),
		);

		await expect.element(page.getByTestId("notebook-file-opening")).toBeVisible();
		await vi.waitFor(
			() => expect(host.calls.resolve).toEqual([{ sessionId: SESSION_ID, paneId: "pane_a" }]),
			WAIT,
		);
	});

	it("shows why a file could not be opened, without asking again", async () => {
		const host = await renderPane(
			notebookPane("pane_a", {
				notebookOpenError: "Could not open notebook: lock held",
				notebookOpenState: "error",
				notebookPath: "/projects/analysis.ipynb",
			}),
		);

		const error = page.getByTestId("notebook-file-open-error");
		await expect.element(error).toBeVisible();
		await expect.element(error.getByText("Could not open notebook: lock held")).toBeVisible();
		expect(host.calls.resolve).toEqual([]);
	});

	it("waits for the runtime, and offers to try again when it can't start", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		let answer: () => unknown = () => {
			throw new Error("spawn failed");
		};
		await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }), {
			notebooks: {
				status: async () => answer() as never,
			},
		});

		await expect.element(page.getByTestId("notebook-runtime-error")).toBeVisible();
		answer = () => ({
			availability: {
				status: "unavailable",
				reason: "The bundled runtimed daemon is unavailable.",
			},
			process: { status: "failed" },
			daemon: null,
		});
		await page.getByTestId("notebook-runtime-retry").click();
		await expect
			.element(page.getByText("The bundled runtimed daemon is unavailable."))
			.toBeVisible();
		answer = () => ({
			availability: { status: "unavailable" },
			process: { status: "starting" },
			daemon: null,
		});
		await page.getByTestId("notebook-runtime-retry").click();
		await expect
			.element(page.getByText("The notebook runtime daemon is unavailable."))
			.toBeVisible();
	});

	it("prepares a new notebook's environment in the session's folder before connecting", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", DESKTOP_ORIGIN);
		let finish!: () => void;
		const host = await renderPane(
			notebookPane("pane_a", { notebookId: NOTEBOOK_ID }),
			{
				notebooks: {
					prepareEnvironment: () =>
						new Promise((resolve) => {
							finish = () => resolve({ outcome: "created", path: "/projects/environment.yml" });
						}),
				},
			},
			"/projects",
		);

		await expect.element(page.getByTestId("notebook-environment-preparing")).toBeVisible();
		expect(host.calls.prepare).toEqual([
			{ notebookId: NOTEBOOK_ID, workingDirectory: "/projects" },
		]);
		finish();
		await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
	});

	it("pushes the window's appearance into the framed notebook", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "https://notebook.test");
		document.documentElement.style.setProperty("--pane-surface", "#181818");
		document.documentElement.style.setProperty("--foreground", "#fafafa");
		try {
			const host = await renderPane(notebookPane("pane_a", { notebookId: NOTEBOOK_ID }), {
				mode: "dark",
			});
			await expect.element(page.getByTestId("notebook-frame")).toBeVisible();
			const frameWindow = frame()!.contentWindow!;
			const postMessage = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => undefined);
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: "https://notebook.test",
					source: frameWindow,
					data: { type: NOTEBOOK_THEME_READY_MESSAGE_TYPE },
				}),
			);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalled(), WAIT);
			expect(postMessage.mock.calls.at(-1)).toEqual([
				{
					type: NOTEBOOK_THEME_MESSAGE_TYPE,
					mode: "dark",
					tokens: expect.objectContaining({ background: "rgb(24, 24, 24)" }),
				},
				"https://notebook.test",
			]);

			await host.setMode("light");
			await vi.waitFor(
				() =>
					expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
						type: NOTEBOOK_THEME_MESSAGE_TYPE,
						mode: "light",
					}),
				WAIT,
			);
		} finally {
			document.documentElement.style.removeProperty("--pane-surface");
			document.documentElement.style.removeProperty("--foreground");
		}
	});

	describe("closing", () => {
		const pane = notebookPane("pane_a", { notebookId: NOTEBOOK_ID });

		it("closes at once while its notebook is saved", async () => {
			const host = await renderPane(pane);

			await expect(host.canClose(pane)).resolves.toBe(true);
		});

		it("asks to save an unsaved notebook, and closes once it is saved", async () => {
			const host = await renderPane(pane);
			await host.setDirty(NOTEBOOK_ID, true);

			const closing = host.canClose(pane);
			await expect.element(page.getByTestId("chat-pane-close-dialog")).toBeVisible();
			await page.getByTestId("chat-pane-close-save").click();

			await expect(closing).resolves.toBe(true);
			expect(host.calls.save).toEqual([{ notebookId: NOTEBOOK_ID }]);
		});

		it("keeps the pane open when saving fails or is cancelled, until discarded", async () => {
			let result: { outcome: "failed" | "cancelled"; reason?: string } = {
				outcome: "failed",
				reason: "Disk full.",
			};
			const host = await renderPane(pane, { notebooks: { save: () => result } });
			await host.setDirty(NOTEBOOK_ID, true);

			const closing = host.canClose(pane);
			await page.getByTestId("chat-pane-close-save").click();
			await expect
				.element(page.getByTestId("chat-pane-close-error").getByText("Disk full."))
				.toBeVisible();
			result = { outcome: "cancelled" };
			await page.getByTestId("chat-pane-close-save").click();
			await vi.waitFor(() => expect(host.calls.save).toHaveLength(2), WAIT);
			await expect.element(page.getByTestId("chat-pane-close-dialog")).toBeVisible();
			await page.getByTestId("chat-pane-close-discard").click();

			await expect(closing).resolves.toBe(true);
		});

		it("stays open when the person cancels", async () => {
			const host = await renderPane(pane);
			await host.setDirty(NOTEBOOK_ID, true);

			const closing = host.canClose(pane);
			await page.getByTestId("chat-pane-close-cancel").click();

			await expect(closing).resolves.toBe(false);
		});
	});
});
