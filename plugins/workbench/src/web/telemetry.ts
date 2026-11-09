import type { DomainHandle, PluginSdk } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";

/**
 * kilo.workbench's telemetry events (declared as kilo.telemetry/telemetry-event
 * in plugin.json, with origin's names and payloads). They are sent only from
 * what a person does — launching, closing, toggling, choosing a preset — never
 * from layout syncs, the default layout or a preset's own pane opens.
 */
export type WorkbenchEvent =
	| "Pane Opened"
	| "Pane Closed"
	| "Layout Arrangement Changed"
	| "Layout Preset Applied"
	| "Layout Preset Saved"
	| "Layout Preset Removed"
	| "Layout Preset Default Changed";

export type TrackWorkbench = (event: WorkbenchEvent, data?: Record<string, unknown>) => void;

type TelemetryHandle = DomainHandle<typeof Telemetry> | null | undefined;

const BUNDLED_KIND = /^kilo\.([a-z0-9-]+)\/([a-z0-9-]+)$/;

/**
 * A pane kind as origin's `paneType` named it (`<feature>.<tab>`, the agent
 * pane `chat`), so the events continue origin's series; other plugins' kinds
 * are reported as they are.
 */
export function paneTypeOf(kind: string): string {
	if (kind === "kilo.chat/agent") return "chat";
	const bundled = BUNDLED_KIND.exec(kind);
	return bundled ? `${bundled[1]}.${bundled[2]}` : kind;
}

function trackWith(telemetry: () => TelemetryHandle): TrackWorkbench {
	return (event, data = {}) =>
		void telemetry()
			?.methods.track({ event, data })
			.catch(() => undefined);
}

/** Sends workbench events from a window's commands; never fails the caller. */
export function workbenchTelemetry(sdk: PluginSdk): TrackWorkbench {
	return trackWith(() => sdk.domains.get(Telemetry));
}

/** Sends workbench events from a component; never fails the caller. */
export function useWorkbenchTelemetry(): TrackWorkbench {
	const telemetry = useDomain(Telemetry);
	return trackWith(() => telemetry);
}
