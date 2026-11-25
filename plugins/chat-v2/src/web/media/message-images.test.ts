import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

import {
	fileUrlPath,
	imageDataUrl,
	imageMimeForPath,
	SAVED_IMAGES_LIMIT,
	savedImages,
	toolImageAttachments,
} from "./message-images";

const tool = (id: string, name: string, state: Record<string, unknown>) => ({
	type: "tool",
	id,
	name,
	time: { created: 1 },
	state: { status: "completed", input: {}, content: [{ type: "text", text: "" }], ...state },
});

/** A step with `content`, whose snapshot lists `files` as changed and ends at `end`. */
const step = (id: string, content: unknown[], files?: string[], end?: string) =>
	({
		id,
		type: "assistant",
		agent: "code",
		model: { providerID: "kilo", id: "m" },
		time: { created: 1, completed: 2 },
		content,
		...(files ? { snapshot: { files, ...(end ? { end } : {}) } } : {}),
	}) as SessionMessageInfo;

describe("toolImageAttachments", () => {
	it("returns the image files in the call's content only", () => {
		const messages = [
			step("msg_1", [
				tool("call_a", "screenshot", {
					content: [
						{ type: "text", text: "Took it" },
						{ type: "file", mime: "image/png", uri: "data:image/png;base64,AAAA", name: "a.png" },
						{ type: "file", mime: "text/plain", uri: "data:text/plain,hi" },
						{ type: "file", mime: "image/jpeg", uri: "" },
					],
				}),
				tool("call_b", "read", {
					content: [{ type: "file", mime: "image/gif", uri: "data:image/gif;base64,R0" }],
				}),
				tool("call_d", "x", {}),
			]),
		];

		expect(toolImageAttachments(messages, "call_a")).toEqual([
			{ url: "data:image/png;base64,AAAA", filename: "a.png" },
		]);
		expect(toolImageAttachments(messages, "call_b")).toEqual([{ url: "data:image/gif;base64,R0" }]);
		expect(toolImageAttachments(messages, "call_c")).toEqual([]);
		expect(toolImageAttachments([], "call_a")).toEqual([]);
		expect(toolImageAttachments(messages, "call_d")).toEqual([]);
	});
});

describe("savedImages", () => {
	it("lists images from step snapshots and file tools once, at their latest revision", () => {
		const messages = [
			step("msg_1", [], ["plot.png", "src/app.ts"], "snap_1"),
			step("msg_2", [
				tool("call_1", "write", { input: { path: "logo.svg" } }),
				tool("call_2", "write", { status: "running", input: { path: "draft.png" }, metadata: {} }),
				tool("call_3", "shell", { input: { command: "python plot.py -o plot.png" } }),
			]),
			step("msg_3", [], ["plot.png"], "snap_2"),
		];

		expect(savedImages(messages)).toEqual({
			images: [
				{ path: "plot.png", revision: "snap_2" },
				{ path: "logo.svg", revision: "call_1" },
			],
			more: 0,
		});
		expect(savedImages([])).toEqual({ images: [], more: 0 });
	});

	it("skips snapshot images no tool call names, like files a checkout changed", () => {
		const messages = [
			step(
				"msg_1",
				[tool("call_1", "shell", { input: { command: "git checkout feature" } })],
				["e2e/fixtures/sample-receipt.png"],
			),
		];

		expect(savedImages(messages)).toEqual({ images: [], more: 0 });
	});

	it("caps how many it lists", () => {
		const files = Array.from(
			{ length: SAVED_IMAGES_LIMIT + 3 },
			(_, index) => `${String(index)}.png`,
		);

		const { images, more } = savedImages([
			step(
				"msg_1",
				[tool("call_1", "shell", { input: { command: `touch ${files.join(" ")}` } })],
				files,
			),
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
		const bytes = Uint8Array.from([1, 2, 3]);
		expect(imageDataUrl(bytes, "a.png")).toBe("data:image/png;base64,AQID");
		expect(imageDataUrl(bytes, "b.webp")).toBe("data:image/webp;base64,AQID");
		expect(imageDataUrl(new TextEncoder().encode("<svg>é</svg>"), "c.svg")).toBe(
			`data:image/svg+xml;base64,${btoa("<svg>\u00c3\u00a9</svg>")}`,
		);
		expect(imageDataUrl(new Uint8Array(), "e.png")).toBeNull();
		expect(imageDataUrl(bytes, "f.bin")).toBeNull();
		expect(imageDataUrl(undefined, "g.png")).toBeNull();
	});
});
