import { setTimeout as delay } from "node:timers/promises";

import { getPage } from "@anaconda/playwright-utils/page-utils";

/** Main's answer to a kernel bridge request (`TransportResult` in @kilo-desktop/kernel). */
type BridgeResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: unknown };

/** What `kernel:hydrate` returns: main-home domain object states and global context keys. */
export interface MainSnapshot {
	readonly domainObjects: readonly { readonly id: string; readonly state: unknown }[];
	readonly context: Readonly<Record<string, unknown>>;
}

/**
 * The caller a window may claim: a plugin with a window entry, or `"kernel"`
 * (which may use domain objects without a permission, or with one in
 * `WINDOW_KERNEL_PERMISSIONS`). Main-only plugins can't be claimed from a window.
 */
export const WINDOW_KERNEL_CALLER = "kernel";

async function request(channel: string, payload: unknown): Promise<unknown> {
	const result = await getPage().evaluate(
		async ({ channel, payload }) => {
			const bridge = (
				globalThis as {
					kernelBridge?: { request(channel: string, payload: unknown): Promise<unknown> };
				}
			).kernelBridge;
			if (!bridge) throw new Error("window.kernelBridge is missing");
			return bridge.request(channel, payload);
		},
		{ channel, payload },
	);
	const answer = result as BridgeResult;
	if (!answer.ok) throw new Error(`${channel} failed: ${JSON.stringify(answer.error)}`);
	return answer.value;
}

/** Calls a main-home domain object method from the window, as `caller`. */
export async function callDomainObject(options: {
	readonly domainId: string;
	readonly method: string;
	readonly input?: unknown;
	readonly caller?: string;
}): Promise<unknown> {
	return request("kernel:domain-call", {
		domainId: options.domainId,
		method: options.method,
		input: options.input,
		caller: options.caller ?? WINDOW_KERNEL_CALLER,
	});
}

/**
 * Main's current domain object states and context keys, read the way the
 * window's kernel hydrates. Reading state needs no caller, so it reaches
 * domain objects whose methods a window may not call (e.g. main-only plugins'
 * `homeCallersOnly` or client-restricted methods).
 *
 * Main also forgets what this window implements when it answers (it treats
 * the request as the window reloading), so commands and menu items kilo.shell's
 * window implements stop reaching it. Read through the UI or a method instead;
 * use this only for state with no UI, last, in a worker of its own.
 */
export async function readMainSnapshot(): Promise<MainSnapshot> {
	return (await request("kernel:hydrate", null)) as MainSnapshot;
}

/** One main-home domain object's state, or undefined while it is not provided. */
export async function readDomainObjectState(domainId: string): Promise<unknown> {
	const snapshot = await readMainSnapshot();
	return snapshot.domainObjects.find((entry) => entry.id === domainId)?.state;
}

/**
 * Polls a domain object's state until `accept` holds, failing after
 * `timeoutMs` with the last state seen.
 */
export async function waitForDomainObjectState<TState>(options: {
	readonly domainId: string;
	readonly description: string;
	readonly timeoutMs: number;
	readonly accept: (state: TState) => boolean;
	readonly intervalMs?: number;
}): Promise<TState> {
	const deadline = Date.now() + options.timeoutMs;
	let last: unknown;
	for (;;) {
		last = await readDomainObjectState(options.domainId);
		if (last !== undefined && options.accept(last as TState)) return last as TState;
		if (Date.now() >= deadline) {
			throw new Error(
				`${options.description} (${options.domainId}) within ${options.timeoutMs} ms; last state: ${JSON.stringify(last)}`,
			);
		}
		await delay(options.intervalMs ?? 500);
	}
}
