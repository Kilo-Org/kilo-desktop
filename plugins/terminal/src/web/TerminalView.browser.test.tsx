import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { TerminalPalette } from "@kilo-desktop/ui/themes/appearance-types";

import { terminalFrameConnectSchema } from "../contracts/frame";
import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session";
import {
	DARK_THEME,
	readyFrame,
	renderTerminalHost,
	stubTerminalOrigin,
	terminalFrame,
	terminalPane,
} from "../test/terminal-host";

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	document.documentElement.style.removeProperty("--pane-surface");
	document.documentElement.style.removeProperty("--app-scrollbar-thumb");
	document.documentElement.style.removeProperty("--app-scrollbar-thumb-hover");
});

describe("TerminalView", () => {
	it("starts a terminal without a folder so main uses the home directory", async () => {
		stubTerminalOrigin();
		const { opened } = await renderTerminalHost();
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();

		await readyFrame();

		await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
		expect(opened.mock.calls[0]![0]).not.toHaveProperty("cwd");
	});

	it("connects the trusted frame to the pane's shell in the session's folder", async () => {
		stubTerminalOrigin();
		document.documentElement.style.setProperty("--pane-surface", "#181818");
		document.documentElement.style.setProperty("--app-scrollbar-thumb", "#111111");
		document.documentElement.style.setProperty("--app-scrollbar-thumb-hover", "#222222");
		const { opened } = await renderTerminalHost({
			pane: terminalPane({ ordinal: 2, metadata: { terminalSessionId: "ses_origin" } }),
			directory: "/workspace",
		});
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();

		const { postMessage } = await readyFrame();

		await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
		expect(opened).toHaveBeenCalledWith({
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
			sessionId: "ses_origin",
			terminalId: "pane_1",
			cwd: "/workspace",
			cols: 120,
			rows: 30,
			initialLabel: "Terminal 2",
		});
		const connect = terminalFrameConnectSchema.parse(postMessage.mock.calls.at(-1)?.[0]);
		expect(connect.theme.background).toBe("rgb(24, 24, 24)");
		expect(connect.theme.cursorAccent).toBe("rgb(24, 24, 24)");
		expect(connect.theme.scrollbarThumb).toBe("#111111");
		expect(connect.theme.foreground).toBe("#e1e8f0");
	});

	it("ignores messages from anything but its frame", async () => {
		stubTerminalOrigin();
		const { opened } = await renderTerminalHost();
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();

		await readyFrame("https://evil.test");
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: window.location.origin,
				source: terminalFrame().contentWindow,
				data: { type: "terminal:label", protocolVersion: TERMINAL_PROTOCOL_VERSION, label: "vim" },
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(opened).not.toHaveBeenCalled();
	});

	it.each([
		{ workSessionId: "wses_1", paneId: "pane_2" },
		{ workSessionId: "wses_2", paneId: "pane_1" },
	])(
		"reuses the shell on a theme reconnect and starts $workSessionId/$paneId in the latest folder",
		async ({ workSessionId, paneId }) => {
			stubTerminalOrigin();
			const view = await renderTerminalHost({ directory: "/workspace-one" });
			await expect.element(page.getByTestId("terminal-frame")).toBeVisible();
			const lastArgs = () => view.opened.mock.lastCall?.[0];

			const { frame } = await readyFrame();
			await vi.waitFor(() => expect(lastArgs()).toMatchObject({ cwd: "/workspace-one" }));

			view.rerender({ directory: "/workspace-two" });
			expect(document.querySelector('[data-qa-id="terminal-frame"]')).toBe(frame);

			await act(async () =>
				view.setTheme({
					...DARK_THEME,
					themeId: "dracula",
					terminal: { red: "#ff5555" } as TerminalPalette,
				}),
			);
			const reconnected = await readyFrame();
			expect(reconnected.frame).not.toBe(frame);
			await vi.waitFor(() => expect(view.opened).toHaveBeenCalledTimes(2));
			expect(
				terminalFrameConnectSchema.parse(reconnected.postMessage.mock.calls.at(-1)?.[0]).theme.red,
			).toBe("#ff5555");
			expect(lastArgs()).toMatchObject({ sessionId: "wses_1", terminalId: "pane_1" });
			expect(lastArgs()).not.toHaveProperty("cwd");

			view.rerender({
				workSessionId,
				pane: terminalPane({ id: paneId }),
				directory: "/workspace-two",
			});
			expect((await readyFrame()).frame).not.toBe(reconnected.frame);
			await vi.waitFor(() => expect(view.opened).toHaveBeenCalledTimes(3));
			expect(lastArgs()).toMatchObject({
				sessionId: workSessionId,
				terminalId: paneId,
				cwd: "/workspace-two",
			});
		},
	);

	it("follows the document's colour scheme without kilo.shell's theme", async () => {
		stubTerminalOrigin();
		delete document.documentElement.dataset["theme"];
		const { opened } = await renderTerminalHost({}, { withoutTheme: true });
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();

		const { postMessage } = await readyFrame();

		await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
		expect(
			terminalFrameConnectSchema.parse(postMessage.mock.calls.at(-1)?.[0]).theme.foreground,
		).toBe("#222934");
	});

	it("shows why it couldn't connect", async () => {
		stubTerminalOrigin();
		const { sdk } = await renderTerminalHost();
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();
		vi.spyOn(sdk.ports, "open").mockImplementation(() => {
			throw new Error("No port for you.");
		});

		await readyFrame();

		await expect.element(page.getByTestId("terminal-connection-error")).toBeVisible();
		await expect.element(page.getByText("No port for you.")).toBeVisible();
	});

	it("says terminals aren't available where main runs no shells", async () => {
		stubTerminalOrigin();
		await renderTerminalHost({}, { withoutMain: true });

		await expect.element(page.getByTestId("terminal-unavailable")).toBeVisible();
		await expect.element(page.getByText("Terminals aren't available here")).toBeVisible();
	});

	it("needs the desktop app's terminal host", async () => {
		await renderTerminalHost();

		await expect.element(page.getByTestId("terminal-desktop-required")).toBeVisible();
	});
});
