import type { LocalInferenceStatus } from "../../contracts/index";

export type ServerStatusPresentation = {
	label: string;
	indicatorClass: string;
	checked: boolean;
};

export function presentServerStatus(
	status: LocalInferenceStatus | undefined,
	pendingAction: "starting" | "stopping" | "retrying" | undefined,
	queryPending: boolean,
	queryError: boolean,
): ServerStatusPresentation {
	if (queryPending) {
		return {
			label: "Loading…",
			indicatorClass: "bg-muted-foreground/50 animate-pulse",
			checked: false,
		};
	}
	if (queryError || status === undefined) {
		return { label: "Unavailable", indicatorClass: "bg-destructive", checked: false };
	}
	if (status.status === "preparing-runtime") {
		return {
			label: "Installing llama.cpp…",
			indicatorClass: "bg-warning animate-pulse",
			checked: true,
		};
	}
	if (pendingAction === "starting" || pendingAction === "retrying") {
		return { label: "Starting…", indicatorClass: "bg-warning animate-pulse", checked: true };
	}
	if (pendingAction === "stopping") {
		return { label: "Stopping…", indicatorClass: "bg-warning animate-pulse", checked: true };
	}

	switch (status.status) {
		case "idle":
			return { label: "Idle", indicatorClass: "bg-muted-foreground/50", checked: true };
		case "starting":
			return { label: "Starting…", indicatorClass: "bg-warning animate-pulse", checked: true };
		case "loading-model":
			return {
				label: "Loading model…",
				indicatorClass: "bg-warning animate-pulse",
				checked: true,
			};
		case "ready":
			return { label: "Running", indicatorClass: "bg-success", checked: true };
		case "error":
			return { label: "Error", indicatorClass: "bg-destructive", checked: true };
		case "stopping":
			return { label: "Stopping…", indicatorClass: "bg-warning animate-pulse", checked: true };
		case "disconnected":
			return { label: "Stopped", indicatorClass: "bg-muted-foreground/50", checked: false };
		default: {
			const exhaustive: never = status;
			return exhaustive;
		}
	}
}
