import {
	resolveFileMediaType,
	resolveImageMediaType,
	toMediaWireUrl,
} from "@assistant-ui/core/internal";
import type { ThreadUserMessagePart } from "./types";

/**
 * A prompt's parts as text: its text, and its images and files by name (or
 * the url that goes out). Parts the prompt never sends render empty.
 */
export const serializeOpenCodeParts = (parts: readonly ThreadUserMessagePart[]) => {
	return parts
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "image") {
				if (part.filename) return part.filename;
				const mime = resolveImageMediaType(
					part.image,
					(part as { contentType?: string }).contentType,
				);
				return toMediaWireUrl(part.image, mime);
			}
			if (part.type === "file") {
				if (part.filename) return part.filename;
				if (part.sourceType === "id") return part.data;
				return toMediaWireUrl(part.data, resolveFileMediaType(part.data, part.mimeType));
			}
			return "";
		})
		.join("\n");
};
