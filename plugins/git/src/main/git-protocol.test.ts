import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FeatureError } from "@kilo-desktop/feature-sdk";
import type { GitPatchFile } from "@kilo-desktop/git-client";

import { createGitProtocolHandler, type GitProtocolService } from "./git-protocol.js";

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
	const createdPatchOptions: { cwd: string }[] = [];
	const releasePatch = vi.fn(async () => {});
	const service: GitProtocolService = {
		async createPatch(options) {
			createdPatchOptions.push({ cwd: options.cwd });
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

describe("PATCH_ROUTE (URLPattern on a non-special scheme)", () => {
	it("matches the patch endpoint with and without a query string", () => {
		expect(new URLPattern("kilo-git://diff/patch").test("kilo-git://diff/patch")).toBe(true);
		expect(new URLPattern("kilo-git://diff/patch").test("kilo-git://diff/patch?cwd=/repo")).toBe(
			true,
		);
	});

	it("rejects other hosts, paths, and schemes", () => {
		const route = new URLPattern("kilo-git://diff/patch");
		expect(route.test("kilo-git://other/patch?cwd=/repo")).toBe(false);
		expect(route.test("kilo-git://diff/?cwd=/repo")).toBe(false);
		expect(route.test("kilo-git://diff/patch/extra?cwd=/repo")).toBe(false);
		expect(route.test("kilo-git://diff/patchx?cwd=/repo")).toBe(false);
		expect(route.test("https://diff/patch?cwd=/repo")).toBe(false);
		expect(route.test("git://diff/patch?cwd=/repo")).toBe(false);
	});
});

describe("createGitProtocolHandler", () => {
	it("rejects a non-endpoint URL with 404", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(requestFor("kilo-git://other/patch?cwd=/repo"));
		expect(response.status).toBe(404);
	});

	it("rejects a missing or non-absolute cwd with 400", async () => {
		const { service, createdPatchOptions } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });

		expect((await handler(requestFor("kilo-git://diff/patch"))).status).toBe(400);
		expect((await handler(requestFor("kilo-git://diff/patch?cwd="))).status).toBe(400);
		expect((await handler(requestFor("kilo-git://diff/patch?cwd=relative/path"))).status).toBe(400);
		expect(createdPatchOptions).toEqual([]);
	});

	it("rejects a cwd that is not an existing directory with 400", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: neverExists });
		expect(
			(await handler(requestFor("kilo-git://diff/patch?cwd=/definitely/not/a/repo"))).status,
		).toBe(400);
	});

	it("returns 404 when the service says the directory is not a repository", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Not a git repository");
	});

	it("returns 503 with the FeatureError message when git is missing", async () => {
		const { service } = createFakeService(async () => {
			throw new FeatureError("Git executable not found.", "BUSINESS");
		});
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(503);
		expect(await response.text()).toContain("Git executable not found");
	});

	it("returns 403 with the FeatureError message when the cwd is refused by the service", async () => {
		const { service } = createFakeService(async () => {
			throw new FeatureError(
				'"/outside/workspace" is not inside a workspace folder.',
				"VALIDATION",
			);
		});
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/outside/workspace"));
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("not inside a workspace folder");
	});

	it("returns 500 with a generic message on unexpected service failures", async () => {
		const { service } = createFakeService(async () => {
			throw new Error("secret detail from /Users/someone");
		});
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
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
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });

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
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });

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
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });

		const response = await handler(requestFor("kilo-git://diff/patch?cwd=/repo"));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
		expect(releasePatch).toHaveBeenCalledTimes(1);
		expect(releasePatch).toHaveBeenCalledWith(patch.patchPath);
	});

	it("omits the CORS header for a foreign origin", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", "https://evil.example"),
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("echoes the development scheme origin too", async () => {
		const { service } = createFakeService(async () => null);
		const handler = createGitProtocolHandler({ service, existsDirectory: alwaysExists });
		const response = await handler(
			requestFor("kilo-git://diff/patch?cwd=/repo", "kilo-desktop-dev://app"),
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("kilo-desktop-dev://app");
	});
});
