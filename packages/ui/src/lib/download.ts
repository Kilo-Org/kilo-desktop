const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/avif": "avif",
	"image/bmp": "bmp",
};

export function extensionForMime(mime: string): string {
	return MIME_EXTENSIONS[mime.toLowerCase()] ?? "png";
}

/** `20261106-091500`, for filenames that sort by time and are valid on every OS. */
export function timestampForFilename(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
		date.getHours(),
	)}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** A lowercase, dash-separated filename stem; `fallback` when nothing usable is left. */
export function slugForFilename(text: string, fallback = "download"): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 60);
	return slug || fallback;
}

/** The MIME type of a `data:` URL, or null for anything else. */
export function dataUrlMime(url: string): string | null {
	const match = /^data:([^;,]*)/iu.exec(url);
	if (!match) return null;
	return match[1] || "text/plain";
}

function decodePercentPayload(payload: string): string {
	try {
		return decodeURIComponent(payload);
	} catch {
		throw new Error("Malformed data URL.");
	}
}

/**
 * Decodes a `data:` URL without `fetch`, which the renderer's CSP
 * (`connect-src`) does not allow for data URLs.
 */
export function dataUrlToBlob(url: string): Blob {
	const comma = url.indexOf(",");
	if (!url.startsWith("data:") || comma < 0) throw new Error("Not a data URL.");
	const header = url.slice(5, comma);
	const payload = url.slice(comma + 1);
	const mime = header.split(";")[0] || "text/plain";
	if (!/;base64$/iu.test(header)) return new Blob([decodePercentPayload(payload)], { type: mime });
	const binary = atob(payload);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return new Blob([bytes], { type: mime });
}

function clickDownloadLink(href: string, filename: string): void {
	const link = document.createElement("a");
	link.href = href;
	link.download = filename;
	link.rel = "noopener";
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
}

/** Saves `blob` through the browser download flow (Electron shows its save dialog). */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	clickDownloadLink(url, filename);
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Saves the bytes behind an image `src`: data URLs are decoded, blob and same-origin URLs linked. */
export function downloadUrl(src: string, filename: string): void {
	if (src.startsWith("data:")) downloadBlob(dataUrlToBlob(src), filename);
	else clickDownloadLink(src, filename);
}
