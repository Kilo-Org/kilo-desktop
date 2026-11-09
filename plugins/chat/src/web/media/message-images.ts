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

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

export interface ImageAttachment {
	readonly url: string;
	readonly filename?: string;
}

/**
 * The images a tool call returned (OpenCode `state.attachments`): a screenshot,
 * an image an MCP tool made, a picture the agent read.
 */
export function toolImageAttachments(parts: unknown, toolCallId: string): ImageAttachment[] {
	if (!Array.isArray(parts)) return [];
	for (const part of parts) {
		const tool = record(part);
		if (tool?.type !== "tool" || (tool.callID ?? tool.id) !== toolCallId) continue;
		const attachments = record(tool.state)?.attachments;
		if (!Array.isArray(attachments)) return [];
		return attachments.flatMap((attachment) => {
			const file = record(attachment);
			if (!file || typeof file.url !== "string" || !file.url) return [];
			if (typeof file.mime !== "string" || !file.mime.startsWith("image/")) return [];
			return [
				{
					url: file.url,
					...(typeof file.filename === "string" && file.filename
						? { filename: file.filename }
						: {}),
				},
			];
		});
	}
	return [];
}

export interface SavedImage {
	readonly path: string;
	/** Changes when the file is written again, so its preview is read again. */
	readonly revision: string;
}

/**
 * The image files a turn wrote: those its steps' snapshots list as changed
 * (`patch` parts, which cover scripts and shell commands too) and those its
 * file tools wrote. Each path once, at its latest revision, in first-written
 * order; at most `SAVED_IMAGES_LIMIT`, with how many more there were.
 */
export function savedImages(parts: unknown): { images: SavedImage[]; more: number } {
	const byPath = new Map<string, string>();
	const note = (path: string, revision: string) => {
		if (!path || !imageMimeForPath(path)) return;
		byPath.set(path, revision);
	};
	for (const part of Array.isArray(parts) ? parts : []) {
		const entry = record(part);
		if (!entry) continue;
		if (entry.type === "patch" && Array.isArray(entry.files)) {
			const revision = typeof entry.hash === "string" ? entry.hash : "";
			for (const file of entry.files) if (typeof file === "string") note(file, revision);
		}
		if (entry.type === "tool" && typeof entry.tool === "string") {
			const state = record(entry.state);
			if (!FILE_WRITING_TOOLS.has(entry.tool) || state?.status !== "completed") continue;
			const revision = typeof entry.callID === "string" ? entry.callID : "";
			note(getToolFilePath(record(state.input) ?? undefined), revision);
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
