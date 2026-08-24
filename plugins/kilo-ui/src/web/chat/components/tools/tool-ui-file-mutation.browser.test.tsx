import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PierreDiffBody } from "./tool-ui-file-mutation.js";

const MULTI_FILE_DIFF = `diff --git a/first.txt b/first.txt
--- a/first.txt
+++ b/first.txt
@@ -1 +1 @@
-before
+after
diff --git a/second.txt b/second.txt
--- a/second.txt
+++ b/second.txt
@@ -1 +1 @@
-old
+new
`;

afterEach(() => {
	cleanup();
});

describe("PierreDiffBody", () => {
	it("renders every file in a multi-file unified diff", () => {
		const { container } = render(<PierreDiffBody unifiedDiff={MULTI_FILE_DIFF} fileDiff={null} />);

		expect(container.querySelectorAll("diffs-container")).toHaveLength(2);
	});
});
