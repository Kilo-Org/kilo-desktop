import type { ThreadUserMessagePart } from "@assistant-ui/react";
import {
	toPromptInput,
	type ModelRef,
	type OpenCodePromptSender,
	type SessionInfo,
} from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";

import { slashCommandFromPromptArgs } from "../slash-commands/kilo-slash-command";
import { warmMcp } from "./with-mcp-warmup";

export interface PromptModelRef {
	readonly providerID: string;
	readonly modelID: string;
}

/** A prompt part as mentions resolve them: `{ type: "text", text }` or `{ type: "file", mime, url, filename? }`. */
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
	/** Turns the composer's mention chips into agent context (text and file parts). */
	readonly resolveParts?: (parts: readonly PromptPart[]) => Promise<readonly PromptPart[]>;
	/** Loads the prompt's model first (a `model-source` that serves its provider). */
	readonly prepareModel?: (model: PromptModelRef) => Promise<void>;
	/** The server accepted a prompt or command for this chat. */
	readonly onPrompted?: (chatId: string) => void;
	/** A prompt or command for this chat failed, preparing or sending it (the send rejects). */
	readonly onPromptFailed?: (chatId: string) => void;
}

/**
 * Where a prompt's system prompt rides: v2 prompts take no system prompt, so
 * the chat's goes on the prompt message's metadata under Desktop's key.
 */
export const PROMPT_METADATA_KEY = "kilo-desktop";

const normalVariant = (variant: string | undefined) =>
	variant && variant !== "default" ? variant : undefined;

/** The v2 model reference for a selection, with its variant. */
export function toModelRef(model: PromptModelRef, variant?: string): ModelRef {
	const chosen = normalVariant(variant);
	return {
		providerID: model.providerID,
		id: model.modelID,
		...(chosen ? { variant: chosen } : {}),
	};
}

const sameModel = (current: ModelRef | undefined, next: ModelRef) =>
	current?.providerID === next.providerID &&
	current.id === next.id &&
	normalVariant(current.variant) === normalVariant(next.variant);

/**
 * Switches `session`'s agent and model to the chosen ones, only where they
 * differ: each switch is a message in the session's transcript.
 */
export async function applySelection(
	client: Pick<OpenCodeClient, "session">,
	session: SessionInfo,
	selection: { readonly agent?: string | undefined; readonly model?: ModelRef | undefined },
): Promise<void> {
	if (selection.agent && selection.agent !== session.agent) {
		await client.session.switchAgent({ sessionID: session.id, agent: selection.agent });
	}
	if (selection.model && !sameModel(session.model, selection.model)) {
		await client.session.switchModel({ sessionID: session.id, model: selection.model });
	}
}

/** The text parts as mentions resolve them, back as message parts, the rest after them. */
async function resolvedParts(
	parts: readonly ThreadUserMessagePart[],
	resolveParts: PromptOptions["resolveParts"],
): Promise<ThreadUserMessagePart[]> {
	if (!resolveParts) return [...parts];
	const texts: PromptPart[] = parts.flatMap((part) =>
		part.type === "text" ? [{ type: "text", text: part.text }] : [],
	);
	const resolved = await resolveParts(texts);
	return [...resolved.flatMap(toMessagePart), ...parts.filter((part) => part.type !== "text")];
}

function toMessagePart(part: PromptPart): ThreadUserMessagePart[] {
	if (part.type === "text" && typeof part.text === "string") {
		return [{ type: "text", text: part.text }];
	}
	if (part.type === "file" && typeof part.url === "string" && typeof part.mime === "string") {
		return [
			{
				type: "file",
				data: part.url,
				mimeType: part.mime,
				...(typeof part.filename === "string" ? { filename: part.filename } : {}),
			},
		];
	}
	return [];
}

/**
 * The runtime's prompt sender over `client`, with the options read at send
 * time (the runtime may hold stale defaults):
 *
 * - the chosen model is prepared, and the session's agent and model switched
 *   to the chosen ones (with its variant) where they differ;
 * - mention chips become their context and files (`resolveParts`);
 * - a known `/name args` prompt runs `session.command`, anything else is
 *   `session.prompt` with the runtime's message id and the chat's system
 *   prompt on its metadata (`PROMPT_METADATA_KEY`); a command carries none;
 * - the location's MCP servers are warmed first (`warmMcp`);
 * - `onPrompted` once the server accepted it, `onPromptFailed` when any of it
 *   rejects (the New Session page waits for a draft's first send).
 */
export function createPromptSender(
	client: OpenCodeClient,
	options: PromptOptions,
): OpenCodePromptSender {
	return async ({ sessionId, messageId, parts, options: defaults }) => {
		try {
			const agent = options.getAgent?.() ?? defaults.agent;
			const model = options.getModel?.() ?? defaults.model;
			if (model) await options.prepareModel?.(model);
			const [session, message, system] = await Promise.all([
				client.session.get({ sessionID: sessionId }),
				resolvedParts(parts, options.resolveParts).then(toPromptInput),
				options.getSystem?.(sessionId),
			]);
			await applySelection(client, session, {
				agent,
				...(model ? { model: toModelRef(model, options.getVariant?.()) } : {}),
			});
			warmMcp(client, session.location.directory);
			const files = message.files.length > 0 ? { files: message.files } : {};
			const command = slashCommandFromPromptArgs(
				{ text: message.text },
				options.getKnownCommandNames?.() ?? [],
			);
			if (command) {
				await client.session.command({
					sessionID: sessionId,
					name: command.command,
					text: command.arguments,
					...files,
				});
			} else {
				await client.session.prompt({
					sessionID: sessionId,
					id: messageId,
					text: message.text,
					...files,
					...(system ? { metadata: { [PROMPT_METADATA_KEY]: { system } } } : {}),
				});
			}
		} catch (error) {
			options.onPromptFailed?.(sessionId);
			throw error;
		}
		options.onPrompted?.(sessionId);
	};
}
