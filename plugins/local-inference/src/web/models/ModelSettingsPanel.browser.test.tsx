import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { LocalModel, LocalModelSettings } from "../../contracts/index.js";
import {
	expandModel,
	renderSettings,
	usageSnapshot,
} from "../../test/render-local-model-server-settings.js";

afterEach(() => {
	cleanup();
});

describe("ModelSettingsPanel", () => {
	it("shows and saves context length and temperature for an expanded model", async () => {
		const updateModel = vi.fn(async ({ id, settings }) => ({
			id,
			name: "Alpha 8B",
			path: "/models/alpha.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					settings: { contextLength: 8192, temperature: 0.4 },
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		const contextLength = screen.getByRole("group", { name: "Context length" }).getByRole("slider");
		const contextLengthInput = screen.getByLabelText("Context length in tokens");
		const temperature = screen.getByRole("group", { name: "Temperature" }).getByRole("slider");
		const temperatureInput = screen.getByLabelText("Temperature value");

		await expect
			.element(screen.getByRole("region", { name: "Alpha 8B model settings" }))
			.toBeVisible();
		await expect.element(contextLengthInput).toHaveValue(8192);
		await expect.element(contextLength).toHaveAttribute("aria-valuenow", "13");
		await expect.element(temperatureInput).toHaveValue(0.4);
		await expect.element(temperature).toHaveAttribute("aria-valuenow", "0.4");

		temperature.element().focus();
		await userEvent.keyboard("{ArrowRight}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenCalledWith({
				id: "model-alpha",
				settings: { contextLength: 8192, temperature: 0.5 },
			});

		await expect.element(contextLength).toBeEnabled();
		contextLength.element().focus();
		await userEvent.keyboard("{ArrowRight}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({
				id: "model-alpha",
				settings: { contextLength: 16384, temperature: 0.5 },
			});
		await expect.element(contextLengthInput).toHaveValue(16384);

		await contextLengthInput.fill("12288");
		contextLengthInput.element().focus();
		await userEvent.keyboard("{Enter}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({
				id: "model-alpha",
				settings: { contextLength: 12288, temperature: 0.5 },
			});

		await temperatureInput.fill("0.7");
		temperatureInput.element().focus();
		await userEvent.keyboard("{Enter}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({
				id: "model-alpha",
				settings: { contextLength: 12288, temperature: 0.7 },
			});
	});

	it("shows llama.cpp defaults as automatic values and can reset an override", async () => {
		const updateModel = vi.fn(
			async ({ id, settings }: { id: string; settings: LocalModelSettings }) => ({
				id,
				name: "Alpha 8B",
				path: "/models/alpha.gguf",
				available: true,
				addedAt: 1,
				settings,
			}),
		);
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		const contextLength = screen.getByLabelText(
			"Context length in tokens, automatic: Model default",
		);
		const temperature = screen.getByLabelText("Temperature value, automatic: 0.8");
		const maxTokens = screen.getByLabelText("Max tokens value, automatic: Unlimited");

		await expect.element(contextLength).toHaveValue(null);
		await expect.element(contextLength).toHaveAttribute("placeholder", "Model default");
		await expect.element(temperature).toHaveValue(null);
		await expect.element(temperature).toHaveAttribute("placeholder", "0.8");
		await expect.element(maxTokens).toHaveValue(null);
		await expect.element(maxTokens).toHaveAttribute("placeholder", "Unlimited");
		await expect.element(screen.getByText("Automatic", { exact: true })).not.toBeInTheDocument();

		await temperature.fill("0.6");
		temperature.element().blur();
		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({ id: "model-alpha", settings: { temperature: 0.6 } });

		await screen.getByRole("button", { name: "Reset Temperature to automatic" }).click();
		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({ id: "model-alpha", settings: {} });
	});

	it("keeps settings interactive and serializes changes while autosaving", async () => {
		let resolveFirstSave: ((model: LocalModel) => void) | undefined;
		let saveCount = 0;
		const updateModel = vi.fn(({ id, settings }: { id: string; settings: LocalModelSettings }) => {
			saveCount += 1;
			const model = {
				id,
				name: "Alpha 8B",
				path: "/models/alpha.gguf",
				available: true,
				addedAt: 1,
				settings,
			};
			if (saveCount > 1) return Promise.resolve(model);
			return new Promise<LocalModel>((resolve) => {
				resolveFirstSave = resolve;
			});
		});
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					settings: { contextLength: 4096, temperature: 0.4 },
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		const temperature = screen.getByLabelText("Temperature value");
		const contextLength = screen.getByLabelText("Context length in tokens");

		await temperature.fill("0.6");
		temperature.element().blur();
		await expect.poll(() => updateModel).toHaveBeenCalledTimes(1);
		await expect.element(temperature).toBeEnabled();
		await expect.element(contextLength).toBeEnabled();

		await contextLength.fill("8192");
		contextLength.element().blur();
		expect(updateModel).toHaveBeenCalledTimes(1);

		const firstSettings = updateModel.mock.calls[0]?.[0].settings;
		resolveFirstSave?.({
			id: "model-alpha",
			name: "Alpha 8B",
			path: "/models/alpha.gguf",
			available: true,
			addedAt: 1,
			settings: firstSettings,
		});
		await expect.poll(() => updateModel).toHaveBeenCalledTimes(2);
		expect(updateModel).toHaveBeenLastCalledWith({
			id: "model-alpha",
			settings: { contextLength: 8192, temperature: 0.6 },
		});
	});

	it("groups model settings into tabs that flag customized values", async () => {
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					settings: { topP: 0.9, topK: 50 },
				},
			],
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		const details = await expandModel(baseElement, "model-alpha");
		const general = details.getByRole("tab", { name: "General" });
		const sampling = details.getByRole("tab", { name: /^Sampling/ });
		const advanced = details.getByRole("tab", { name: "Advanced" });

		await expect.element(general).toHaveAttribute("aria-selected", "true");
		await expect.element(sampling).toHaveAttribute("aria-selected", "false");
		await expect.element(advanced).toHaveAttribute("aria-selected", "false");
		await expect.element(sampling).toHaveAccessibleName("Sampling, 2 customized");
		await expect.element(general).toHaveAccessibleName("General");
		await expect
			.element(
				screen.getByText(
					"Off by default for faster local inference. Turn on to give this model the coding instructions and tools available in chat.",
				),
			)
			.toBeVisible();
		await expect
			.element(screen.getByText("Larger contexts use more memory and may reduce generation speed."))
			.not.toBeInTheDocument();

		await screen.getByRole("button", { name: "About Context length" }).hover();
		await expect
			.element(screen.getByText("Larger contexts use more memory and may reduce generation speed."))
			.toBeVisible();

		await sampling.click();

		await expect.element(sampling).toHaveAttribute("aria-selected", "true");
		await expect.element(screen.getByLabelText("Top P value")).toHaveValue(0.9);
		await expect
			.element(screen.getByLabelText(/^Context length in tokens/))
			.not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Reset Top K to automatic" }).click();
		await expect.element(sampling).toHaveAccessibleName("Sampling, 1 customized");
	});

	it("shows and saves an expanded model's llama.cpp sampling settings", async () => {
		const updateModel = vi.fn(async ({ id, settings }) => ({
			id,
			name: "Alpha 8B",
			path: "/models/alpha.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const initialSettings = {
			topP: 0.9,
			topK: 64,
			minP: 0.05,
			repeatPenalty: 1.1,
			presencePenalty: 0.2,
			maxResponseTokens: 2048,
		};
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					settings: initialSettings,
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		await expect.element(screen.getByLabelText("Max tokens value")).toHaveValue(2048);
		await screen.getByRole("tab", { name: /^Sampling/ }).click();

		await expect.element(screen.getByLabelText("Top P value")).toHaveValue(0.9);
		await expect.element(screen.getByLabelText("Top K value")).toHaveValue(64);
		await expect.element(screen.getByLabelText("Min P value")).toHaveValue(0.05);
		await expect.element(screen.getByLabelText("Repetition penalty value")).toHaveValue(1.1);
		await expect.element(screen.getByLabelText("Presence penalty value")).toHaveValue(0.2);

		const topP = screen.getByRole("group", { name: "Top P" }).getByRole("slider");
		topP.element().focus();
		await userEvent.keyboard("{ArrowRight}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({
				id: "model-alpha",
				settings: { ...initialSettings, topP: 0.91 },
			});

		await screen.getByRole("tab", { name: /^General/ }).click();
		const maxTokens = screen.getByLabelText("Max tokens value");
		await maxTokens.fill("4096");
		maxTokens.element().focus();
		await userEvent.keyboard("{Enter}");

		await expect
			.poll(() => updateModel)
			.toHaveBeenLastCalledWith({
				id: "model-alpha",
				settings: { ...initialSettings, topP: 0.91, maxResponseTokens: 4096 },
			});
	});

	it("saves whether an expanded model receives coding tools and instructions", async () => {
		const updateModel = vi.fn(async ({ id, settings }) => ({
			id,
			name: "Alpha 8B",
			path: "/models/alpha.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		const contextAndTools = screen.getByRole("switch", {
			name: "Coding tools and instructions",
		});

		await expect.element(contextAndTools).toHaveAttribute("aria-checked", "false");
		await contextAndTools.click();

		await expect.element(contextAndTools).toHaveAttribute("aria-checked", "true");
		await expect
			.poll(() => updateModel)
			.toHaveBeenCalledWith({
				id: "model-alpha",
				settings: { includeKiloContext: true },
			});
	});

	it("saves pasted llama.cpp extra arguments for an expanded model", async () => {
		const updateModel = vi.fn(async ({ id, settings }) => ({
			id,
			name: "Alpha 8B",
			path: "/models/alpha.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = await renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					settings: { llamaFlags: { "flash-attn": "on" } },
				},
			],
			"models.update": updateModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expandModel(baseElement, "model-alpha");
		await screen.getByRole("tab", { name: /^Advanced/ }).click();
		const extraArguments = screen.getByLabelText("Extra Arguments");

		await expect.element(extraArguments).toHaveValue("--flash-attn on");
		await expect
			.element(
				screen.getByText(
					"Paste llama.cpp flags exactly as you would on the command line. Matching values override the model settings in the other tabs; app-managed flags are refused.",
				),
			)
			.toBeVisible();
		await extraArguments.fill(
			"--kv-unified --swa-full --flash-attn on --n-gpu-layers 99 --cache-ram -1 --ctx-size 16384 --temp 0.4",
		);
		extraArguments.element().blur();

		await expect
			.poll(() => updateModel)
			.toHaveBeenCalledWith({
				id: "model-alpha",
				settings: {
					llamaFlags: {
						"cache-ram": "-1",
						"ctx-size": "16384",
						"flash-attn": "on",
						"kv-unified": "true",
						"n-gpu-layers": "99",
						"swa-full": "true",
						temp: "0.4",
					},
				},
			});
	});
});
