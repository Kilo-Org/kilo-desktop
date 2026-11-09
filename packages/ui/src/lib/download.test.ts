import { describe, expect, it } from "vitest";

import {
	dataUrlMime,
	dataUrlToBlob,
	extensionForMime,
	slugForFilename,
	timestampForFilename,
} from "./download";

describe("dataUrlToBlob", () => {
	it("decodes a base64 data URL with its MIME type", async () => {
		const blob = dataUrlToBlob(`data:image/png;base64,${btoa("\x89PNG")}`);
		expect(blob.type).toBe("image/png");
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		);
	});

	it("decodes a percent-encoded data URL", async () => {
		const blob = dataUrlToBlob("data:image/svg+xml,%3Csvg%2F%3E");
		expect(blob.type).toBe("image/svg+xml");
		expect(await blob.text()).toBe("<svg/>");
	});

	it("defaults the MIME type and rejects other URLs", async () => {
		expect(await dataUrlToBlob("data:,hi").text()).toBe("hi");
		expect(dataUrlToBlob("data:,hi").type).toBe("text/plain");
		expect(() => dataUrlToBlob("https://example.com/a.png")).toThrow("Not a data URL.");
	});
});

describe("dataUrlMime", () => {
	it("reads the MIME type of data URLs only", () => {
		expect(dataUrlMime("data:image/webp;base64,AAAA")).toBe("image/webp");
		expect(dataUrlMime("data:,x")).toBe("text/plain");
		expect(dataUrlMime("blob:kilo/123")).toBeNull();
	});
});

describe("filenames", () => {
	it("maps image MIME types to extensions", () => {
		expect(extensionForMime("image/jpeg")).toBe("jpg");
		expect(extensionForMime("IMAGE/SVG+XML")).toBe("svg");
		expect(extensionForMime("application/octet-stream")).toBe("png");
	});

	it("formats a sortable local timestamp", () => {
		expect(timestampForFilename(new Date(2026, 10, 6, 9, 5, 7))).toBe("20261106-090507");
	});

	it("slugs labels for filenames", () => {
		expect(slugForFilename("Sequence diagram")).toBe("sequence-diagram");
		expect(slugForFilename("  ***  ")).toBe("download");
		expect(slugForFilename("ÄÖ", "image")).toBe("image");
	});
});
