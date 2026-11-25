import type { SessionMessageAssistantTool, SessionMessageInfo } from "@kilo-desktop/react-opencode";

import { findOpenCodeTool } from "../tools/opencode-tool";
import { getToolFilePath } from "../tools/tool-diff-stats";

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	bmp: "image/bmp",
};

/** Tools whose file argument names the file they wrote. */
const FILE_WRITING_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** The most saved images a turn shows; a turn that writes a whole image set lists the rest. */
export const SAVED_IMAGES_LIMIT = 12;

export function imageMimeForPath(path: string): string | null {
	const extension = /\.([a-z0-9]+)$/iu.exec(path)?.[1]?.toLowerCase();
	return extension ? (IMAGE_MIME_BY_EXTENSION[extension] ?? null) : null;
}

export const fileName = (path: string): string => path.split(/[\\/]/u).at(-1) ?? path;

export interface ImageAttachment {
	readonly url: string;
	readonly filename?: string;
}

/**
 * The images a tool call returned (its completed `file` content): a
 * screenshot, an image an MCP tool made, a picture the agent read.
 */
export function toolImageAttachments(
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): ImageAttachment[] {
	const tool = findOpenCodeTool(messages, toolCallId);
	if (tool?.state.status !== "completed") return [];
	return tool.state.content.flatMap((item) =>
		item.type === "file" && item.uri && item.mime.startsWith("image/")
			? [{ url: item.uri, ...(item.name ? { filename: item.name } : {}) }]
			: [],
	);
}

export interface SavedImage {
	readonly path: string;
	/** Changes when the file is written again, so its preview is read again. */
	readonly revision: string;
}

/** The files a completed file tool call wrote: `write`/`edit` by input path, `patch` by its file diffs. */
function writtenFiles(tool: SessionMessageAssistantTool): string[] {
	if (tool.state.status !== "completed") return [];
	if (FILE_WRITING_TOOLS.has(tool.name)) return [getToolFilePath(tool.state.input)];
	if (tool.name !== "patch") return [];
	const files = (tool.state.metadata as { files?: unknown } | undefined)?.files;
	if (!Array.isArray(files)) return [];
	return files.flatMap((file: { file?: unknown; status?: unknown } | null) =>
		typeof file?.file === "string" && file.status !== "deleted" ? [file.file] : [],
	);
}

/**
 * The image files a turn's file tools wrote (`write`, `edit`, `patch`).
 * Each path once, at its latest revision, in first-written order; at most
 * `SAVED_IMAGES_LIMIT`, with how many more there were.
 */
export function savedImages(messages: readonly SessionMessageInfo[]): {
	images: SavedImage[];
	more: number;
} {
	const byPath = new Map<string, string>();
	for (const message of messages) {
		if (message.type !== "assistant") continue;
		for (const item of message.content) {
			if (item.type !== "tool") continue;
			for (const path of writtenFiles(item)) {
				if (path && imageMimeForPath(path)) byPath.set(path, item.id);
			}
		}
	}
	const images = [...byPath].map(([path, revision]) => ({ path, revision }));
	return {
		images: images.slice(0, SAVED_IMAGES_LIMIT),
		more: Math.max(0, images.length - SAVED_IMAGES_LIMIT),
	};
}

/** A `file://` URL's path (`C:/…` on Windows), or null for any other URL. */
export function fileUrlPath(url: string): string | null {
	if (!url.startsWith("file://")) return null;
	try {
		const path = decodeURIComponent(new URL(url).pathname);
		return /^\/[a-z]:\//iu.test(path) ? path.slice(1) : path;
	} catch {
		return null;
	}
}

function utf8ToBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

/** What the Kilo server's file read returns (`FileContent`), as far as images go. */
export interface FileReadContent {
	readonly type?: string;
	readonly content?: string;
	readonly encoding?: string;
	readonly mimeType?: string;
}

/**
 * An image file's contents as a data URL: base64 content as is, an SVG read
 * as text encoded. Null when the read isn't an image.
 */
export function imageDataUrl(content: FileReadContent | undefined, path: string): string | null {
	if (!content?.content) return null;
	const mime = content.mimeType?.startsWith("image/") ? content.mimeType : imageMimeForPath(path);
	if (!mime) return null;
	if (content.encoding === "base64") return `data:${mime};base64,${content.content}`;
	if (mime === "image/svg+xml" && content.type === "text") {
		return `data:image/svg+xml;base64,${utf8ToBase64(content.content)}`;
	}
	return null;
}
