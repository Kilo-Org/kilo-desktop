import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session";
import {
	loadedFrame,
	renderTerminalHost,
	stubTerminalOrigin,
	terminalFrame,
} from "../test/terminal-host";

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const FOCUSED = "kilo.terminal/terminalFocused";

async function focusedTerminal() {
	stubTerminalOrigin();
	const host = await renderTerminalHost();
	await expect.element(page.getByTestId("terminal-frame")).toBeVisible();
	const { frame, postMessage } = await loadedFrame();
	frame.focus();
	await vi.waitFor(() => expect(host.renderer.contextKeys.get(FOCUSED)).toBe(true));
	return { ...host, frame, postMessage };
}

describe("terminal commands", () => {
	it("knows when a terminal has keyboard focus", async () => {
		const { renderer, unmount } = await focusedTerminal();

		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		await vi.waitFor(() => expect(renderer.contextKeys.get(FOCUSED)).toBe(false));

		terminalFrame().focus();
		await vi.waitFor(() => expect(renderer.contextKeys.get(FOCUSED)).toBe(true));
		unmount();
		await vi.waitFor(() => expect(renderer.contextKeys.get(FOCUSED)).toBe(false));
		input.remove();
	});

	it("clears the focused terminal with ⌘K", async () => {
		const { renderer, postMessage } = await focusedTerminal();

		await expect(renderer.keyboard.dispatch("Meta+KeyK")).resolves.toBe(true);

		expect(postMessage).toHaveBeenCalledWith(
			{ type: "terminal:clear", protocolVersion: TERMINAL_PROTOCOL_VERSION },
			window.location.origin,
		);
	});

	it("leaves ⌘K alone while no terminal has focus", async () => {
		stubTerminalOrigin();
		const { renderer } = await renderTerminalHost();
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();

		await expect(renderer.keyboard.dispatch("Meta+KeyK")).resolves.toBe(false);
	});

	it("opens a terminal in the window's open work session", async () => {
		const { renderer, openPane } = await renderTerminalHost();

		await renderer.commands.execute("kilo.terminal/new");

		expect(openPane).toHaveBeenCalledWith({
			workSessionId: "wses_1",
			kind: "kilo.terminal/terminal",
		});
	});

	it("shows the work session's terminal, or opens one, with Ctrl+`", async () => {
		const { renderer, windowOpenPane } = await renderTerminalHost();

		await expect(renderer.keyboard.dispatch("Ctrl+Backquote")).resolves.toBe(true);

		await vi.waitFor(() =>
			expect(windowOpenPane).toHaveBeenCalledWith({ kind: "kilo.terminal/terminal" }),
		);
	});

	it("opens nothing without an open work session", async () => {
		const { renderer, openPane } = await renderTerminalHost({}, { activeWorkSessionId: null });

		await renderer.commands.execute("kilo.terminal/new");

		expect(openPane).not.toHaveBeenCalled();
	});
});
