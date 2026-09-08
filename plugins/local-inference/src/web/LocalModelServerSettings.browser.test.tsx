import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { LocalInferenceStatus } from "../contracts/schemas.js";
import { renderSettings, usageSnapshot } from "../test/render-local-model-server-settings.js";

afterEach(() => {
	cleanup();
});

describe("LocalModelServerSettings", () => {
	it("imports a selected GGUF model", async () => {
		const addModel = vi.fn(async ({ path }: { path: string }) => ({
			id: "tiny-a1b2c3d4",
			name: "Tiny",
			path,
			available: true,
			addedAt: 1,
		}));
		const { baseElement } = renderSettings(
			{
				"models.add": addModel,
				"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
				"usage.get": async () => usageSnapshot,
			},
			{ getPathForFile: (file) => `/models/${file.name}` },
		);
		const screen = page.elementLocator(baseElement);
		const picker = baseElement.querySelector<HTMLInputElement>(
			"[data-qa-id='local-model-server-file']",
		);
		expect(picker).not.toBeNull();
		const click = vi.spyOn(picker!, "click");

		await screen.getByRole("button", { name: "Add model" }).click();
		expect(click).toHaveBeenCalledOnce();

		Object.defineProperty(picker, "files", {
			configurable: true,
			value: [new File([], "tiny.gguf")],
		});
		picker!.dispatchEvent(new Event("change", { bubbles: true }));

		await expect.poll(() => addModel).toHaveBeenCalledWith({ path: "/models/tiny.gguf" });
	});

	it("starts a disconnected server", async () => {
		const connect = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "disconnected" }),
			"usage.get": async () => usageSnapshot,
			"runtime.connect": connect,
		});
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByRole("switch", { name: "Model server" });

		await expect.element(toggle).toBeEnabled();
		await expect.element(toggle).toHaveAttribute("aria-checked", "false");
		await toggle.click();
		await expect.poll(() => connect).toHaveBeenCalledOnce();
	});

	it("stops an active server", async () => {
		const disconnect = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "ready" }),
			"usage.get": async () => usageSnapshot,
			"runtime.disconnect": disconnect,
		});
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByRole("switch", { name: "Model server" });

		await expect.element(toggle).toBeEnabled();
		await expect.element(toggle).toHaveAttribute("aria-checked", "true");
		await toggle.click();
		await expect.poll(() => disconnect).toHaveBeenCalledOnce();
	});

	it("refreshes the displayed status when the service emits a change", async () => {
		let currentStatus: LocalInferenceStatus = { status: "starting" };
		const statusGet = vi.fn(async () => currentStatus);
		const { baseElement, sdk } = renderSettings({
			"status.get": statusGet,
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Starting…", { exact: true })).toBeVisible();
		currentStatus = { status: "ready", loadedModelIds: [] };
		sdk.events.emit("status-changed", currentStatus);

		await expect.element(screen.getByText("Running", { exact: true })).toBeVisible();
		await expect.poll(() => statusGet.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("shows service errors and retries startup", async () => {
		const retry = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "error", message: "Runtime failed to start" }),
			"usage.get": async () => usageSnapshot,
			"runtime.retry": retry,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Error", { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole("alert").getByText("Runtime failed to start", { exact: true }))
			.toBeVisible();
		await screen.getByRole("button", { name: "Retry" }).click();
		await expect.poll(() => retry).toHaveBeenCalledOnce();
	});

	it("selects a model from the sidebar and shows whether each model is loaded", async () => {
		const removeModel = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
				},
				{
					id: "model-beta",
					name: "Beta 3B",
					path: "/models/beta.gguf",
					available: true,
					addedAt: 2,
				},
			],
			"status.get": async () => ({
				status: "ready",
				loadedModelIds: ["model-alpha"],
			}),
			"models.remove": removeModel,
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		const settingsCard = screen.getByTestId("local-model-settings-card");

		await expect
			.element(screen.getByTestId("local-model-status-model-alpha"))
			.toHaveAttribute("data-status", "loaded");
		await expect
			.element(screen.getByTestId("local-model-status-model-beta"))
			.toHaveAttribute("data-status", "not-loaded");
		await expect.element(settingsCard).toHaveAttribute("data-model-id", "model-alpha");

		await screen.getByTestId("local-model-title-model-beta").hover();
		await expect
			.element(screen.getByTestId("local-model-path-model-beta"))
			.toHaveTextContent("/models/beta.gguf");

		await screen.getByTestId("local-model-select-model-beta").click();

		await expect.element(settingsCard).toHaveAttribute("data-model-id", "model-beta");
		await expect
			.element(screen.getByTestId("local-model-select-model-beta"))
			.toHaveAttribute("aria-pressed", "true");
		const eject = screen.getByRole("button", { name: "Eject Beta 3B" });
		await expect.element(eject).toBeVisible();
		await eject.click();
		await expect.poll(() => removeModel).toHaveBeenCalledWith({ id: "model-beta" });
	});
});
