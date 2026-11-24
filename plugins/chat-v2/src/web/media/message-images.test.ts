import { describe, expect, it } from "vitest";

import {
	fileUrlPath,
	imageDataUrl,
	imageMimeForPath,
	SAVED_IMAGES_LIMIT,
	savedImages,
	toolImageAttachments,
} from "./message-images";

const tool = (callID: string, tool: string, state: Record<string, unknown>) => ({
	type: "tool",
	callID,
	tool,
	state: { status: "completed", input: {}, ...state },
});

describe("toolImageAttachments", () => {
	it("returns the call's image attachments only", () => {
		const parts = [
			tool("call_a", "screenshot", {
				attachments: [
					{ type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "a.png" },
					{ type: "file", mime: "text/plain", url: "data:text/plain,hi" },
					{ type: "file", mime: "image/jpeg", url: "" },
				],
			}),
			tool("call_b", "read", {
				attachments: [{ mime: "image/gif", url: "data:image/gif;base64,R0" }],
			}),
		];

		expect(toolImageAttachments(parts, "call_a")).toEqual([
			{ url: "data:image/png;base64,AAAA", filename: "a.png" },
		]);
		expect(toolImageAttachments(parts, "call_b")).toEqual([{ url: "data:image/gif;base64,R0" }]);
		expect(toolImageAttachments(parts, "call_c")).toEqual([]);
		expect(toolImageAttachments(undefined, "call_a")).toEqual([]);
		expect(toolImageAttachments([tool("call_d", "x", {})], "call_d")).toEqual([]);
	});
});

describe("savedImages", () => {
	it("lists images from snapshots and file tools once, at their latest revision", () => {
		const parts = [
			{ type: "patch", hash: "h1", files: ["/w/plot.png", "/w/src/app.ts"] },
			tool("call_1", "write", { input: { filePath: "/w/logo.svg" } }),
			tool("call_2", "write", { status: "running", input: { filePath: "/w/draft.png" } }),
			tool("call_3", "bash", { input: { command: "python plot.py -o plot.png" } }),
			{ type: "patch", hash: "h2", files: ["/w/plot.png"] },
		];

		expect(savedImages(parts)).toEqual({
			images: [
				{ path: "/w/plot.png", revision: "h2" },
				{ path: "/w/logo.svg", revision: "call_1" },
			],
			more: 0,
		});
		expect(savedImages(undefined)).toEqual({ images: [], more: 0 });
	});

	it("skips snapshot images no tool call names, like files a checkout changed", () => {
		const parts = [
			tool("call_1", "bash", { input: { command: "git checkout feature" } }),
			{ type: "patch", hash: "h1", files: ["/w/e2e/fixtures/sample-receipt.png"] },
		];

		expect(savedImages(parts)).toEqual({ images: [], more: 0 });
	});

	it("caps how many it lists", () => {
		const files = Array.from(
			{ length: SAVED_IMAGES_LIMIT + 3 },
			(_, index) => `/w/${String(index)}.png`,
		);

		const { images, more } = savedImages([
			tool("call_1", "bash", { input: { command: `touch ${files.join(" ")}` } }),
			{ type: "patch", hash: "h", files },
		]);

		expect(images).toHaveLength(SAVED_IMAGES_LIMIT);
		expect(more).toBe(3);
	});
});

describe("image files", () => {
	it("knows image types by extension", () => {
		expect(imageMimeForPath("a/B.PNG")).toBe("image/png");
		expect(imageMimeForPath("chart.svg")).toBe("image/svg+xml");
		expect(imageMimeForPath("notes.md")).toBeNull();
		expect(imageMimeForPath("Makefile")).toBeNull();
	});

	it("reads file URLs as paths", () => {
		expect(fileUrlPath("file:///Users/me/My%20Chart.png")).toBe("/Users/me/My Chart.png");
		expect(fileUrlPath("file:///C:/work/chart.png")).toBe("C:/work/chart.png");
		expect(fileUrlPath("https://example.com/a.png")).toBeNull();
	});

	it("turns a file read into a data URL", () => {
		expect(
			imageDataUrl(
				{ type: "text", content: "AQID", encoding: "base64", mimeType: "image/png" },
				"a.png",
			),
		).toBe("data:image/png;base64,AQID");
		expect(imageDataUrl({ type: "binary", content: "AQID", encoding: "base64" }, "b.webp")).toBe(
			"data:image/webp;base64,AQID",
		);
		expect(imageDataUrl({ type: "text", content: "<svg>é</svg>" }, "c.svg")).toBe(
			`data:image/svg+xml;base64,${btoa("<svg>\u00c3\u00a9</svg>")}`,
		);
		expect(imageDataUrl({ type: "text", content: "hello" }, "d.png")).toBeNull();
		expect(imageDataUrl({ type: "binary", content: "" }, "e.png")).toBeNull();
		expect(imageDataUrl({ type: "text", content: "AQID", encoding: "base64" }, "f.bin")).toBeNull();
		expect(imageDataUrl(undefined, "g.png")).toBeNull();
	});
});
