import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { net, protocol } from "electron";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "anaconda-desktop";
export const DESKTOP_DEVELOPMENT_SCHEME = "anaconda-desktop-dev";

const MIME_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export function getDesktopScheme(isDevelopment: boolean): string {
	return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopUrl(isDevelopment: boolean): string {
	return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}/`;
}

export function registerDesktopSchemes(): void {
	protocol.registerSchemesAsPrivileged(
		[DESKTOP_PRODUCTION_SCHEME, DESKTOP_DEVELOPMENT_SCHEME].map((scheme) => ({
			scheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		})),
	);
}

export function createContentSecurityPolicy(
	developmentOrigin?: string,
	inlineScriptHashes: readonly string[] = [],
): string {
	const developmentSources = developmentOrigin ? ` ${new URL(developmentOrigin).origin} ws:` : "";
	const trustedInlineScripts = inlineScriptHashes.map((hash) => ` 'sha256-${hash}'`).join("");
	return [
		"default-src 'self'",
		`script-src 'self'${developmentSources}${trustedInlineScripts}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		`connect-src 'self'${developmentSources}`,
		"object-src 'none'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

export async function resolveRendererPath(
	rendererRoot: string,
	requestPathname: string,
): Promise<string | undefined> {
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(requestPathname);
	} catch {
		return undefined;
	}
	if (decodedPath.includes("\0")) return undefined;

	const relativePath = decodedPath.replace(/^\/+/, "");
	const initialPath = path.resolve(rendererRoot, relativePath || "index.html");
	const rendererPrefix = `${path.resolve(rendererRoot)}${path.sep}`;
	if (initialPath !== path.resolve(rendererRoot) && !initialPath.startsWith(rendererPrefix)) {
		return undefined;
	}

	const candidates = path.extname(initialPath)
		? [initialPath]
		: [path.join(initialPath, "index.html"), `${initialPath}.html`];

	for (const candidate of candidates) {
		if (!candidate.startsWith(rendererPrefix)) continue;
		try {
			if ((await stat(candidate)).isFile()) return candidate;
		} catch {
			// Try the next route representation.
		}
	}
	return undefined;
}

function getInlineScriptHashes(document: string): string[] {
	return [...document.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
		([, source]) =>
			createHash("sha256")
				.update(source ?? "")
				.digest("base64"),
	);
}

async function withSecurityHeaders(
	response: Response,
	developmentOrigin?: string,
): Promise<Response> {
	const headers = new Headers(response.headers);
	let body: BodyInit | null = response.body;
	let inlineScriptHashes: string[] = [];
	if (headers.get("Content-Type")?.toLowerCase().includes("text/html")) {
		const bytes = await response.arrayBuffer();
		body = bytes;
		inlineScriptHashes = getInlineScriptHashes(new TextDecoder().decode(bytes));
	}
	headers.set(
		"Content-Security-Policy",
		createContentSecurityPolicy(developmentOrigin, inlineScriptHashes),
	);
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export class ElectronProtocol {
	#registeredScheme: string | undefined;

	register(input: {
		readonly isDevelopment: boolean;
		readonly rendererRoot: string;
		readonly developmentOrigin?: string;
	}): void {
		const scheme = getDesktopScheme(input.isDevelopment);
		if (this.#registeredScheme === scheme) return;

		protocol.handle(scheme, async (request) => {
			const requestUrl = new URL(request.url);
			if (requestUrl.host !== DESKTOP_HOST) {
				return withSecurityHeaders(new Response(null, { status: 404 }), input.developmentOrigin);
			}

			if (input.isDevelopment && input.developmentOrigin) {
				const targetUrl = new URL(
					`${requestUrl.pathname}${requestUrl.search}`,
					input.developmentOrigin,
				);
				const response = await net.fetch(targetUrl.toString(), {
					method: request.method,
				});
				return withSecurityHeaders(response, input.developmentOrigin);
			}

			const filePath = await resolveRendererPath(input.rendererRoot, requestUrl.pathname);
			if (!filePath) {
				return withSecurityHeaders(new Response(null, { status: 404 }), input.developmentOrigin);
			}
			const body = Uint8Array.from(await readFile(filePath));
			return withSecurityHeaders(
				new Response(body, {
					headers: {
						"Content-Type":
							MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
					},
				}),
				input.developmentOrigin,
			);
		});
		this.#registeredScheme = scheme;
	}

	dispose(): void {
		if (!this.#registeredScheme) return;
		protocol.unhandle(this.#registeredScheme);
		this.#registeredScheme = undefined;
	}
}
