import { KERNEL_OWNER, KernelError, type DomainCaller } from "@kilo-desktop/kernel";

import { AGENT_PLUGIN_ID } from "../contracts";

/**
 * A guard for domain methods that hand out control of the agent: it refuses
 * every caller but kilo.agent itself, the main kernel and `plugins`. The
 * kernel's domain permissions cover only host primitives, so these methods
 * check their caller themselves.
 */
export function onlyCallers(
	plugins: readonly string[],
	refusal: string,
): (caller: DomainCaller) => void {
	const allowed = new Set([AGENT_PLUGIN_ID, ...plugins]);
	return (caller) => {
		if (allowed.has(caller.pluginId)) return;
		if (caller.pluginId === KERNEL_OWNER && caller.process === "main") return;
		throw new KernelError("PERMISSION_DENIED", refusal);
	};
}

/**
 * The plugins handed the Kilo server's address and password, with which they
 * talk to it directly: the password drives every chat, so the list is explicit.
 */
export const SERVER_CLIENT_PLUGINS = ["kilo.chat", "kilo.account", "kilo.marketplace"] as const;

/** Answers the agent's permission requests and questions for the person (auto-approve, cards). */
export const PROMPT_ANSWERING_PLUGINS = ["kilo.chat"] as const;
