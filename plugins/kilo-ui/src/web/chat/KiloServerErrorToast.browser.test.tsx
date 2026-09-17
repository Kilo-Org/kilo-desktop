import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatServerError, KiloServerErrorToast } from "./KiloServerErrorToast.js";
import {
	ChatConnectionProvider,
	type ChatConnectionStatus,
} from "./connection/ChatConnectionContext.js";

const toastApi = vi.hoisted(() => ({
	error: vi.fn(),
	dismiss: vi.fn(),
}));

vi.mock("@anaconda-agentic-desktop/ui/components/sonner", () => ({
	toast: toastApi,
}));

function neverResolve(): Promise<never> {
	return new Promise<never>(() => undefined);
}

function renderToast(status: ChatConnectionStatus) {
	const result = render(
		<ChatConnectionProvider status={status}>
			<KiloServerErrorToast />
		</ChatConnectionProvider>,
	);
	return {
		...result,
		rerender: (next: ChatConnectionStatus) => {
			result.rerender(
				<ChatConnectionProvider status={next}>
					<KiloServerErrorToast />
				</ChatConnectionProvider>,
			);
		},
	};
}

afterEach(() => {
	cleanup();
	toastApi.error.mockReset();
	toastApi.dismiss.mockReset();
});

describe("formatServerError", () => {
	it("cleans up stderr lines from a config validation error", () => {
		const message =
			"Kilo server exited before becoming ready (code 1).\n" +
			"Error: Configuration is invalid at /Users/test/.config/kilo/kilo.jsonc\n" +
			"↳ Unrecognized key: reasoning_display";
		expect(formatServerError(message)).toBe(
			"Configuration is invalid at /Users/test/.config/kilo/kilo.jsonc.\n" +
				"Unrecognized key: reasoning_display.",
		);
	});

	it("returns the message as-is when there is no stderr", () => {
		expect(formatServerError("Kilo server failed to start.")).toBe("Kilo server failed to start.");
	});

	it("preserves existing trailing punctuation", () => {
		const message = "base error\nSomething went wrong!";
		expect(formatServerError(message)).toBe("Something went wrong!");
	});
});

describe("KiloServerErrorToast", () => {
	it("shows a persistent error toast with a fixed title when the connection fails", async () => {
		renderToast({
			isPending: false,
			isError: true,
			error: new Error("Kilo server failed to start."),
			connectionPromise: neverResolve(),
		});

		await expect.poll(() => toastApi.error.mock.calls.length).toBe(1);
		expect(toastApi.error).toHaveBeenCalledWith(
			"Kilo server error",
			expect.objectContaining({
				id: "kilo-server-error",
				description: "Kilo server failed to start.",
				duration: Number.POSITIVE_INFINITY,
				closeButton: true,
			}),
		);
	});

	it("formats stderr detail into a clean description", async () => {
		const message =
			"Kilo server exited before becoming ready (code 1).\n" +
			"Error: Configuration is invalid at /Users/test/.config/kilo/kilo.jsonc\n" +
			"↳ Unrecognized key: reasoning_display";
		renderToast({
			isPending: false,
			isError: true,
			error: new Error(message),
			connectionPromise: neverResolve(),
		});

		await expect.poll(() => toastApi.error.mock.calls.length).toBe(1);
		expect(toastApi.error).toHaveBeenCalledWith(
			"Kilo server error",
			expect.objectContaining({
				description:
					"Configuration is invalid at /Users/test/.config/kilo/kilo.jsonc.\n" +
					"Unrecognized key: reasoning_display.",
			}),
		);
	});

	it("dismisses the toast when the connection recovers", async () => {
		const { rerender } = renderToast({
			isPending: false,
			isError: true,
			error: new Error("Kilo server failed to start."),
			connectionPromise: neverResolve(),
		});

		await expect.poll(() => toastApi.error.mock.calls.length).toBe(1);

		const connection = {
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			version: "7.5.5",
			globalDirectory: "/tmp/runtime",
		};
		await act(() => {
			rerender({
				isPending: false,
				isError: false,
				error: null,
				connection,
				connectionPromise: Promise.resolve(connection),
			});
		});

		expect(toastApi.dismiss).toHaveBeenCalledWith("kilo-server-error");
	});

	it("does not re-show the toast for the same error message", async () => {
		const error = new Error("Kilo server failed to start.");
		const { rerender } = renderToast({
			isPending: false,
			isError: true,
			error,
			connectionPromise: neverResolve(),
		});

		await expect.poll(() => toastApi.error.mock.calls.length).toBe(1);

		await act(() => {
			rerender({
				isPending: false,
				isError: true,
				error,
				connectionPromise: neverResolve(),
			});
		});

		expect(toastApi.error).toHaveBeenCalledOnce();
	});

	it("does not show a toast when the connection is pending", () => {
		renderToast({
			isPending: true,
			isError: false,
			error: null,
			connectionPromise: neverResolve(),
		});

		expect(toastApi.error).not.toHaveBeenCalled();
	});

	it("does not show a toast for browser-mode capability errors", () => {
		renderToast({
			isPending: false,
			isError: true,
			error: new Error("Kilo Server requires the desktop app."),
			connectionPromise: neverResolve(),
		});

		expect(toastApi.error).not.toHaveBeenCalled();
	});
});
