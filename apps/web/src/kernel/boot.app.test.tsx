import { cleanup, render } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelCommand, definePlugin } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";

import { bootKernel, startRenderer } from "./boot";

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
});

describe("kernel boot (browser mode)", () => {
	it("boots to the kernel's own screen when no plugin provides an interface", async () => {
		const { App } = await bootKernel({ bundled: [], webEntries: {} });

		render(<App />);

		await expect.element(page.getByTestId("kernel-recovery")).toBeVisible();
		await expect.element(page.getByText("Kilo Desktop is running")).toBeVisible();
	});

	it("boots the bundled plugins when given no overrides", async () => {
		const { kernel, App } = await bootKernel();

		render(<App />);

		expect(Object.values(kernel.pluginStates())).toContain("active");
		await expect.element(page.getByTestId("kernel-recovery")).not.toBeInTheDocument();
	});

	it("dispatches captured keys to commands", async () => {
		const run = vi.fn();
		const { App } = await bootKernel({
			bundled: [
				{
					manifest: testManifest("acme.keys", {
						contributes: {
							extensions: { "kernel/command": [{ id: "go", title: "Go", keybinding: "Alt+G" }] },
						},
					}),
				},
			],
			webEntries: {
				"acme.keys": definePlugin({
					activate: (sdk) => {
						sdk.extensions.implement(KernelCommand, "go", run);
					},
				}),
			},
		});
		render(<App />);
		await expect.element(page.getByTestId("kernel-recovery")).toBeVisible();

		window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltLeft", altKey: true }));
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", altKey: true }));
		expect(run).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", altKey: true }));

		await expect.poll(() => run).toHaveBeenCalledOnce();
	});

	it("runs no shortcut behind an open dialog", async () => {
		const run = vi.fn();
		await bootKernel({
			bundled: [
				{
					manifest: testManifest("acme.keys", {
						contributes: {
							extensions: { "kernel/command": [{ id: "go", title: "Go", keybinding: "Alt+G" }] },
						},
					}),
				},
			],
			webEntries: {
				"acme.keys": definePlugin({
					activate: (sdk) => {
						sdk.extensions.implement(KernelCommand, "go", run);
					},
				}),
			},
		});
		const dialog = document.createElement("div");
		dialog.dataset.slot = "dialog-content";
		dialog.dataset.open = "";
		document.body.append(dialog);

		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", altKey: true }));
		dialog.remove();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", altKey: true }));

		await expect.poll(() => run).toHaveBeenCalledOnce();
	});
});

describe("starting the renderer", () => {
	it("renders the booted kernel's app", async () => {
		const container = document.body.appendChild(document.createElement("div"));
		const root = createRoot(container);

		await startRenderer(root, { boot: () => bootKernel({ bundled: [], webEntries: {} }) });

		await expect.element(page.getByTestId("kernel-recovery")).toBeVisible();
		root.unmount();
	});

	it("shows a reloadable failure screen and reports the error when the kernel cannot boot", async () => {
		const container = document.body.appendChild(document.createElement("div"));
		const root = createRoot(container);
		const failure = new Error("Main process did not answer.");
		const onBootError = vi.fn();
		const reload = vi.fn();

		await startRenderer(root, { boot: async () => Promise.reject(failure), onBootError, reload });

		await expect.element(page.getByTestId("renderer-boot-failure")).toBeVisible();
		await expect.element(page.getByText("Main process did not answer.")).toBeVisible();
		expect(onBootError).toHaveBeenCalledWith(failure);
		await page.getByTestId("renderer-boot-reload").click();
		expect(reload).toHaveBeenCalledOnce();
		root.unmount();
	});

	it("explains a boot failure that carries no message", async () => {
		const container = document.body.appendChild(document.createElement("div"));
		const root = createRoot(container);

		await startRenderer(root, {
			boot: async () => Promise.reject("bridge gone"),
			reload: () => {},
		});

		await expect.element(page.getByText("An unexpected error occurred.")).toBeVisible();
		root.unmount();
	});
});
