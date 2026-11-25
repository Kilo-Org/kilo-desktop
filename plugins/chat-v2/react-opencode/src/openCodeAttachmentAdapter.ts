import {
	generateId,
	type AttachmentAdapter,
	type CompleteAttachment,
	type PendingAttachment,
} from "@assistant-ui/react";
import { getFileDataURL } from "@assistant-ui/core/internal";

// Mirrors ACCEPTED_FILE_TYPES in OpenCode's app (packages/app/src/constants/file-picker.ts),
// including the extension entries that make source files pickable despite their
// empty or nonstandard browser MIME types.
const DEFAULT_ACCEPT = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
	"text/*",
	"application/json",
	"application/ld+json",
	"application/toml",
	"application/x-toml",
	"application/x-yaml",
	"application/xml",
	"application/yaml",
	".c",
	".cc",
	".cjs",
	".conf",
	".cpp",
	".css",
	".csv",
	".cts",
	".env",
	".go",
	".gql",
	".graphql",
	".h",
	".hh",
	".hpp",
	".htm",
	".html",
	".ini",
	".java",
	".js",
	".json",
	".jsx",
	".log",
	".md",
	".mdx",
	".mjs",
	".mts",
	".py",
	".rb",
	".rs",
	".sass",
	".scss",
	".sh",
	".sql",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
	".zsh",
].join(",");

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const IMAGE_EXTS = new Map([
	["gif", "image/gif"],
	["jpeg", "image/jpeg"],
	["jpg", "image/jpeg"],
	["png", "image/png"],
	["webp", "image/webp"],
]);

const TEXT_MIMES = new Set([
	"application/json",
	"application/ld+json",
	"application/toml",
	"application/x-toml",
	"application/x-yaml",
	"application/xml",
	"application/yaml",
]);

const SAMPLE = 4096;

const kind = (type: string) => type.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const ext = (name: string) => {
	const idx = name.lastIndexOf(".");
	if (idx === -1) return "";
	return name.slice(idx + 1).toLowerCase();
};

const textMime = (type: string) => {
	if (!type) return false;
	if (type.startsWith("text/")) return true;
	if (TEXT_MIMES.has(type)) return true;
	if (type.endsWith("+json")) return true;
	return type.endsWith("+xml");
};

const textBytes = (bytes: Uint8Array) => {
	if (bytes.length === 0) return true;
	let count = 0;
	for (const byte of bytes) {
		if (byte === 0) return false;
		if (byte < 9 || (byte > 13 && byte < 32)) count += 1;
	}
	return count / bytes.length <= 0.3;
};

// What an attachment is, for the composer: an image, a PDF, or readable text
// (shown as a text file); anything else is refused. Kilo v2 reads a prompt
// file's type from its bytes, not from its data URL, so this only decides
// what the composer accepts and how it shows the attachment.
const resolveAttachmentMime = async (file: File): Promise<string | undefined> => {
	const type = kind(file.type);
	if (IMAGE_MIMES.has(type)) return type;
	if (type === "application/pdf") return type;

	const suffix = ext(file.name);
	const fallback = IMAGE_EXTS.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined);
	if ((!type || type === "application/octet-stream") && fallback) return fallback;

	if (textMime(type)) return "text/plain";
	const bytes = new Uint8Array(await file.slice(0, SAMPLE).arrayBuffer());
	if (!textBytes(bytes)) return undefined;
	return "text/plain";
};

export type OpenCodeAttachmentAdapterOptions = {
	/**
	 * File picker accept list. Defaults to the list OpenCode's own clients use,
	 * including their extension entries for source files. An override replaces
	 * the whole list; an empty override falls back to the default.
	 */
	accept?: string | undefined;
};

/**
 * Converts browser files into standard assistant-ui attachments: images, PDFs
 * and readable text (unreadable binaries are refused), the payload inline as
 * a data URL with the file's name. The thread controller sends each as one of
 * Kilo v2's prompt `files` (`{ uri, name }`).
 */
export class OpenCodeAttachmentAdapter implements AttachmentAdapter {
	public accept: string;

	constructor(options?: OpenCodeAttachmentAdapterOptions) {
		this.accept = options?.accept || DEFAULT_ACCEPT;
	}

	public async add(state: { file: File }): Promise<PendingAttachment> {
		const mimeType = await resolveAttachmentMime(state.file);
		if (!mimeType) {
			throw new Error(
				`OpenCodeAttachmentAdapter: ${state.file.name} is not an image, a PDF, or readable text`,
			);
		}
		return {
			id: generateId(),
			type: IMAGE_MIMES.has(mimeType) ? "image" : "file",
			name: state.file.name,
			contentType: mimeType,
			file: state.file,
			status: { type: "requires-action", reason: "composer-send" },
		};
	}

	public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
		const url = await getFileDataURL(attachment.file);
		return {
			...attachment,
			status: { type: "complete" },
			content: [
				attachment.type === "image"
					? {
							type: "image",
							image: url,
							filename: attachment.name,
						}
					: {
							type: "file",
							data: url,
							mimeType: attachment.contentType ?? "application/octet-stream",
							filename: attachment.name,
						},
			],
		};
	}

	public async remove() {
		// noop
	}
}
