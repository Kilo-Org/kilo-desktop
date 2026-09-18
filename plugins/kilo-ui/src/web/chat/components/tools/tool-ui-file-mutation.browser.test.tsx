import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk, createFakeTheme } from "@kilo-desktop/testing";

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
	it("renders every file and updates syntax when the preset changes without a mode change", async () => {
		const theme = createFakeTheme();
		const sdk = createFakeSdk({ featureId: "kilo-ui", theme });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		const { container } = render(
			<SdkProvider system={system}>
				<PierreDiffBody unifiedDiff={MULTI_FILE_DIFF} fileDiff={null} />
			</SdkProvider>,
		);

		expect(container.querySelectorAll("diffs-container")).toHaveLength(2);
		const customCss = () =>
			container
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-unsafe-css]")?.textContent;
		await waitFor(() => {
			expect(customCss()).toContain("--diffs-font-size: 0.75rem");
			expect(customCss()).toContain("--diffs-line-height: 1.125rem");
		});
		const themeCss = () =>
			container
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-theme-css]")
				?.textContent?.toLowerCase();
		await waitFor(() => expect(themeCss()).toBeTruthy());
		await act(async () =>
			theme.setAppearance({
				...theme.appearance(),
				shiki: "catppuccin-latte",
			}),
		);
		await waitFor(() => expect(themeCss()).toContain("#4c4f69"));
	});
});
