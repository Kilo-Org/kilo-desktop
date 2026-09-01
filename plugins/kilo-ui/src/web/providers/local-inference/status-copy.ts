import type { LocalInferenceStatus } from "./contract.js";

function modelCountLabel(count: number): string {
	return `${count} ${count === 1 ? "model" : "models"}`;
}

export function localProviderStatusText(
	status: LocalInferenceStatus | undefined,
	extras: { modelName?: string | undefined; modelCount?: number } = {},
): string {
	if (!status) return "Add a GGUF model to use Local";
	switch (status.status) {
		case "preparing-runtime":
			return "Installing llama.cpp…";
		case "starting":
			return "Starting local server…";
		case "stopping":
			return "Stopping…";
		case "loading-model":
			return `Loading ${extras.modelName ?? "model"}…`;
		case "ready":
			return `Running (${modelCountLabel(extras.modelCount ?? 0)})`;
		case "error":
			return "Local server needs attention";
		case "disconnected":
			return `Stopped (${modelCountLabel(extras.modelCount ?? 0)} available)`;
		case "idle":
			return "Add a GGUF model to use Local";
		default: {
			const exhaustive: never = status;
			return exhaustive;
		}
	}
}
