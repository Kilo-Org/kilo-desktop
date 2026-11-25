import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, type KernelLogger } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, useExtensions } from "@kilo-desktop/kernel/web";
import { ModelSource } from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection, StatusBarItem } from "@kilo-desktop/plugin-shell/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { LOCAL_INFERENCE_DEFINITIONS, type LocalModel } from "../contracts/index";
import {
	bootLocalInferenceHost,
	type LocalInferenceHostOptions,
} from "../test/local-inference-host";
import { localInferenceWebEntry, LocalModelServerSettings } from "./index";
import { LocalModelLoadingToast } from "./LocalModelLoadingToast";

const WAIT = { timeout: 10_000 };

const MODEL: LocalModel = {
	id: "qwen-1",
	name: "Qwen 3 (Q4_K_M)",
	path: "/models/qwen.gguf",
	available: true,
	addedAt: 1,
	catalog: { modelId: "qwen", quantizationId: "q4" },
};

function boot(handlers: LocalInferenceHostOptions["handlers"] = {}) {
	return bootLocalInferenceHost({
		handlers,
		webEntry: localInferenceWebEntry,
	});
}

function SourceProbe() {
	const [source] = useExtensions(ModelSource);
	const { State } = source!.implementation!;
	return (
		<State>
			{(state) => (
				<div data-qa-id="source-probe">
					{state.pending ? "pending" : `${state.status?.status}:${state.modelIds.join(",")}`}
				</div>
			)}
		</State>
	);
}

describe("kilo.local-inference's renderer entry", () => {
	it("contributes the Local Model Server settings section and loading toast", async () => {
		const host = await boot();

		expect(host.renderer.extensions.list(SettingsSection).map((entry) => entry.key)).toEqual([
			"kilo.local-inference/local-model-server",
		]);
		expect(host.renderer.extensions.list(StatusBarItem).map((entry) => entry.key)).toEqual([
			"kilo.local-inference/model-loading",
		]);
	});

	it("is the composer's model source: state, start and prepare", async () => {
		const connect = vi.fn(async () => ({ ok: true }));
		const prepare = vi.fn(async () => ({ ok: true }));
		const host = await boot({ connect, prepare });
		const [source] = host.renderer.extensions.list(ModelSource);
		expect(source!.metadata).toEqual({
			aiProviderId: "kilo-desktop-model-server",
			title: "Local Model Server",
			settingsSection: "local-model-server",
		});

		host.render(<SourceProbe />);
		await expect.element(page.getByTestId("source-probe"), WAIT).toHaveTextContent("idle:");
		await host.update({
			status: { status: "ready", loadedModelIds: [] },
			models: [MODEL, { ...MODEL, id: "gone", available: false }],
		});
		await expect.element(page.getByTestId("source-probe"), WAIT).toHaveTextContent("ready:qwen-1");

		await source!.implementation!.start!();
		await source!.implementation!.prepare!("qwen-1");
		expect(connect).toHaveBeenCalledOnce();
		expect(prepare).toHaveBeenCalledWith({ modelId: "qwen-1" });
	});

	it("shows a loading toast while a model loads for a prompt", async () => {
		const host = await boot();
		const [item] = host.renderer.extensions.list(StatusBarItem);
		const implementation = item!.implementation!;
		if (implementation.kind !== "view") throw new Error("Expected a status bar view.");
		const Toast = implementation.Component;
		host.render(<Toast />);

		await host.update({
			models: [MODEL],
			status: { status: "loading-model", modelId: "qwen-1", loadedModelIds: [] },
		});

		await expect.element(page.getByText("Loading model..."), WAIT).toBeVisible();
		await expect.element(page.getByText("Qwen 3", { exact: true })).toBeVisible();
		await host.update({ status: { status: "ready", loadedModelIds: ["qwen-1"] } });
		await expect.element(page.getByText("Loading model..."), WAIT).not.toBeInTheDocument();
	});
});

describe("kilo.local-inference's renderer entry without other plugins", () => {
	it("activates and shows its page without errors when kilo.core, kilo.shell and kilo.chat are absent", async () => {
		const errors: unknown[][] = [];
		const logger: KernelLogger = {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: (...args: unknown[]) => void errors.push(args),
		};
		const { main, renderer } = await createTestKernelPair({
			main: [
				{
					manifest,
					definitions: LOCAL_INFERENCE_DEFINITIONS,
					entry: definePlugin({ activate: () => {} }),
				},
			],
			renderer: [
				{ manifest, definitions: LOCAL_INFERENCE_DEFINITIONS, entry: localInferenceWebEntry },
			],
			logger,
		});
		await main.flush();

		expect(renderer.extensions.list(StatusBarItem)).toEqual([]);
		render(
			<KernelProvider kernel={renderer} as={manifest.id}>
				<QueryClientProvider
					client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
				>
					<TooltipProvider>
						<LocalModelLoadingToast />
						<LocalModelServerSettings />
					</TooltipProvider>
				</QueryClientProvider>
			</KernelProvider>,
		);
		await expect.element(page.getByTestId("local-model-server-page"), WAIT).toBeVisible();
		await expect.element(page.getByTestId("local-model-server-error"), WAIT).toBeVisible();
		expect(errors).toEqual([]);
	});
});
