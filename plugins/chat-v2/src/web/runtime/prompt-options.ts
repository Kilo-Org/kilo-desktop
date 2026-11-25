import { systemNote, type KiloClient } from "@kilo-desktop/react-opencode-v2";

import { slashCommandFromPromptArgs } from "../slash-commands/kilo-slash-command";

export interface PromptModelRef {
	readonly providerID: string;
	readonly modelID: string;
}

/** A piece of a prompt as the composer builds it: text, or a file by URL. */
export type PromptPart = Readonly<Record<string, unknown>>;

/** What every prompt carries, read when it is sent. */
export interface PromptOptions {
	readonly getAgent?: () => string | undefined;
	readonly getModel?: () => PromptModelRef | undefined;
	readonly getVariant?: () => string | undefined;
	/** The system prompt for the chat being prompted. */
	readonly getSystem?: (chatId: string) => Promise<string | undefined> | string | undefined;
	/** Kilo's slash commands for the chat's folder: `/name args` prompts run them instead. */
	readonly getKnownCommandNames?: () => readonly string[];
	/** Kilo's skills for the chat's folder, by `/` name: `/name args` prompts use the skill's id. */
	readonly getKnownSkills?: () => ReadonlyMap<string, string>;
	/** Turns the composer's mention chips into agent context (text and file parts). */
	readonly resolveParts?: (parts: readonly PromptPart[]) => Promise<readonly PromptPart[]>;
	/** Loads the prompt's model first (a `model-source` that serves its provider). */
	readonly prepareModel?: (model: PromptModelRef) => Promise<void>;
	/** The server accepted a prompt or command for this chat. */
	readonly onPrompted?: (chatId: string) => void;
	/** A prompt or command for this chat failed, preparing or sending it (the send rejects). */
	readonly onPromptFailed?: (chatId: string) => void;
}

type Session = KiloClient["session"];
type PromptInput = Parameters<Session["prompt"]>[0];
type CommandInput = Parameters<Session["command"]>[0];
type PromptFile = NonNullable<PromptInput["files"]>[number];

/** The prompt's text with its mention chips resolved, and the files they bring. */
async function resolvePrompt(
	input: PromptInput,
	options: PromptOptions,
): Promise<{ text: string; files: readonly PromptFile[] }> {
	const files = input.files ?? [];
	if (!options.resolveParts || !input.text) return { text: input.text, files };
	const parts = await options.resolveParts([{ type: "text", text: input.text }]);
	const text = parts.flatMap((part) =>
		part.type === "text" && typeof part.text === "string" ? [part.text] : [],
	);
	const resolved = parts.flatMap((part): PromptFile[] =>
		part.type === "file" && typeof part.url === "string"
			? [{ uri: part.url, ...(typeof part.filename === "string" ? { name: part.filename } : {}) }]
			: [],
	);
	return { text: text.join("\n"), files: [...files, ...resolved] };
}

/**
 * Runs a prompt or command for `chatId`, saying it failed when any of it
 * rejects: preparing it (system prompt, mentions, model) or sending it. The
 * New Session page waits for the outcome of a draft's first send.
 */
async function reportingFailure<T>(
	chatId: string,
	options: PromptOptions,
	run: () => Promise<T>,
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		options.onPromptFailed?.(chatId);
		throw error;
	}
}

/**
 * Wraps a Kilo client so `session.prompt` and `session.command` go out with
 * the options read at send time. A Kilo v2 prompt carries no agent, model or
 * system text, so the session is switched to the chosen agent and model
 * first (agent and model always win: the runtime may hold stale defaults)
 * and the chat's system prompt goes in as a hidden note the turn reads. A
 * known `/command args` prompt runs `session.command` instead (so a draft's
 * first send still creates the chat first), detached from it so the send can
 * finish; a known `/skill args` prompt sends `args` naming the skill.
 */
export function withPromptOptions(client: KiloClient, options: PromptOptions): KiloClient {
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session" || value === null || typeof value !== "object") return value;
			const session = value as Session;

			/** Switches the session to the prompt's agent and model and adds its system note. */
			const prepare = async (sessionID: string, system: string | undefined) => {
				const agent = options.getAgent?.();
				const model = options.getModel?.();
				const variant = options.getVariant?.();
				if (model) await options.prepareModel?.(model);
				if (agent) await session.switchAgent({ sessionID, agent });
				if (model) {
					await session.switchModel({
						sessionID,
						model: {
							providerID: model.providerID,
							id: model.modelID,
							...(variant ? { variant } : {}),
						},
					});
				}
				if (system) {
					await session.synthetic({ sessionID, text: systemNote(system), resume: false });
				}
			};

			const prompt: Session["prompt"] = (input, requestOptions) =>
				reportingFailure(input.sessionID, options, async () => {
					const [system, { text, files }] = await Promise.all([
						options.getSystem?.(input.sessionID),
						resolvePrompt(input, options),
					]);
					const commandNames = options.getKnownCommandNames?.() ?? [];
					const skills = options.getKnownSkills?.() ?? new Map<string, string>();
					const draft = slashCommandFromPromptArgs({ text }, [...commandNames, ...skills.keys()]);
					const skill = draft ? skills.get(draft.command) : undefined;
					await prepare(input.sessionID, system);
					if (draft && skill === undefined) {
						const command = session.command(
							{
								sessionID: input.sessionID,
								name: draft.command,
								text: draft.arguments,
								...(files.length > 0 ? { files } : {}),
							},
							requestOptions,
						);
						void command.catch(() => undefined);
						options.onPrompted?.(input.sessionID);
						return undefined as never;
					}
					const sent = await session.prompt(
						{
							...input,
							// A skill is no command in Kilo v2: the prompt names it.
							text: draft && skill !== undefined ? draft.arguments : text,
							...(files.length > 0 ? { files } : {}),
							...(skill !== undefined ? { skills: [...(input.skills ?? []), { id: skill }] } : {}),
						},
						requestOptions,
					);
					options.onPrompted?.(input.sessionID);
					return sent;
				});

			const command: Session["command"] = (input: CommandInput, requestOptions) =>
				reportingFailure(input.sessionID, options, async () => {
					await prepare(input.sessionID, await options.getSystem?.(input.sessionID));
					await session.command(input, requestOptions);
				});

			return new Proxy(session as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					if (sessionProp === "prompt") return prompt;
					if (sessionProp === "command") return command;
					return Reflect.get(sessionTarget, sessionProp, sessionReceiver);
				},
			});
		},
	}) as KiloClient;
}
