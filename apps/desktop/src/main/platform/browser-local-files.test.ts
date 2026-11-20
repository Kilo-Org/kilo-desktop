import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localFileUrl as browserLocalFileUrl } from "@kilo-desktop/plugin-browser/contracts";

vi.mock("electron", () => ({ net: {}, protocol: {} }));

import { serveBrowserLocalFile } from "./browser-local-files.js";

let root: string;
let workspace: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-browser-files-")));
	workspace = path.join(root, "project");
	await mkdir(path.join(workspace, "assets"), { recursive: true });
	await writeFile(path.join(workspace, "Chart one.html"), "<p>chart</p>");
	await writeFile(path.join(workspace, "assets", "style.css"), "p{}");
	await writeFile(path.join(root, "secret.txt"), "secret");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const insideWorkspace = async (canonicalPath: string) =>
	canonicalPath.startsWith(`${workspace}${path.sep}`);
const request = (filePath: string) => new Request(browserLocalFileUrl(filePath));

describe("serveBrowserLocalFile", () => {
	it("serves an authorized file with its type and the local-file CSP", async () => {
		const response = await serveBrowserLocalFile(
			request(path.join(workspace, "Chart one.html")),
			insideWorkspace,
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<p>chart</p>");
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
		expect(response.headers.get("Content-Security-Policy")).toContain("style-src 'self'");
	});

	it("resolves a page's relative assets against its folder", async () => {
		const page = browserLocalFileUrl(path.join(workspace, "Chart one.html"));
		const asset = new URL("assets/style.css", page).href;

		const response = await serveBrowserLocalFile(new Request(asset), insideWorkspace);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
	});

	it("refuses files outside the authorized folders, including via .. and symlinks", async () => {
		await symlink(path.join(root, "secret.txt"), path.join(workspace, "link.txt"));
		const escapes = [
			request(path.join(root, "secret.txt")),
			new Request(`${browserLocalFileUrl(workspace)}/../secret.txt`),
			request(path.join(workspace, "link.txt")),
			request(path.join(workspace, "missing.html")),
			request(path.join(workspace, "assets")),
		];

		for (const escape of escapes) {
			expect((await serveBrowserLocalFile(escape, insideWorkspace)).status).toBe(404);
		}
		expect((await serveBrowserLocalFile(request(workspace), undefined)).status).toBe(404);
	});
});
