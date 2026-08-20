import { cleanup, render } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { MarkdownAnchor } from "@anaconda-agentic-desktop/ui/components/markdown-content";

import { FilesMarkdownExtension } from "./FilesMarkdownExtension.js";

afterEach(cleanup);

describe("FilesMarkdownExtension", () => {
	it("renders a compact file chip that opens the Files panel", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const context = {
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		};
		const extension = FilesMarkdownExtension(context);
		const decorateComponents = extension.decorateComponents;
		if (!decorateComponents) throw new Error("Expected a component decorator");
		const components = decorateComponents({ a: MarkdownAnchor }, context);
		const FileAnchor = components.a;
		if (typeof FileAnchor !== "function") throw new Error("Expected an anchor component");

		render(
			<SdkProvider system={system}>
				{createElement(FileAnchor, {
					href: "apps/desktop/AGENTS.md#L42C7",
					children: "apps/desktop/AGENTS.md",
					"data-file-parent-suffix": "apps/desktop",
				} as ComponentProps<"a">)}
			</SdkProvider>,
		);

		const chip = page.getByTestId("chat-markdown-file-link");
		await expect.element(chip).toHaveTextContent("AGENTS.md · apps/desktop · L42:C7");
		expect(chip.element().querySelector("[data-pierre-file-icon]")).not.toBeNull();
		expect(Number.parseFloat(getComputedStyle(chip.element()).fontSize)).toBe(14);

		await chip.click();
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "apps/desktop/AGENTS.md",
			line: 42,
			column: 7,
		});
	});
});
