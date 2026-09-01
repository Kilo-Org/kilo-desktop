import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { LocalModelLoadingToast } from "./LocalModelLoadingToast.js";

const toastApi = vi.hoisted(() => ({
	loading: vi.fn(),
	dismiss: vi.fn(),
}));

vi.mock("@anaconda-agentic-desktop/ui/components/sonner", () => ({
	toast: toastApi,
}));

function renderToast(
	status: unknown = { status: "idle" },
	models: ReadonlyArray<{ modelID: string; name: string }> = [],
) {
	const localInference = createFakeSdk({
		featureId: "local-inference",
		invoke: async (channel) => {
			if (channel === "status.get") return status;
			throw new Error(`Unexpected channel "${channel}"`);
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "local-inference": localInference } });
	render(
		<SdkProvider system={system}>
			<LocalModelLoadingToast models={models} />
		</SdkProvider>,
	);
	return { localInference };
}

afterEach(() => {
	cleanup();
	toastApi.loading.mockReset();
	toastApi.dismiss.mockReset();
});

describe("LocalModelLoadingToast", () => {
	it("stays hidden while the router is coming up", async () => {
		renderToast({ status: "starting" });

		await expect.poll(() => toastApi.dismiss.mock.calls.length).toBeGreaterThan(0);
		expect(toastApi.loading).not.toHaveBeenCalled();
	});

	it("shows a loading toast with the catalog name and dismisses when ready", async () => {
		const { localInference } = renderToast({ status: "idle" }, [
			{ modelID: "qwen-3", name: "Qwen 3" },
		]);
		await expect.poll(() => toastApi.dismiss.mock.calls.length).toBeGreaterThan(0);
		expect(toastApi.loading).not.toHaveBeenCalled();

		localInference.events.emit("status-changed", { status: "loading-model", modelId: "qwen-3" });
		await expect.poll(() => toastApi.loading.mock.calls.length).toBe(1);
		expect(toastApi.loading).toHaveBeenCalledWith(
			"Loading model...",
			expect.objectContaining({
				id: "local-model-loading",
				description: "Qwen 3",
				closeButton: true,
				duration: Number.POSITIVE_INFINITY,
			}),
		);

		toastApi.dismiss.mockClear();
		localInference.events.emit("status-changed", { status: "ready", loadedModelId: "qwen-3" });
		await expect.poll(() => toastApi.dismiss.mock.calls.length).toBeGreaterThan(0);
		expect(toastApi.dismiss).toHaveBeenCalledWith("local-model-loading");
	});

	it("stays hidden after dismiss until the next load cycle", async () => {
		const { localInference } = renderToast({
			status: "loading-model",
			modelId: "qwen-3",
		});
		await expect.poll(() => toastApi.loading.mock.calls.length).toBe(1);

		const options = toastApi.loading.mock.calls[0]?.[1] as { onDismiss?: () => void };
		await act(() => {
			options.onDismiss?.();
		});
		await expect.poll(() => toastApi.dismiss.mock.calls.length).toBeGreaterThan(0);

		toastApi.loading.mockClear();
		await act(() => {
			localInference.events.emit("status-changed", { status: "starting" });
		});
		expect(toastApi.loading).not.toHaveBeenCalled();

		await act(() => {
			localInference.events.emit("status-changed", { status: "ready" });
		});
		expect(toastApi.loading).not.toHaveBeenCalled();

		await act(() => {
			localInference.events.emit("status-changed", { status: "loading-model", modelId: "qwen-3" });
		});
		expect(toastApi.loading).toHaveBeenCalledOnce();
	});

	it("hides on error and idle", async () => {
		const { localInference } = renderToast({
			status: "loading-model",
			modelId: "qwen-3",
		});
		await expect.poll(() => toastApi.loading.mock.calls.length).toBe(1);

		toastApi.dismiss.mockClear();
		localInference.events.emit("status-changed", { status: "error", message: "failed" });
		await expect.poll(() => toastApi.dismiss.mock.calls.length).toBeGreaterThan(0);

		toastApi.loading.mockClear();
		localInference.events.emit("status-changed", { status: "idle" });
		await expect.poll(() => toastApi.loading.mock.calls.length).toBe(0);
	});
});
