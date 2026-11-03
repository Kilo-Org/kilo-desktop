import type { ContextKeyRecord } from "../discovery";
import type { PluginDefinitions } from "../plugin";
import { KERNEL_DOMAINS } from "./domains";
import { KERNEL_POINTS } from "./points";

export * from "./domains";
export * from "./points";

/** Context keys owned by the kernel. */
export const KERNEL_CONTEXT_KEYS: readonly ContextKeyRecord[] = [
	{ id: "kernel/desktop", owner: "kernel", scope: "global" },
	{ id: "kernel/mac", owner: "kernel", scope: "global" },
	{ id: "kernel/windows", owner: "kernel", scope: "global" },
	{ id: "kernel/linux", owner: "kernel", scope: "global" },
	{ id: "kernel/safeMode", owner: "kernel", scope: "global" },
	{ id: "kernel/secondaryWindow", owner: "kernel", scope: "window" },
];

export const KERNEL_DEFINITIONS: PluginDefinitions = {
	extensionPoints: KERNEL_POINTS,
	domains: KERNEL_DOMAINS,
};
