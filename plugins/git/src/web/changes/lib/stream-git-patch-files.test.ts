import { describe, expect, it } from "vitest";

import { streamGitPatchFiles } from "./stream-git-patch-files.js";

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

const FIRST_FILE = `diff --git a/first.txt b/first.txt
index 1111111..2222222 100644
--- a/first.txt
+++ b/first.txt
@@ -1 +1 @@
-old
+new
`;

const SECOND_FILE = `diff --git a/second.txt b/second.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/second.txt
@@ -0,0 +1 @@
+added
`;

async function collect(
	chunks: readonly string[],
): Promise<{ fileTexts: string[]; fallbackPatchContent: string | undefined }> {
	const fileTexts: string[] = [];
	const fallbackPatchContent = await streamGitPatchFiles(streamOf(chunks), (fileText) => {
		fileTexts.push(fileText);
	});
	return { fileTexts, fallbackPatchContent };
}

describe("streamGitPatchFiles", () => {
	it("splits complete files as they stream in and emits the trailing file at the end", async () => {
		const { fileTexts } = await collect([FIRST_FILE, SECOND_FILE]);
		expect(fileTexts).toHaveLength(2);
		expect(fileTexts[0]).toContain("diff --git a/first.txt b/first.txt");
		expect(fileTexts[0]).toContain("+new");
		expect(fileTexts[1]).toContain("diff --git a/second.txt b/second.txt");
		expect(fileTexts[1]).toContain("+added");
	});

	it("recognizes file boundaries split across chunk edges", async () => {
		const patch = `${FIRST_FILE}${SECOND_FILE}`;
		const splitAt = FIRST_FILE.length - 6;
		const { fileTexts } = await collect([
			patch.slice(0, splitAt),
			patch.slice(splitAt, splitAt + 2),
			patch.slice(splitAt + 2),
		]);
		expect(fileTexts).toHaveLength(2);
		expect(fileTexts[0]).toContain("diff --git a/first.txt b/first.txt");
		expect(fileTexts[1]).toContain("diff --git a/second.txt b/second.txt");
	});

	it("skips a whitespace-only body without emitting a file or fallback", async () => {
		const { fileTexts, fallbackPatchContent } = await collect(["\n\t  \n"]);
		expect(fileTexts).toEqual([]);
		expect(fallbackPatchContent).toBeUndefined();
	});

	it("returns undefined fallback for an empty body", async () => {
		const { fileTexts, fallbackPatchContent } = await collect([""]);
		expect(fileTexts).toEqual([]);
		expect(fallbackPatchContent).toBeUndefined();
	});

	it("returns the full body as fallback when no boundary is present", async () => {
		const { fileTexts, fallbackPatchContent } = await collect(["this is not a patch\n"]);
		expect(fileTexts).toEqual([]);
		expect(fallbackPatchContent).toBe("this is not a patch\n");
	});
});
