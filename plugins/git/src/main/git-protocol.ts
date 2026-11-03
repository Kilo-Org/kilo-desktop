import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";

import { KernelError } from "@kilo-desktop/kernel";
import { GitPatchTooLargeError, type GitPatchFile } from "@kilo-desktop/git-client";

/**
 * The service slice the protocol handler needs; `GitService` satisfies it.
 * Structural on purpose so the handler is unit-testable with a fake.
 */
export interface GitProtocolService {
	createPatch(options: { readonly cwd: string }): Promise<GitPatchFile | null>;
	/** Remove a patch file created by {@link GitProtocolService.createPatch}. */
	releasePatch(patchPath: string): Promise<void>;
}

export interface CreateGitProtocolHandlerOptions {
	readonly service: GitProtocolService;
	/** Injectable directory probe so unit tests need no filesystem. */
	readonly existsDirectory?: (directory: string) => Promise<boolean>;
	/** The app's renderer origins, allowed to read kilo-git responses; read per request. */
	readonly allowedOrigins: () => readonly string[];
}

/**
 * Route shape: `kilo-git://diff/patch?cwd=<absolute path>`. URLPattern routes
 * a non-special scheme; the full-match components pin the single endpoint,
 * and any unmatched URL is an unknown endpoint.
 */
const PATCH_ROUTE = new URLPattern("kilo-git://diff/patch");

const defaultExistsDirectory = async (directory: string): Promise<boolean> => {
	try {
		return (await stat(directory)).isDirectory();
	} catch {
		return false;
	}
};

function createTextResponse(
	body: string,
	status: number,
	corsOrigin: string | undefined,
): Response {
	return new Response(body, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
			...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
		},
	});
}

/**
 * `kilo-git://` protocol request handler. Streams the patch file main
 * generates: the node `fs.ReadStream`'s `'close'` event fires both on full
 * consumption and on the destroy `Readable.toWeb` issues when the renderer
 * cancels the fetch (unmount, refresh, abort) — one hook covers every
 * termination path, and `toWeb` handles backpressure itself. A mid-stream
 * read error errors the web stream, so the renderer's fetch rejects into its
 * error state; the patch file is still released because 'close' follows the
 * error destroy.
 *
 * Error contract (text bodies, non-200):
 * - 400 — bad `cwd` (missing, not absolute, not an existing directory)
 * - 403 — the service refused the cwd (outside every workspace folder —
 *   `VALIDATION` KernelError)
 * - 404 — unknown endpoint, or not a git repository (service returned `null`)
 * - 413 — the patch exceeds the size cap; auto-refresh pauses on it
 * - 500 — unexpected failure (message deliberately generic; detail stays in
 *   git-client's log)
 * - 503 — git binary missing (`KernelError` from the service)
 */
export function createGitProtocolHandler(
	options: CreateGitProtocolHandlerOptions,
): (request: Request) => Promise<Response> {
	const existsDirectory = options.existsDirectory ?? defaultExistsDirectory;
	return async (request: Request): Promise<Response> => {
		// Echo only allowed origins; anything else gets no CORS grant (and the
		// renderer's fetch fails closed).
		const origin = request.headers.get("Origin");
		const corsOrigin =
			origin !== null && options.allowedOrigins().includes(origin) ? origin : undefined;

		const routeMatch = PATCH_ROUTE.exec(request.url);
		if (routeMatch === null) {
			return createTextResponse("Unknown endpoint.", 404, corsOrigin);
		}
		// URLPattern only matched because the URL parsed; URL cannot throw here.
		const requestUrl = new URL(request.url);

		const cwd = requestUrl.searchParams.get("cwd");
		if (cwd === null || cwd === "") {
			return createTextResponse("The `cwd` query parameter is required.", 400, corsOrigin);
		}
		if (!isAbsolute(cwd)) {
			return createTextResponse("`cwd` must be an absolute directory path.", 400, corsOrigin);
		}
		if (!(await existsDirectory(cwd))) {
			return createTextResponse("`cwd` must be an existing directory.", 400, corsOrigin);
		}

		let patch: GitPatchFile | null;
		try {
			patch = await options.service.createPatch({ cwd });
		} catch (error) {
			if (error instanceof KernelError) {
				// A VALIDATION KernelError is the service refusing this cwd
				// (outside every workspace folder) — 403. Any other
				// KernelError is a service-availability failure (git binary
				// missing) — 503.
				return createTextResponse(
					error.message,
					error.code === "VALIDATION" ? 403 : 503,
					corsOrigin,
				);
			}
			if (error instanceof GitPatchTooLargeError) {
				return createTextResponse(error.message, 413, corsOrigin);
			}
			return createTextResponse("The diff could not be generated.", 500, corsOrigin);
		}
		if (patch === null) {
			return createTextResponse("Not a git repository.", 404, corsOrigin);
		}

		const releasePatch = () => options.service.releasePatch(patch.patchPath).catch(() => undefined);

		// An empty working tree is a valid state: 200 with an empty body lets
		// the viewer render its "no changes" state instead of an error.
		if (patch.byteLength === 0) {
			await releasePatch();
			return createTextResponse("", 200, corsOrigin);
		}

		try {
			const nodeStream = createReadStream(patch.patchPath);
			nodeStream.on("close", () => {
				void releasePatch();
			});
			return new Response(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, {
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"Cache-Control": "no-store",
					...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
				},
			});
		} catch {
			await releasePatch();
			return createTextResponse("The diff could not be generated.", 500, corsOrigin);
		}
	};
}
