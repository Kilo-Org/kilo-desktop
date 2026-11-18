import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { KernelError } from "@kilo-desktop/kernel";
import { GitPatchTooLargeError, type GitPatchFile } from "@kilo-desktop/git-client";

import { createGitProtocolHandler, type GitProtocolService } from "./git-protocol";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) =>
				rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
			),
	);
});

/** Fake service slice with a `releasePatch` spy and a controllable result. */
function createFakeService(result: () => Promise<GitPatchFile | null>) {
	const createdPatchOptions: { cwd: string; unlimited?: boolean }[] = [];
	const releasePatch = vi.fn(async () => {});
	const service: GitProtocolService = {
		async createPatch(options) {
			createdPatchOptions.push({ ...options });
			return result();
		},
		releasePatch,
	};
	return { service, createdPatchOptions, releasePatch };
}

/** A patch backed by a real temp file, as git-client now returns it. */
async function createFilePatch(contents: string): Promise<GitPatchFile> {
	const directory = await mkdtemp(path.join(tmpdir(), "git-protocol-test-"));
	temporaryDirectories.push(directory);
	const patchPath = path.join(directory, "changes.patch");
	await writeFile(patchPath, contents);
	return { patchPath, byteLength: Buffer.byteLength(contents) };
}

const alwaysExists = async () => true;
const neverExists = async () => false;

function requestFor(url: string, origin?: string): Request {
	return new Request(url, origin ? { headers: { Origin: origin } } : undefined);
}

const DESKTOP_ORIGIN = "kilo-desktop://app";
const allowedOrigins = () => [DESKTOP_ORIGIN, "kilo-desktop-dev://app"];

describe("createGitProtocolHandler", () => {
	it("rejects a non-endpoint URL with 404", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://other/patch?cwd=/repo"));
		expect(response.status).toBe(404);
	});

	it("rejects a missing or non-absolute cwd with 400", async () => {
		const { service, createdPatchOptions } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		expect((await handler(requestFor("kilo-git://diff/patch"))).status).toBe(400);
		expect((await handler(requestFor("kilo-git://diff/patch?cwd="))).status).toBe(400);
		expect((await handler(requestFor("kilo-git://diff/patch?cwd=relative/path"))).status).toBe(400);
		expect(createdPatchOptions).toEqual([]);
	});

	it("rejects an unlimited value other than 1 with 400", async () => {
		const { service, createdPatchOptions } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		for (const value of ["true", "0", ""]) {
			const response = await handler(
				requestFor(`kilo-git://diff/patch?cwd=/repo&unlimited=${value}`),
			);
			expect(response.status).toBe(400);
			expect(await response.text()).toContain("`unlimited`");
		}
		expect(createdPatchOptions).toEqual([]);
	});

	it("rejects a cwd that is not an existing directory with 400", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: neverExists,
			allowedOrigins,
		});
		expect(
			(await handler(requestFor("kilo-git://diff/patch?cwd=/definitely/not/a/repo"))).status,
		).toBe(400);
	});

	it("returns 404 when the service says the directory is not a repository", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Not a git repository");
	});

	it("returns 503 with the KernelError message when git is missing", async () => {
		const { service } = createFakeService(async () => {
			throw new KernelError("BUSINESS", "Git executable not found.");
		});
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(503);
		expect(await response.text()).toContain("Git executable not found");
	});

	it("returns 403 with the KernelError message when the cwd is refused by the service", async () => {
		const { service } = createFakeService(async () => {
			throw new KernelError("VALIDATION", '"/outside/workspace" is not inside a workspace folder.');
		});
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/outside/workspace"));
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("not inside a workspace folder");
	});

	it("returns 413 with the error message when the patch exceeds the size cap", async () => {
		const tooLarge = new GitPatchTooLargeError(12 * 1024 * 1024, 10 * 1024 * 1024);
		const { service } = createFakeService(async () => {
			throw tooLarge;
		});
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(413);
		expect(await response.text()).toBe(tooLarge.message);
	});

	it("exposes the oversized patch's byte length to the allowed origin", async () => {
		const { service } = createFakeService(async () => {
			throw new GitPatchTooLargeError(12 * 1024 * 1024, 10 * 1024 * 1024);
		});
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo", DESKTOP_ORIGIN));
		expect(response.headers.get("X-Patch-Byte-Length")).toBe(String(12 * 1024 * 1024));
		expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Patch-Byte-Length");
	});

	it("asks the service for an uncapped patch only with unlimited=1", async () => {
		const { service, createdPatchOptions } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		await handler(requestFor("kilo-git://diff/patch?cwd=/repo&unlimited=1"));
		expect(createdPatchOptions).toEqual([
			{ cwd: "/repo", unlimited: false },
			{ cwd: "/repo", unlimited: true },
		]);
	});

	it("returns 500 with a generic message on unexpected service failures", async () => {
		const { service } = createFakeService(async () => {
			throw new Error("secret detail from /Users/someone");
		});
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).toContain("The diff could not be generated.");
		expect(body).not.toContain("secret detail");
	});

	it("streams a generated patch and releases it after the stream closes", async () => {
		const patch = await createFilePatch(
			"diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-a\n+b\n",
		);
		const { service, releasePatch } = createFakeService(async () => patch);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo", DESKTOP_ORIGIN));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(DESKTOP_ORIGIN);
		// Consuming the body is what retires the stream, so release must not
		// have run yet at this point.
		expect(releasePatch).not.toHaveBeenCalled();
		expect(await response.text()).toContain("diff --git a/foo b/foo");
		await vi.waitFor(() => {
			expect(releasePatch).toHaveBeenCalledTimes(1);
		});
		expect(releasePatch).toHaveBeenCalledWith(patch.patchPath);
	});

	it("releases the patch when the renderer cancels mid-stream", async () => {
		const patch = await createFilePatch("diff --git a/foo b/foo\n@@ -1 +1 @@\n-a\n+b\n");
		const { service, releasePatch } = createFakeService(async () => patch);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.body).not.toBeNull();
		await response.body!.cancel();
		await vi.waitFor(() => {
			expect(releasePatch).toHaveBeenCalledTimes(1);
		});
	});

	it("returns 200 with an empty body for a zero-byte patch", async () => {
		const patch = await createFilePatch("");
		const { service, releasePatch } = createFakeService(async () => patch);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});

		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
		expect(releasePatch).toHaveBeenCalledTimes(1);
		expect(releasePatch).toHaveBeenCalledWith(patch.patchPath);
	});

	it("omits the CORS header for a foreign origin", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", "https://evil.example"),
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("echoes every allowed origin", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins,
		});
		const response = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", "kilo-desktop-dev://app"),
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("kilo-desktop-dev://app");
	});

	it("reads the allowlist per request and echoes only what it holds", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({
			service,
			existsDirectory: alwaysExists,
			allowedOrigins: () => [DESKTOP_ORIGIN],
		});

		const devResponse = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", "kilo-desktop-dev://app"),
		);
		expect(devResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();

		const prodResponse = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", DESKTOP_ORIGIN),
		);
		expect(prodResponse.headers.get("Access-Control-Allow-Origin")).toBe(DESKTOP_ORIGIN);
	});
});
