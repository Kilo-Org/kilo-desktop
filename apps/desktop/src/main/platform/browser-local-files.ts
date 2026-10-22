import { readFile, realpath, stat } from "node:fs/promises";

import {
	browserLocalFilePath,
	createBrowserLocalFileContentSecurityPolicy,
} from "@kilo-desktop/feature-sdk/main";

import { contentTypeFor } from "./ElectronProtocol.js";

/** Larger files are refused rather than buffered into the main process. */
const MAX_LOCAL_FILE_BYTES = 64 * 1024 * 1024;

export type LocalFileAuthorizer = (canonicalPath: string) => Promise<boolean>;

// One answer for every refusal, so a page cannot probe which local paths exist.
const notFound = () => new Response("Not found", { status: 404 });

/**
 * Answers a `kilo-file:` request from the browser guest. The path comes from
 * the URL, which a page can choose, so it is canonicalized (resolving `..`
 * and symlinks) before `authorize` sees it, and only regular files are read.
 */
export async function serveBrowserLocalFile(
	request: Request,
	authorize: LocalFileAuthorizer | undefined,
	windows = process.platform === "win32",
): Promise<Response> {
	const requested = browserLocalFilePath(request.url, windows);
	if (!requested || !authorize) return notFound();
	let canonical: string;
	try {
		canonical = await realpath(requested);
	} catch {
		return notFound();
	}
	if (!(await authorize(canonical).catch(() => false))) return notFound();
	try {
		const info = await stat(canonical);
		if (!info.isFile() || info.size > MAX_LOCAL_FILE_BYTES) return notFound();
		return new Response(await readFile(canonical), {
			headers: {
				"Content-Type": contentTypeFor(canonical),
				"Content-Security-Policy": createBrowserLocalFileContentSecurityPolicy(),
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "no-store",
			},
		});
	} catch {
		return notFound();
	}
}
