import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseNewestFullRelease, UpdateFeedError, WindowsUpdateFeed } from "./WindowsUpdateFeed.js";

const FEED = "https://updates.example.com/kilo-desktop/latest/win32/x64";
const PACKAGE = Buffer.from("full package bytes for 1.2.3");
const SHA1 = createHash("sha1").update(PACKAGE).digest("hex").toUpperCase();
const FILE_NAME = "KiloDesktop-1.2.3-full.nupkg";
const RELEASES = `\uFEFF${SHA1} ${FILE_NAME} ${PACKAGE.length}`;

let directory: string;

beforeEach(async () => {
	directory = path.join(await mkdtemp(path.join(tmpdir(), "windows-feed-")), "squirrel-feed");
});

afterEach(async () => {
	await rm(path.dirname(directory), { recursive: true, force: true });
});

function serve(routes: Record<string, (init?: RequestInit) => Response>) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const route = routes[String(input)];
		return route ? route(init) : new Response("missing", { status: 404 });
	});
}

function createFeed(fetch: ReturnType<typeof serve>) {
	return new WindowsUpdateFeed({
		directory,
		packageName: "KiloDesktop",
		fetch: fetch as typeof globalThis.fetch,
	});
}

function prepare(feed: WindowsUpdateFeed, currentVersion = "1.2.2") {
	const onDownloadStart = vi.fn();
	const result = feed.prepare({
		remoteFeedUrl: FEED,
		currentVersion,
		signal: new AbortController().signal,
		onDownloadStart,
	});
	return { result, onDownloadStart };
}

describe("parseNewestFullRelease", () => {
	it("picks the newest full package for the app and ignores deltas and other ids", () => {
		const body = [
			`${"A".repeat(40)} KiloDesktop-1.2.3-full.nupkg 10`,
			`${"B".repeat(40)} KiloDesktop-1.2.4-delta.nupkg 5`,
			`${"C".repeat(40)} KiloDesktop-1.2.4-preview-261001-00302-full.nupkg 11`,
			`${"D".repeat(40)} OtherApp-9.9.9-full.nupkg 12`,
		].join("\r\n");

		expect(parseNewestFullRelease(body, "KiloDesktop")).toEqual({
			sha1: "C".repeat(40),
			fileName: "KiloDesktop-1.2.4-preview-261001-00302-full.nupkg",
			size: 11,
			version: "1.2.4-preview-261001-00302",
		});
	});

	it("rejects file names that could escape the mirror directory", () => {
		const body = `${"A".repeat(40)} ..\\KiloDesktop-1.2.3-full.nupkg 10`;
		expect(parseNewestFullRelease(body, "KiloDesktop")).toBeNull();
	});
});

describe("WindowsUpdateFeed", () => {
	it("mirrors a newer verified package with a single-entry RELEASES file", async () => {
		const fetch = serve({
			[`${FEED}/RELEASES`]: () => new Response(RELEASES),
			[`${FEED}/${FILE_NAME}`]: () => new Response(PACKAGE),
		});
		const { result, onDownloadStart } = prepare(createFeed(fetch));

		await expect(result).resolves.toEqual({ kind: "ready", version: "1.2.3" });
		expect(onDownloadStart).toHaveBeenCalledWith("1.2.3");
		expect(await readFile(path.join(directory, FILE_NAME))).toEqual(PACKAGE);
		expect(await readFile(path.join(directory, "RELEASES"), "utf8")).toBe(
			`${SHA1} ${FILE_NAME} ${PACKAGE.length}`,
		);
	});

	it("reports up to date without downloading and clears stale mirrors", async () => {
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "KiloDesktop-1.2.3-full.nupkg"), "stale");
		const fetch = serve({ [`${FEED}/RELEASES`]: () => new Response(RELEASES) });
		const { result, onDownloadStart } = prepare(createFeed(fetch), "1.2.3");

		await expect(result).resolves.toEqual({ kind: "up-to-date" });
		expect(onDownloadStart).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledOnce();
		expect(await readdir(path.dirname(directory))).toEqual([]);
	});

	it("reuses a verified package without downloading it again", async () => {
		const fetch = serve({
			[`${FEED}/RELEASES`]: () => new Response(RELEASES),
			[`${FEED}/${FILE_NAME}`]: () => new Response(PACKAGE),
		});
		const feed = createFeed(fetch);
		await prepare(feed).result;
		fetch.mockClear();

		const { result, onDownloadStart } = prepare(feed);

		await expect(result).resolves.toMatchObject({ kind: "ready" });
		expect(onDownloadStart).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("resumes a partial download with a Range request", async () => {
		const split = 10;
		const fetch = serve({
			[`${FEED}/RELEASES`]: () => new Response(RELEASES),
			[`${FEED}/${FILE_NAME}`]: (init) => {
				expect(new Headers(init?.headers).get("Range")).toBe(`bytes=${split}-`);
				return new Response(PACKAGE.subarray(split), { status: 206 });
			},
		});
		const feed = createFeed(fetch);
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, `${FILE_NAME}.partial`), PACKAGE.subarray(0, split));

		await expect(prepare(feed).result).resolves.toMatchObject({ kind: "ready" });
		expect(await readFile(path.join(directory, FILE_NAME))).toEqual(PACKAGE);
	});

	it("rejects a package whose checksum does not match RELEASES", async () => {
		const tampered = Buffer.from(PACKAGE).fill(0x41, 0, 4);
		const fetch = serve({
			[`${FEED}/RELEASES`]: () => new Response(RELEASES),
			[`${FEED}/${FILE_NAME}`]: () => new Response(tampered),
		});

		await expect(prepare(createFeed(fetch)).result).rejects.toThrow("failed verification");
		expect(await readdir(directory)).toEqual([]);
	});

	it("surfaces the HTTP status when the update server refuses the request", async () => {
		const fetch = serve({
			[`${FEED}/RELEASES`]: () => new Response("blocked", { status: 403 }),
		});

		const error = await prepare(createFeed(fetch)).result.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(UpdateFeedError);
		expect(error).toMatchObject({ status: 403 });
	});
});
