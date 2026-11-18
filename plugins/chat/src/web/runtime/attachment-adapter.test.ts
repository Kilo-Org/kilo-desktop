import { describe, expect, it } from "vitest";

import { KiloAttachmentAdapter } from "./attachment-adapter";

describe("KiloAttachmentAdapter", () => {
	it("reads a file when it is added, so a send has nothing left to prepare", async () => {
		const adapter = new KiloAttachmentAdapter();

		const attachment = await adapter.add({
			file: new File(["# Notes"], "notes.md", { type: "text/markdown" }),
		});

		expect(attachment).toMatchObject({
			name: "notes.md",
			status: { type: "complete" },
			content: [
				{
					type: "file",
					mimeType: "text/plain",
					data: `data:text/markdown;base64,${btoa("# Notes")}`,
				},
			],
		});
	});

	it("still refuses a file OpenCode can't read", async () => {
		const adapter = new KiloAttachmentAdapter();

		await expect(
			adapter.add({
				file: new File([new Uint8Array([0, 0, 0, 1])], "blob.bin", {
					type: "application/octet-stream",
				}),
			}),
		).rejects.toThrow("is not an image, a PDF, or readable text");
	});
});
