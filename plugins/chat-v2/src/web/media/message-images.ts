import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";

import {
	kiloSteps,
	kiloToolCalls,
	kiloToolContent,
	findKiloToolCall,
} from "../runtime/kilo-transcript";
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
 * The images a tool call returned (the image files in its content): a
 * screenshot, an image an MCP tool made, a picture the agent read.
 */
export function toolImageAttachments(
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): ImageAttachment[] {
	return kiloToolContent(findKiloToolCall(messages, toolCallId)).flatMap((item) =>
		item.type === "file" && item.mime.startsWith("image/") && item.uri
			? [{ url: item.uri, ...(item.name ? { filename: item.name } : {}) }]
			: [],
	);
}

export interface SavedImage {
	readonly path: string;
	/** Changes when the file is written again, so its preview is read again. */
	readonly revision: string;
}

/**
 * The image files a turn wrote: those its steps' snapshots list as changed
 * (`snapshot.files`, which cover scripts and shell commands too) and those
 * its file tools wrote. A snapshot image counts only when a tool call's input
 * names it, so a checkout or pull that swaps fixture images in shows none.
 * Each path once, at its latest revision, in first-written order; at most
 * `SAVED_IMAGES_LIMIT`, with how many more there were.
 */
export function savedImages(messages: readonly SessionMessageInfo[]): {
	images: SavedImage[];
	more: number;
} {
	const tools = kiloToolCalls(messages);
	// shortcut: a script that builds the file name at runtime isn't matched; parse its output paths if that matters.
	const toolInputs = tools
		.map((tool) => (tool.state.status === "streaming" ? "" : JSON.stringify(tool.state.input)))
		.join("\n");
	const byPath = new Map<string, string>();
	const note = (path: string, revision: string) => {
		if (!path || !imageMimeForPath(path)) return;
		byPath.set(path, revision);
	};
	for (const step of kiloSteps(messages)) {
		for (const item of step.content) {
			if (item.type !== "tool" || !FILE_WRITING_TOOLS.has(item.name)) continue;
			if (item.state.status !== "completed") continue;
			note(getToolFilePath(item.state.input), item.id);
		}
		const revision = step.snapshot?.end ?? step.id;
		for (const file of step.snapshot?.files ?? []) {
			if (toolInputs.includes(fileName(file))) note(file, revision);
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

function base64Of(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

/**
 * An image file's bytes (as Kilo's `file.read` returns them) as a data URL,
 * typed by the path's extension. Null when the path isn't an image's or
 * the file is empty.
 */
export function imageDataUrl(bytes: Uint8Array | undefined, path: string): string | null {
	if (!bytes?.length) return null;
	const mime = imageMimeForPath(path);
	return mime ? `data:${mime};base64,${base64Of(bytes)}` : null;
}
