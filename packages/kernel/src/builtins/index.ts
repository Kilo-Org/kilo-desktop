import type { ContextKeyRecord } from "../discovery";
import type { PluginDefinitions } from "../plugin";
import { KERNEL_DOMAIN_OBJECTS, KernelWindow } from "./domain-objects";
import { KERNEL_EXTENSION_POINTS } from "./extension-points";
import { KernelFlag, KernelFlags, KernelFlagSource } from "./flags";
import { KernelIdentity, KernelIdentityProvider, KernelLinkedAccount } from "./identity";
import { KernelTelemetry, KernelTelemetryEvent, KernelTelemetrySink } from "./telemetry";

export * from "./domain-objects";
export * from "./extension-points";
export * from "./flags";
export * from "./identity";
export * from "./telemetry";

const kernelKey = (
	id: string,
	scope: "global" | "window",
	description: string,
): ContextKeyRecord => ({ id: `kernel/${id}`, owner: "kernel", scope, description });

/** Context keys owned by the kernel. */
export const KERNEL_CONTEXT_KEYS: readonly ContextKeyRecord[] = [
	kernelKey("desktop", "global", "The app runs in Electron, not a standalone browser."),
	kernelKey("mac", "global", "The app runs on macOS."),
	kernelKey("windows", "global", "The app runs on Windows."),
	kernelKey("linux", "global", "The app runs on Linux."),
	kernelKey("safeMode", "global", "The app started in safe mode, with no plugins."),
	kernelKey("flag:*", "global", "True while the named feature flag (`kernel/flags`) is `true`."),
	kernelKey("secondaryWindow", "window", "This window is a secondary window, not the main one."),
];

export const KERNEL_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		...KERNEL_EXTENSION_POINTS,
		KernelIdentityProvider,
		KernelLinkedAccount,
		KernelFlag,
		KernelFlagSource,
		KernelTelemetryEvent,
		KernelTelemetrySink,
	],
	domainObjects: [...KERNEL_DOMAIN_OBJECTS, KernelIdentity, KernelFlags, KernelTelemetry],
	objectTypes: [KernelWindow],
};
