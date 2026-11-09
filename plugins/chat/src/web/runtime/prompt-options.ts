import type { KiloClient } from "@kilocode/sdk/v2/client";

import { slashCommandFromPromptArgs } from "../slash-commands/kilo-slash-command";

/**
 * Sent on every prompt and command so a slow Kilo snapshot waits silently
 * instead of raising the blocking "Snapshot is slow — disable snapshots?"
 * question. Desktop runs many chats against one `kilo serve`; they queue on a
 * per-worktree snapshot lock, so the 10s threshold trips on lock wait, not
 * repository size. Matches the VS Code Agent Manager policy.
 */
export const SNAPSHOT_INITIALIZATION = "wait" as const;

export interface PromptModelRef {
	readonly providerID: string;
	readonly modelID: string;
}

export type PromptPart = Readonly<Record<string, unknown>>;

/** What every prompt carries, read when it is sent. */
export interface PromptOptions {
	readonly getAgent?: () => string | undefined;
	readonly getModel?: () => PromptModelRef | undefined;
	readonly getVariant?: () => string | undefined;
	/** The system prompt for the chat being prompted; prepended to any the prompt has. */
	readonly getSystem?: (chatId: string) => Promise<string | undefined> | string | undefined;
	/** Kilo's slash commands for the chat's folder: `/name args` prompts run them instead. */
	readonly getKnownCommandNames?: () => readonly string[];
	/** Turns the composer's mention chips into agent context (text and file parts). */
	readonly resolveParts?: (parts: readonly PromptPart[]) => Promise<readonly PromptPart[]>;
	/** Loads the prompt's model first (a `model-source` that serves its provider). */
	readonly prepareModel?: (model: PromptModelRef) => Promise<void>;
	/** The server accepted a prompt or command for this chat. */
	readonly onPrompted?: (chatId: string) => void;
}

function isModelRef(value: unknown): value is PromptModelRef {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as PromptModelRef).providerID === "string" &&
		typeof (value as PromptModelRef).modelID === "string"
	);
}

/** `session.command` takes `provider/model`; prompts take `{ providerID, modelID }`. */
function commandModel(model: unknown): string | undefined {
	if (typeof model === "string" && model.length > 0) return model;
	return isModelRef(model) ? `${model.providerID}/${model.modelID}` : undefined;
}

async function withOptions(
	args: Record<string, unknown>,
	options: PromptOptions,
): Promise<Record<string, unknown>> {
	let next: Record<string, unknown> = { ...args, snapshotInitialization: SNAPSHOT_INITIALIZATION };
	const variant = options.getVariant?.();
	if (variant !== undefined && next.variant === undefined) next = { ...next, variant };
	const agent = options.getAgent?.();
	if (agent !== undefined) next = { ...next, agent };
	const model = options.getModel?.();
	if (model !== undefined) next = { ...next, model };
	const chatId = typeof next.sessionID === "string" ? next.sessionID : undefined;
	const system = chatId ? await options.getSystem?.(chatId) : undefined;
	if (system) {
		const explicit = typeof next.system === "string" ? next.system : undefined;
		next = { ...next, system: explicit ? `${system}\n\n${explicit}` : system };
	}
	if (options.resolveParts && Array.isArray(next.parts)) {
		next = { ...next, parts: [...(await options.resolveParts(next.parts as PromptPart[]))] };
	}
	if (options.prepareModel && isModelRef(next.model)) await options.prepareModel(next.model);
	return next;
}

function commandArgs(
	args: Record<string, unknown>,
	draft: { command: string; arguments: string },
): Record<string, unknown> {
	const model = commandModel(args.model);
	return {
		sessionID: args.sessionID,
		command: draft.command,
		arguments: draft.arguments,
		...(args.agent !== undefined ? { agent: args.agent } : {}),
		...(model !== undefined ? { model } : {}),
		...(args.variant !== undefined ? { variant: args.variant } : {}),
		snapshotInitialization: SNAPSHOT_INITIALIZATION,
	};
}

/**
 * Wraps a Kilo client so `session.prompt` / `promptAsync` / `command` receive
 * the options read at send time, plus the desktop snapshot policy. Agent and
 * model always win (the runtime may hold stale defaults); a variant only
 * fills in. A known `/command args` prompt runs `session.command` (so a
 * draft's first send still creates the chat first); `promptAsync` detaches
 * from the command's blocking call so the send can finish.
 */
export function withPromptOptions(client: KiloClient, options: PromptOptions): KiloClient {
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session" || value === null || typeof value !== "object") return value;
			return new Proxy(value as object, {
				get(session, sessionProp, sessionReceiver) {
					const method = Reflect.get(session, sessionProp, sessionReceiver);
					if (typeof method !== "function") return method;
					if (sessionProp === "command") {
						return async (args: Record<string, unknown>, ...rest: unknown[]) => {
							const next = await withOptions(args, options);
							const model = commandModel(next.model);
							const { model: _model, ...withoutModel } = next;
							return Reflect.apply(method, session, [
								model === undefined ? withoutModel : { ...withoutModel, model },
								...rest,
							]);
						};
					}
					if (sessionProp !== "prompt" && sessionProp !== "promptAsync") return method;
					return async (args: Record<string, unknown>, ...rest: unknown[]) => {
						const next = await withOptions(args, options);
						const prompted = () => {
							if (typeof next.sessionID === "string") options.onPrompted?.(next.sessionID);
						};
						const draft = slashCommandFromPromptArgs(next, options.getKnownCommandNames?.() ?? []);
						const command = Reflect.get(session, "command", sessionReceiver);
						if (draft && typeof command === "function") {
							const result = Reflect.apply(command, session, [commandArgs(next, draft), ...rest]);
							if (sessionProp === "promptAsync") {
								void Promise.resolve(result).catch(() => undefined);
								prompted();
								return;
							}
							return Promise.resolve(result).then((value) => {
								prompted();
								return value;
							});
						}
						return Promise.resolve(Reflect.apply(method, session, [next, ...rest])).then(
							(value) => {
								prompted();
								return value;
							},
						);
					};
				},
			});
		},
	}) as KiloClient;
}
