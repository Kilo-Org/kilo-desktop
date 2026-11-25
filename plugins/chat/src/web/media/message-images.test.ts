import { describe, expect, it } from "vitest";

import {
	fileUrlPath,
	imageDataUrl,
	imageMimeForPath,
	SAVED_IMAGES_LIMIT,
	savedImages,
	toolImageAttachments,
} from "./message-images";
import { assistantMessage, idleMessage, tool, userMessage } from "../../test/kilo2/fixtures";

const withFiles = (
	name: string,
	content: Array<
		{ type: "file"; uri: string; mime: string; name?: string } | { type: "text"; text: string }
	>,
) =>
	tool(name, {}, "", {
		state: { status: "completed", input: {}, content: content as never, metadata: {} },
	});

describe("toolImageAttachments", () => {
	it("returns the call's image file content only", () => {
		const screenshot = withFiles("browser_take_screenshot", [
			{ type: "text", text: "Took a screenshot" },
			{ type: "file", mime: "image/png", uri: "data:image/png;base64,AAAA", name: "a.png" },
			{ type: "file", mime: "text/plain", uri: "data:text/plain,hi" },
			{ type: "file", mime: "image/jpeg", uri: "" },
		]);
		const read = withFiles("read", [
			{ type: "file", mime: "image/gif", uri: "data:image/gif;base64,R0" },
		]);
		const messages = [userMessage("look"), assistantMessage([screenshot, read])];

		expect(toolImageAttachments(messages, screenshot.id)).toEqual([
			{ url: "data:image/png;base64,AAAA", filename: "a.png" },
		]);
		expect(toolImageAttachments(messages, read.id)).toEqual([{ url: "data:image/gif;base64,R0" }]);
		expect(toolImageAttachments(messages, "call_missing")).toEqual([]);
		expect(toolImageAttachments([], screenshot.id)).toEqual([]);
		const failed = tool("read", {}, { error: { type: "unknown", message: "nope" } });
		expect(toolImageAttachments([assistantMessage([failed])], failed.id)).toEqual([]);
	});
});

const patchCall = (files: readonly { file: string; status: string }[]) =>
	tool("patch", { patchText: "" }, "Success.", {
		state: {
			status: "completed",
			input: { patchText: "" },
			content: [{ type: "text", text: "Success." }],
			metadata: {
				files: files.map((file) => ({ ...file, patch: "", additions: 1, deletions: 0 })),
			} as never,
		},
	});

describe("savedImages", () => {
	it("lists images file tools wrote once, at their latest revision", () => {
		const logo = tool("write", { path: "/w/logo.svg" });
		const draft = tool("write", { path: "/w/draft.png" }, "", {
			state: { status: "running", input: { path: "/w/draft.png" }, metadata: {} },
		});
		const firstPlot = patchCall([
			{ file: "/w/plot.png", status: "added" },
			{ file: "/w/src/app.ts", status: "modified" },
			{ file: "/w/old.png", status: "deleted" },
		]);
		const secondPlot = tool("edit", { path: "/w/plot.png" });
		const messages = [
			userMessage("draw"),
			assistantMessage([firstPlot, logo]),
			assistantMessage([tool("shell", { command: "python plot.py" }), draft, secondPlot]),
			idleMessage(),
		];

		expect(savedImages(messages)).toEqual({
			images: [
				{ path: "/w/plot.png", revision: secondPlot.id },
				{ path: "/w/logo.svg", revision: logo.id },
			],
			more: 0,
		});
		expect(savedImages([])).toEqual({ images: [], more: 0 });
	});

	it("caps how many it lists", () => {
		const files = Array.from({ length: SAVED_IMAGES_LIMIT + 3 }, (_, index) => ({
			file: `/w/${String(index)}.png`,
			status: "added",
		}));

		const { images, more } = savedImages([assistantMessage([patchCall(files)])]);

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
