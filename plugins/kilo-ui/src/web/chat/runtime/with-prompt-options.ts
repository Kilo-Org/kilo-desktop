import type { KiloClient } from "@kilocode/sdk/v2/client";

import { ANACONDA_LOCAL_PROVIDER_ID } from "../../providers/provider-ids.js";
import { slashCommandFromPromptArgs } from "../slash-commands/kilo-slash-command.js";

export type PromptModelRef = {
	providerID: string;
	modelID: string;
};

export type PromptOptionGetters = {
	getVariant?: () => string | undefined;
	getAgent?: () => string | undefined;
	getModel?: () => PromptModelRef | undefined;
	getSystem?: (prompt: Readonly<Record<string, unknown>>) => string | undefined;
	prepareModel?: (modelId: string) => Promise<void>;
	/** Known Kilo slash-command names; used to rewrite `/cmd args` prompts. */
	getKnownCommandNames?: () => readonly string[];
};

function isPromptModelRef(value: unknown): value is PromptModelRef {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as PromptModelRef).providerID === "string" &&
		typeof (value as PromptModelRef).modelID === "string"
	);
}

/** `session.command` takes `provider/model`; prompt APIs take a `{ providerID, modelID }` object. */
function toCommandModel(model: unknown): string | undefined {
	if (typeof model === "string" && model.length > 0) return model;
	if (isPromptModelRef(model)) return `${model.providerID}/${model.modelID}`;
	return undefined;
}

function withCommandModel(args: Record<string, unknown>): Record<string, unknown> {
	if (!("model" in args)) return args;
	const model = toCommandModel(args.model);
	if (model === args.model) return args;
	if (model === undefined) {
		const { model: _model, ...rest } = args;
		return rest;
	}
	return { ...args, model };
}

async function prepareLocalModel(
	getters: PromptOptionGetters,
	args: Record<string, unknown>,
): Promise<void> {
	if (
		getters.prepareModel &&
		isPromptModelRef(args.model) &&
		args.model.providerID === ANACONDA_LOCAL_PROVIDER_ID
	) {
		await getters.prepareModel(args.model.modelID);
	}
}

function toCommandArgs(
	args: Record<string, unknown>,
	draft: { command: string; arguments: string },
): Record<string, unknown> {
	const model = toCommandModel(args.model);
	return {
		sessionID: args.sessionID,
		command: draft.command,
		arguments: draft.arguments,
		...(args.agent !== undefined ? { agent: args.agent } : {}),
		...(model !== undefined ? { model } : {}),
		...(args.variant !== undefined ? { variant: args.variant } : {}),
	};
}

/**
 * Wraps a Kilo client so `session.prompt` / `session.promptAsync` /
 * `session.command` receive the latest composer selection on every send.
 *
 * Agent and model are always overwritten when getters return a value —
 * RemoteThreadList can keep a stale `defaultAgent` / `defaultModel` closed
 * over in `onNew`. Variant only fills in when unset (explicit request wins).
 *
 * Known `/command args` drafts are rewritten to `session.command` so draft
 * threads still go through lazy session create, then the command API.
 * Command payloads use a `provider/model` string. `promptAsync` rewrites
 * detach from the blocking command HTTP call so send() can finish.
 */
export function withPromptOptions(client: KiloClient, getters: PromptOptionGetters): KiloClient {
	const injectPromptOptions = <T extends Record<string, unknown>>(args: T): T => {
		let next: Record<string, unknown> = args;

		const variant = getters.getVariant?.();
		if (variant !== undefined && next.variant === undefined) {
			next = { ...next, variant };
		}

		const agent = getters.getAgent?.();
		if (agent !== undefined) {
			next = { ...next, agent };
		}

		const model = getters.getModel?.();
		if (model !== undefined) {
			next = { ...next, model };
		}

		const system = getters.getSystem?.(next);
		if (system !== undefined) {
			const explicitSystem = typeof next.system === "string" ? next.system : undefined;
			next = { ...next, system: explicitSystem ? `${system}\n\n${explicitSystem}` : system };
		}

		return next as T;
	};

	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session") {
				return value;
			}
			if (value === null || (typeof value !== "object" && typeof value !== "function")) {
				return value;
			}
			return new Proxy(value as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					const sessionValue = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
					if (sessionProp === "command" && typeof sessionValue === "function") {
						return async (args: Record<string, unknown>, ...rest: unknown[]) => {
							const next = injectPromptOptions(args);
							await prepareLocalModel(getters, next);
							return Reflect.apply(sessionValue, sessionTarget, [withCommandModel(next), ...rest]);
						};
					}
					if (
						(sessionProp === "prompt" || sessionProp === "promptAsync") &&
						typeof sessionValue === "function"
					) {
						return async (args: Record<string, unknown>, ...rest: unknown[]) => {
							const next = injectPromptOptions(args);
							await prepareLocalModel(getters, next);
							const draft = slashCommandFromPromptArgs(
								next,
								getters.getKnownCommandNames?.() ?? [],
							);
							const commandFn = Reflect.get(sessionTarget, "command", sessionReceiver);
							if (draft && typeof commandFn === "function") {
								const result = Reflect.apply(commandFn, sessionTarget, [
									toCommandArgs(next, draft),
									...rest,
								]);
								// promptAsync is fire-and-forget; session.command blocks until
								// the turn finishes. Detach so composer send() can complete.
								if (sessionProp === "promptAsync") {
									void Promise.resolve(result).catch(() => undefined);
									return;
								}
								return result;
							}
							return Reflect.apply(sessionValue, sessionTarget, [next, ...rest]);
						};
					}
					return sessionValue;
				},
			});
		},
	}) as KiloClient;
}
