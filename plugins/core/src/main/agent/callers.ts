import { KERNEL_OWNER, KernelError, type DomainObjectCaller } from "@kilo-desktop/kernel";

import { CORE_PLUGIN_ID } from "../../contracts";

/**
 * A guard for domain object methods that hand out control of the agent: it
 * refuses every caller but kilo.core itself, the main kernel and `plugins`.
 * The kernel's permissions cover only host primitives, so these methods check
 * their caller themselves.
 */
export function onlyCallers(
	plugins: readonly string[],
	refusal: string,
): (caller: DomainObjectCaller) => void {
	const allowed = new Set([CORE_PLUGIN_ID, ...plugins]);
	return (caller) => {
		if (allowed.has(caller.pluginId)) return;
		if (caller.pluginId === KERNEL_OWNER && caller.process === "main") return;
		throw new KernelError("PERMISSION_DENIED", refusal);
	};
}

/** Sends prompts the person queued, on their behalf (kilo.chat's prompt queue). */
export const PROMPTING_PLUGINS = ["kilo.chat"] as const;

/** Answers the agent's permission requests and questions for the person (auto-approve, cards). */
export const PROMPT_ANSWERING_PLUGINS = ["kilo.chat"] as const;

/** Change external AI apps: pairing hands out a token. kilo.shell draws their settings page. */
export const EXTERNAL_APPS_SETTINGS_PLUGINS = ["kilo.shell"] as const;
