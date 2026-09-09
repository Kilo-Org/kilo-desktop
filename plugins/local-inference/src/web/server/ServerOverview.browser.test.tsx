import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	connection,
	renderSettings,
	usageSnapshot,
} from "../../test/render-local-model-server-settings.js";
import { usageIndicatorClass } from "./SystemMonitor.js";

afterEach(() => {
	cleanup();
});

describe("Local model server overview", () => {
	it("shows system usage and the server connection details", async () => {
		const copyText = vi.fn(async () => undefined);
		const { baseElement } = renderSettings(
			{
				"status.get": async () => ({ status: "ready", connection }),
				"usage.get": async () => usageSnapshot,
			},
			{ copyText },
		);
		const screen = page.elementLocator(baseElement);
		const cpu = screen.getByTestId("local-model-server-usage-cpu");
		const ram = screen.getByTestId("local-model-server-usage-ram");
		const gpu = screen.getByTestId("local-model-server-usage-gpu");

		await expect.element(screen.getByRole("heading", { name: "System Monitor" })).toBeVisible();
		await expect.element(cpu.getByText("48%", { exact: true })).toBeVisible();
		await expect.element(cpu.getByText("System usage", { exact: true })).toBeVisible();
		await expect.element(cpu.getByText(/GHz/)).not.toBeInTheDocument();
		await expect.element(ram.getByText("10 GB / 16 GB", { exact: true })).toBeVisible();
		await expect.element(ram.getByText("63%", { exact: true })).toBeVisible();
		await expect.element(ram.getByText("6.0 GB free", { exact: true })).toBeVisible();
		await expect.element(gpu.getByText("4.0 GB / 8.0 GB", { exact: true })).toBeVisible();
		await expect.element(gpu.getByText("50%", { exact: true })).toBeVisible();
		await expect.element(gpu.getByText("4.0 GB free", { exact: true })).toBeVisible();
		await expect
			.element(
				screen.getByRole("region", { name: "System Monitor" }).getByText("Server", { exact: true }),
			)
			.not.toBeInTheDocument();

		await expect.element(screen.getByRole("heading", { name: "Connect" })).toBeVisible();
		await expect
			.element(screen.getByLabelText("Server Address"))
			.toHaveValue("http://127.0.0.1:59632/v1");
		await screen.getByRole("button", { name: "Copy server address" }).click();
		await expect.poll(() => copyText).toHaveBeenCalledWith("http://127.0.0.1:59632/v1");
		const apiKey = screen.getByLabelText("API Key");
		await expect.element(apiKey).toHaveValue("local-secret");
		await expect.element(apiKey).toHaveAttribute("type", "password");
		await screen.getByRole("button", { name: "Show api key" }).click();
		await expect.element(apiKey).toHaveAttribute("type", "text");
		await screen.getByRole("button", { name: "Copy api key" }).click();
		await expect.poll(() => copyText).toHaveBeenCalledWith("local-secret");

		const requestInfo = screen.getByRole("button", { name: "Request info" });
		await expect.element(requestInfo).toBeEnabled();
		await requestInfo.click();
		const requestPopover = page.getByTestId("local-model-server-request-info");
		await expect
			.element(requestPopover.getByRole("heading", { name: "Request information" }))
			.toBeVisible();
		await expect.element(requestPopover.getByRole("button", { name: /List models/ })).toBeVisible();
		await expect
			.element(requestPopover.getByRole("button", { name: /Chat completions/ }))
			.toBeVisible();
		await expect
			.element(requestPopover.getByRole("button", { name: /Streaming completions/ }))
			.toBeVisible();

		await requestPopover.getByRole("button", { name: /Chat completions/ }).click();
		await expect
			.element(requestPopover.getByLabelText("Chat completions URL"))
			.toHaveValue("http://127.0.0.1:59632/v1/chat/completions");
		await requestPopover.getByRole("button", { name: "Copy Chat completions curl" }).click();
		await expect
			.poll(() => copyText)
			.toHaveBeenCalledWith(
				'curl -sS -X POST \'http://127.0.0.1:59632/v1/chat/completions\' -H \'Authorization: Bearer local-secret\' -H \'Content-Type: application/json\' -d \'{"model":"model-id","messages":[{"role":"user","content":"Hello!"}]}\'',
			);

		await expect.element(screen.getByRole("heading", { name: "Models" })).toBeVisible();
		await expect
			.element(screen.getByText("Manage local models and configure how each one runs."))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Add model" })).toBeEnabled();
	});

	it("shows server settings on the page and automatically saves changes", async () => {
		const update = vi.fn(async (settings) => settings);
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "ready" }),
			"usage.get": async () => usageSnapshot,
			"settings.get": async () => ({
				port: 8080,
				modelLoadMode: "all",
				llamaFlags: { timeout: "120" },
			}),
			"settings.update": update,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Runtime" })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Server settings" }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByLabelText("Server Port")).toHaveValue(8080);
		const modelLoadMode = screen.getByRole("combobox", { name: "Models kept loaded" });
		await expect.element(modelLoadMode.getByText("All models", { exact: true })).toBeVisible();
		const lan = screen.getByRole("switch", { name: "Serve on Local Network" });
		await expect.element(lan).toHaveAttribute("aria-checked", "false");

		await screen.getByLabelText("Server Port").fill("9000");
		await modelLoadMode.click();
		await page.getByRole("option", { name: "One model" }).click();
		await lan.click();

		await expect
			.element(screen.getByRole("button", { name: "Save settings" }))
			.not.toBeInTheDocument();
		await expect.poll(() => update.mock.calls.length).toBe(1);
		await expect
			.poll(() => update)
			.toHaveBeenCalledWith({
				port: 9000,
				serveOnLocalNetwork: true,
				llamaFlags: { timeout: "120" },
			});
	});

	it("shows placeholders until usage is available", async () => {
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "ready" }),
			"usage.get": () => new Promise(() => undefined),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("region", { name: "System Monitor" })).toBeVisible();
		await expect.element(screen.getByText("Unavailable")).not.toBeInTheDocument();
	});
});

describe("usageIndicatorClass", () => {
	it("uses Unsloth's green, amber, and red usage thresholds", () => {
		expect(usageIndicatorClass(69.9)).toBe("bg-primary");
		expect(usageIndicatorClass(70)).toBe("bg-amber-500");
		expect(usageIndicatorClass(89.9)).toBe("bg-amber-500");
		expect(usageIndicatorClass(90)).toBe("bg-destructive");
	});
});
