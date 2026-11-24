import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import type { Authorization } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	HTML_RENDER_DOCUMENT_PATH,
	HtmlPages,
	MCP_APP_HOST,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
} from "../../contracts";
import { bootChatMain } from "../test-boot";
import { writeNewFile } from "./files";
import type { WriteNewFile } from "./pages";

async function boot(
	options: {
		writeNewFile?: WriteNewFile;
		authorize?: (path: string) => Authorization;
		embedded?: boolean;
		withoutWorkSessions?: boolean;
	} = {},
) {
	const register = vi.fn((_registration: Record<string, unknown>) => () => undefined);
	const booted = await bootChatMain({
		workSessions: options.withoutWorkSessions
			? null
			: { authorize: options.authorize ?? ((folder) => ({ allowed: true, path: folder })) },
		...(options.writeNewFile ? { writeNewFile: options.writeNewFile } : {}),
		...(options.embedded === false ? {} : { chatHostServices: { embeddedHosts: { register } } }),
	});
	return {
		...booted,
		register,
		pages: booted.chatSdk.domainObjects.get(HtmlPages)!,
	};
}

const context = (chatId: string | null): ToolCallContext => ({
	chatId,
	workSessionId: chatId ? "wses_1" : null,
	workspaceId: null,
	callId: chatId ? "call_1" : null,
	external: chatId === null,
	signal: new AbortController().signal,
});

describe("the html_render tool", () => {
	async function tool() {
		const { kernel } = await boot();
		return kernel.kernelSdk.extensions
			.list(Tool)
			.find((candidate) => candidate.key === "kilo.chat/html_render")!;
	}

	it("is a read-only tool", async () => {
		const contribution = await tool();

		expect(contribution.metadata).toMatchObject({ title: "Show HTML page", readOnly: true });
	});

	it("acknowledges a page shown in a Kilo chat", async () => {
		const { implementation } = await tool();
		const input = implementation!.input.parse({ title: " Chart ", html: "<p>x</p>" });

		expect(await implementation!.run(input, context("ses_1"))).toMatchObject({
			rendered: true,
			title: "Chart",
		});
	});

	it("tells an external caller nobody would see the page", async () => {
		const { implementation } = await tool();
		const input = implementation!.input.parse({ title: "Chart", html: "<p>x</p>" });

		expect(await implementation!.run(input, context(null))).toEqual({
			error: expect.stringContaining("Kilo Desktop chat"),
		});
	});

	it("rejects pages outside the size limits", async () => {
		const { implementation } = await tool();

		expect(implementation!.input.safeParse({ title: "", html: "<p>x</p>" }).success).toBe(false);
		expect(
			implementation!.input.safeParse({ title: "T", html: "<p>x</p>", height: 10 }).success,
		).toBe(false);
	});
});

describe("saving pages", () => {
	it("writes a new file at the folder's root, moving past taken names", async () => {
		const taken = new Set(["/work/Chart.html", "/work/Chart 2.html"]);
		const write = vi.fn(async (file: string) => !taken.has(file));
		const { pages } = await boot({ writeNewFile: write });

		const saved = await pages.methods.save({
			workspaceDirectory: "/work",
			title: "Chart",
			html: "<p>x</p>",
		});

		expect(saved).toEqual({ relativePath: "Chart 3.html" });
		expect(write).toHaveBeenLastCalledWith("/work/Chart 3.html", "<p>x</p>");
	});

	it("saves into the folder kilo.work-sessions resolved", async () => {
		const write = vi.fn(async () => true);
		const { pages, workSessions } = await boot({
			writeNewFile: write,
			authorize: () => ({ allowed: true, path: "/real/work" }),
		});

		await pages.methods.save({ workspaceDirectory: "/link", title: "A/B", html: "x" });

		expect(workSessions!.calls.authorize).toHaveBeenCalledWith("/link");
		expect(write).toHaveBeenCalledWith("/real/work/A B.html", "x");
	});

	it("refuses folders that aren't workspace folders, or any without kilo.work-sessions", async () => {
		for (const options of [
			{ authorize: () => ({ allowed: false }) },
			{ withoutWorkSessions: true },
		]) {
			const write = vi.fn(async () => true);
			const { pages } = await boot({ writeNewFile: write, ...options });

			await expect(
				pages.methods.save({ workspaceDirectory: "/etc", title: "Chart", html: "x" }),
			).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
			expect(write).not.toHaveBeenCalled();
		}
	});

	it("is unavailable without a way to write files", async () => {
		const { pages } = await boot();

		await expect(
			pages.methods.save({ workspaceDirectory: "/work", title: "Chart", html: "x" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	it("gives up after a hundred taken names", async () => {
		const { pages } = await boot({ writeNewFile: async () => false });

		await expect(
			pages.methods.save({ workspaceDirectory: "/work", title: "Chart", html: "x" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
	});
});

describe("writeNewFile", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	async function tempDir() {
		const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-chat-pages-")));
		directories.push(directory);
		return directory;
	}

	it("creates a file and never writes through an existing one or a symlink", async () => {
		const directory = await tempDir();
		const target = path.join(directory, "target.txt");
		await writeFile(target, "keep");
		await symlink(target, path.join(directory, "Link.html"));

		expect(await writeNewFile(path.join(directory, "New.html"), "page")).toBe(true);
		expect(await writeNewFile(path.join(directory, "New.html"), "again")).toBe(false);
		expect(await writeNewFile(path.join(directory, "Link.html"), "evil")).toBe(false);
		expect(await readFile(path.join(directory, "New.html"), "utf8")).toBe("page");
		expect(await readFile(target, "utf8")).toBe("keep");
	});

	it("reports other failures", async () => {
		const directory = await tempDir();

		await expect(writeNewFile(path.join(directory, "missing", "A.html"), "x")).rejects.toThrow();
	});
});

describe("the mcp-app embedded host", () => {
	it("serves the widget and page shells under their own security profiles", async () => {
		const { register } = await boot();

		expect(register).toHaveBeenCalledTimes(1);
		const registration = register.mock.calls[0]![0] as {
			host: string;
			documents: Record<string, string>;
			securityProfiles: Record<string, string>;
		};
		expect(registration.host).toBe(MCP_APP_HOST);
		expect(registration.securityProfiles).toEqual({
			[MCP_APP_WIDGET_DOCUMENT_PATH]: "active-untrusted-content",
			[HTML_RENDER_DOCUMENT_PATH]: "html-render-content",
		});
		expect(registration.documents[HTML_RENDER_DOCUMENT_PATH]).toContain(MCP_APP_SHELL_HTML_MESSAGE);
		expect(registration.documents[MCP_APP_WIDGET_DOCUMENT_PATH]).toContain(
			"event.source !== window.parent",
		);
	});

	it("registers nothing where the host has no embedded hosts", async () => {
		const { register } = await boot({ embedded: false });

		expect(register).not.toHaveBeenCalled();
	});
});
