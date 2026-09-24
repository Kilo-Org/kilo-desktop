import { getDomain } from "tldts";

import { readLimitedBody } from "./limited-body.js";
import { isPublicDestination, systemHostLookup, type HostLookup } from "./public-destination.js";

const MAX_ICON_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

type IconFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type McpCatalogIconSource = {
	readonly url: string;
	readonly content: string | ReadonlyArray<{ readonly content: string }>;
	readonly icons?: ReadonlyArray<{ readonly src: string }> | undefined;
};

const MIME_SIGNATURES = [
	{
		mimeType: "image/png",
		matches: (bytes: Uint8Array) => bytes.subarray(0, 8).toString() === "137,80,78,71,13,10,26,10",
	},
	{
		mimeType: "image/jpeg",
		matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8,
	},
	{
		mimeType: "image/webp",
		matches: (bytes: Uint8Array) =>
			String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
			String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP",
	},
	{
		mimeType: "image/x-icon",
		matches: (bytes: Uint8Array) =>
			bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0,
	},
] as const;

async function fetchImageDataUrl(
	source: URL,
	fetch: IconFetch,
	lookup: HostLookup,
): Promise<string | undefined> {
	try {
		if (source.protocol !== "https:" || source.hostname === "github.com") return undefined;
		if (!(await isPublicDestination(source, lookup))) return undefined;
		const response = await fetch(source, {
			credentials: "omit",
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const bytes = await readLimitedBody(response, MAX_ICON_BYTES);
		if (!bytes?.byteLength) return undefined;
		const detected = MIME_SIGNATURES.find(({ matches }) => matches(bytes));
		if (!detected) return undefined;
		return `data:${detected.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
	} catch {
		return undefined;
	}
}

/** Fetches an origin favicon as inert, size-limited image bytes for the renderer. */
export async function resolveMcpIconDataUrl(
	serverUrl: string,
	fetch: IconFetch,
	lookup: HostLookup = systemHostLookup,
): Promise<string | undefined> {
	try {
		const origin = new URL(serverUrl);
		return fetchImageDataUrl(new URL("/favicon.ico", origin.origin), fetch, lookup);
	} catch {
		return undefined;
	}
}

function remoteMcpUrl(content: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const entry = parsed as Record<string, unknown>;
		if (entry.type !== undefined && entry.type !== "remote") return undefined;
		if (typeof entry.url !== "string") return undefined;
		const url = new URL(entry.url);
		return url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

export function mcpIconCandidateUrls(item: McpCatalogIconSource): string[] {
	const methods =
		typeof item.content === "string" ? [item.content] : item.content.map(({ content }) => content);
	const remoteUrls = methods.flatMap((content) => {
		const url = remoteMcpUrl(content);
		return url ? [url] : [];
	});
	let catalogUrl: string | undefined;
	try {
		const url = new URL(item.url);
		if (url.protocol === "https:" && url.hostname !== "github.com") catalogUrl = url.toString();
	} catch {
		// Catalog validation normally prevents malformed URLs.
	}
	return [...new Set([...remoteUrls, ...(catalogUrl ? [catalogUrl] : [])])];
}

export class McpIconResolver {
	readonly #cache = new Map<string, Promise<string | undefined>>();

	readonly #fetch: IconFetch;
	readonly #lookup: HostLookup;

	constructor(fetch: IconFetch, options: { lookup?: HostLookup } = {}) {
		this.#fetch = fetch;
		this.#lookup = options.lookup ?? systemHostLookup;
	}

	async resolve(serverUrl: string): Promise<string | undefined> {
		let url: URL;
		try {
			url = new URL(serverUrl);
		} catch {
			return undefined;
		}
		const rootDomain = getDomain(url.hostname);
		const origins =
			rootDomain && rootDomain !== url.hostname
				? [`https://${rootDomain}`, url.origin]
				: [url.origin];
		for (const origin of origins) {
			const icon = await this.#resolveOrigin(origin);
			if (icon) return icon;
		}
		return undefined;
	}

	#resolveOrigin(origin: string): Promise<string | undefined> {
		const cached = this.#cache.get(origin);
		if (cached) return cached;
		const resolved = resolveMcpIconDataUrl(origin, this.#fetch, this.#lookup);
		this.#cache.set(origin, resolved);
		return resolved;
	}

	async resolveFirst(serverUrls: readonly string[]): Promise<string | undefined> {
		for (const url of serverUrls) {
			const icon = await this.resolve(url);
			if (icon) return icon;
		}
		return undefined;
	}

	async resolveExplicit(iconUrls: readonly string[]): Promise<string | undefined> {
		for (const iconUrl of iconUrls) {
			try {
				const icon = await fetchImageDataUrl(new URL(iconUrl), this.#fetch, this.#lookup);
				if (icon) return icon;
			} catch {
				// Continue to the next server-provided icon.
			}
		}
		return undefined;
	}
}
