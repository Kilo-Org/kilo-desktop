import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/react";

import type {
	ComposerMentionImplementation,
	MentionSearchContext,
	PromptPart,
	ResolvedMention,
} from "../../contracts";

/** A `composer-mention` contribution the composer can use. */
export interface MentionSource {
	/** The contribution's key (`kilo.files/files`). */
	readonly key: string;
	readonly trigger: string;
	readonly title: string;
	readonly implementation: ComposerMentionImplementation;
}

/** The directive type a source's chips carry in the composer's text. */
export function mentionType(key: string): string {
	return `m_${key.replace(/[^\w]/gu, "_")}`.slice(0, 64);
}

const DIRECTIVE = /:(m_\w{1,62})\[([^\]\n]{1,1024})\]\{name=([^}\n]{1,1024})\}/gu;

const cleanLabel = (label: string) => label.replace(/[\]\n]/gu, " ").trim() || "mention";

/**
 * How mention chips are written in the composer's text, so the rich input
 * shows them as chips and a send can resolve them:
 * `:m_<source>[label]{name=<encoded id>}`. Directives of sources that aren't
 * installed stay text.
 */
export function createMentionFormatter(
	sources: readonly MentionSource[],
): Unstable_DirectiveFormatter {
	const types = new Set(sources.map((source) => mentionType(source.key)));
	return {
		serialize: (item) =>
			`:${item.type}[${cleanLabel(item.label)}]{name=${encodeURIComponent(item.id)}} `,
		parse(text) {
			if (!text) return [];
			const segments: Unstable_DirectiveSegment[] = [];
			let cursor = 0;
			for (const match of text.matchAll(DIRECTIVE)) {
				const [whole, type, label, id] = match;
				if (!types.has(type!)) continue;
				if (match.index > cursor)
					segments.push({ kind: "text", text: text.slice(cursor, match.index) });
				segments.push({ kind: "mention", type: type!, label: label!, id: safeDecode(id!) });
				cursor = match.index + whole.length;
			}
			if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
			return segments.length ? segments : [{ kind: "text", text }];
		},
	};
}

function safeDecode(id: string): string {
	try {
		return decodeURIComponent(id);
	} catch {
		return id;
	}
}

/** Formatters in order: each later one parses the text segments the earlier ones left. */
export function combineFormatters(
	primary: Unstable_DirectiveFormatter,
	mentions: Unstable_DirectiveFormatter,
	isMention: (type: string) => boolean,
): Unstable_DirectiveFormatter {
	return {
		serialize: (item) =>
			isMention(item.type) ? mentions.serialize(item) : primary.serialize(item),
		parse: (text) =>
			primary
				.parse(text)
				.flatMap((segment) => (segment.kind === "text" ? mentions.parse(segment.text) : [segment])),
	};
}

type ResolveContext = Omit<MentionSearchContext, "signal">;

/**
 * Resolves the mention chips in a prompt's text parts: each becomes its
 * source's text (its label when the source gives none or fails) and the
 * files it resolves to follow as file parts.
 */
export async function resolveMentionParts(
	parts: readonly PromptPart[],
	sources: readonly MentionSource[],
	context: ResolveContext,
): Promise<PromptPart[]> {
	if (sources.length === 0) return [...parts];
	const formatter = createMentionFormatter(sources);
	const byType = new Map(sources.map((source) => [mentionType(source.key), source]));
	const signal = AbortSignal.timeout(30_000);
	const files: PromptPart[] = [];
	const resolved = await Promise.all(
		parts.map(async (part) => {
			if (part.type !== "text") return part;
			const segments = formatter.parse(part.text);
			if (!segments.some((segment) => segment.kind === "mention")) return part;
			const texts = await Promise.all(
				segments.map(async (segment) => {
					if (segment.kind === "text") return segment.text;
					const source = byType.get(segment.type)!;
					const mention = await resolveOne(source, segment, { ...context, signal });
					for (const file of mention.files ?? []) {
						files.push({
							type: "file",
							mime: file.mime,
							url: file.url,
							...(file.filename ? { filename: file.filename } : {}),
						});
					}
					return mention.text ?? segment.label;
				}),
			);
			return { ...part, text: texts.join("") };
		}),
	);
	return [...resolved, ...files];
}

async function resolveOne(
	source: MentionSource,
	item: { id: string; label: string },
	context: MentionSearchContext,
): Promise<ResolvedMention> {
	try {
		return await source.implementation.resolve({ id: item.id, label: item.label }, context);
	} catch (error) {
		console.warn(`[kilo.chat] ${source.key} could not resolve a mention`, error);
		return {};
	}
}

/** "Send a message, @ to mention files, or / for commands…", for the installed sources. */
export function composerPlaceholder(sources: readonly MentionSource[]): string {
	const mentions = sources.map(
		(source) => `${source.trigger} to mention ${source.title.toLocaleLowerCase()}`,
	);
	return mentions.length === 0
		? "Send a message or / for commands…"
		: `Send a message, ${mentions.join(", ")}, or / for commands…`;
}
