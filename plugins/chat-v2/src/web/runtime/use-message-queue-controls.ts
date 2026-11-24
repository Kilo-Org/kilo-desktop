import { useAuiState } from "@assistant-ui/react";
import type { OpenCodeMessageQueueControls } from "@kilo-desktop/react-opencode-v2";

const CONTROL_METHODS = [
	"pause",
	"resume",
	"reorder",
	"beginEdit",
	"setEditDraft",
	"getEditDraft",
	"commitEdit",
	"cancelEdit",
] as const satisfies readonly (keyof OpenCodeMessageQueueControls)[];

/**
 * Duck-types the queue controls the patched OpenCode runtime publishes on
 * `thread.extras.messageQueue`. Non-OpenCode and test runtimes have none, so
 * the queue shelf falls back to send-now/delete only.
 */
function selectMessageQueueControls(extras: unknown): OpenCodeMessageQueueControls | undefined {
	if (typeof extras !== "object" || extras === null) return undefined;
	const candidate = (extras as { messageQueue?: unknown }).messageQueue;
	if (typeof candidate !== "object" || candidate === null) return undefined;
	const controls = candidate as Partial<OpenCodeMessageQueueControls>;
	if (typeof controls.paused !== "boolean") return undefined;
	if (!CONTROL_METHODS.every((method) => typeof controls[method] === "function")) return undefined;
	return controls as OpenCodeMessageQueueControls;
}

export function useMessageQueueControls(): OpenCodeMessageQueueControls | undefined {
	return useAuiState((s) => selectMessageQueueControls(s.thread.extras));
}
