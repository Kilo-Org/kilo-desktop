import type { AppendMessage } from "@assistant-ui/react";
import {
	resolveFileMediaType,
	resolveImageMediaType,
	toMediaWireUrl,
} from "@assistant-ui/core/internal";

import {
	queuePreview,
	type PreparedText,
	type PromptQueueItem,
	type PromptPart as QueuedPromptPart,
	type QueuedPrompt,
} from "../../contracts";
import { toModelRef } from "../selection/model-catalog";
import { slashCommandFromPromptText } from "../slash-commands/kilo-slash-command";
import type { PromptOptions, PromptPart } from "./prompt-options";

/** Above this, an image attachment shows in the queue as a file, not its picture. */
const MAX_PREVIEW_IMAGE_LENGTH = 256 * 1024;

/** What a queued prompt needs from the window that queues it. */
export type QueuePromptOptions = Pick<
	PromptOptions,
	"getAgent" | "getModel" | "getSystem" | "getKnownCommandNames" | "resolveParts"
>;

/** What a queued prompt is made from: the message's content and attachments. */
export type QueuedMessage = Pick<AppendMessage, "content" | "attachments">;

type ContentPart = AppendMessage["content"][number] & {
	readonly filename?: string;
	readonly contentType?: string;
};

/** The message's content and attachments, each part carrying its attachment's name. */
function contentParts(message: QueuedMessage): ContentPart[] {
	const attached = (message.attachments ?? []).flatMap((attachment) =>
		(attachment.content ?? []).map(
			(part) =>
				({
					...part,
					...(attachment.name != null ? { filename: attachment.name } : {}),
					...(attachment.contentType != null ? { contentType: attachment.contentType } : {}),
				}) as ContentPart,
		),
	);
	return [...(message.content as ContentPart[]), ...attached];
}

/** The message's files as Kilo prompt parts, as react-opencode sends them. */
function fileParts(message: QueuedMessage): PromptPart[] {
	return contentParts(message).flatMap((part): PromptPart[] => {
		if (part.type === "image") {
			const mime = resolveImageMediaType(part.image, part.contentType);
			return [
				{
					type: "file",
					...(part.filename != null ? { filename: part.filename } : {}),
					mime,
					url: toMediaWireUrl(part.image, mime),
				},
			];
		}
		if (part.type === "file") {
			const mime = resolveFileMediaType(part.data, part.mimeType);
			const byId = (part as { sourceType?: unknown }).sourceType === "id";
			return [
				{
					type: "file",
					filename: part.filename,
					mime,
					url: byId ? part.data : toMediaWireUrl(part.data, mime),
				},
			];
		}
		return [];
	});
}

/** Parts as a queued prompt carries them: text, and files as URLs; anything else is dropped. */
export function toQueuedParts(parts: readonly PromptPart[]): QueuedPromptPart[] {
	return parts.flatMap((part): QueuedPromptPart[] => {
		if (part.type === "text" && typeof part.text === "string") {
			return [{ type: "text", text: part.text }];
		}
		if (part.type === "file" && typeof part.mime === "string" && typeof part.url === "string") {
			return [
				{
					type: "file",
					mime: part.mime,
					url: part.url,
					...(typeof part.filename === "string" ? { filename: part.filename } : {}),
				},
			];
		}
		return [];
	});
}

export function messageText(message: QueuedMessage): string {
	return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function attachmentPreview(message: QueuedMessage): QueuedPrompt["attachmentPreview"] {
	const attachment = message.attachments?.[0];
	if (!attachment) return undefined;
	const image = attachment.content?.find((part) => part.type === "image");
	const src = image?.type === "image" ? image.image : undefined;
	return {
		name: attachment.name,
		...(src && src.length <= MAX_PREVIEW_IMAGE_LENGTH ? { src } : {}),
	};
}

/** The message as its queue line, before it is prepared. */
export function queueItemOf(message: QueuedMessage): Omit<PromptQueueItem, "id"> {
	const text = messageText(message);
	const preview = attachmentPreview(message);
	return {
		prompt: queuePreview({ text, attachmentParts: toQueuedParts(fileParts(message)) }),
		text,
		...(preview ? { attachmentPreview: preview } : {}),
	};
}

/**
 * Text as the window sends it: mention chips resolved to their context, and
 * a known `/command args` found in the result (as `withPromptOptions` does at
 * send time).
 */
export async function prepareText(
	text: string,
	options: QueuePromptOptions,
): Promise<PreparedText> {
	const raw: PromptPart[] = text ? [{ type: "text", text }] : [];
	const textParts = options.resolveParts ? [...(await options.resolveParts(raw))] : raw;
	const resolvedText = textParts
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("");
	const draft = slashCommandFromPromptText(resolvedText, options.getKnownCommandNames?.() ?? []);
	return {
		text,
		textParts: toQueuedParts(textParts),
		...(draft ? { command: { name: draft.command, arguments: draft.arguments } } : {}),
	};
}

/**
 * The message as a prompt the queue can send later from main: what the
 * composer holds now (agent, model, variant), the chat's system prompt, its
 * text prepared and its files as data URLs. A local model is loaded when the
 * prompt reaches the Local Model Server, so it isn't prepared here.
 */
export async function prepareQueuedPrompt(
	message: QueuedMessage,
	chatId: string,
	options: QueuePromptOptions,
): Promise<QueuedPrompt> {
	const [text, system] = await Promise.all([
		prepareText(messageText(message), options),
		options.getSystem?.(chatId),
	]);
	const agent = options.getAgent?.();
	const model = options.getModel?.();
	const preview = attachmentPreview(message);
	return {
		...text,
		attachmentParts: toQueuedParts(fileParts(message)),
		...(preview ? { attachmentPreview: preview } : {}),
		...(agent ? { agent } : {}),
		...(model ? { model: toModelRef(model) } : {}),
		...(model?.variant ? { variant: model.variant } : {}),
		...(system ? { system } : {}),
	};
}
