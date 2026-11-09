import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { testPlugin } from "@kilo-desktop/kernel/testing";
import { useExtensions } from "@kilo-desktop/kernel/web";
import { ModelSource } from "@kilo-desktop/plugin-chat/contracts";
import { Overlay, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";

import type { LocalModel } from "../contracts/index.js";
import {
	bootLocalInferenceHost,
	type LocalInferenceHostOptions,
} from "../test/local-inference-host.js";
import { localInferenceWebEntry } from "./index.js";

const WAIT = { timeout: 10_000 };

const chatPoints = testPlugin("kilo.chat", {
	manifest: { extensionPoints: [{ id: "model-source", kind: "additive" }] },
	definitions: { extensionPoints: [ModelSource] },
});

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
		plugins: [chatPoints],
	});
}

function SourceProbe() {
	const [source] = useExtensions(ModelSource);
	const state = source!.implementation!.useState();
	return (
		<div data-qa-id="source-probe">
			{state.pending ? "pending" : `${state.status?.status}:${state.modelIds.join(",")}`}
		</div>
	);
}

describe("kilo.local-inference's renderer entry", () => {
	it("contributes the Local Model Server settings section and loading toast", async () => {
		const host = await boot();

		expect(host.renderer.extensions.list(SettingsSection).map((entry) => entry.key)).toEqual([
			"kilo.local-inference/local-model-server",
		]);
		expect(host.renderer.extensions.list(Overlay).map((entry) => entry.key)).toEqual([
			"kilo.local-inference/model-loading",
		]);
	});

	it("is the composer's model source: state, start and prepare", async () => {
		const connect = vi.fn(async () => ({ ok: true }));
		const prepare = vi.fn(async () => ({ ok: true }));
		const host = await boot({ connect, prepare });
		const [source] = host.renderer.extensions.list(ModelSource);
		expect(source!.metadata).toEqual({
			providerId: "kilo-desktop-model-server",
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

	it("opens its settings section when the agent asks", async () => {
		const host = await boot();

		await host.requestSettings();

		await vi.waitFor(() => expect(host.settingsOpened).toEqual(["local-model-server"]), WAIT);
	});

	it("shows a loading toast while a model loads for a prompt", async () => {
		const host = await boot();
		const [overlay] = host.renderer.extensions.list(Overlay);
		const Toast = overlay!.implementation!;
		host.render(
			<>
				<Toaster />
				<Toast />
			</>,
		);

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
