import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { ReadFile } from "../documents.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

const read: ReadFile = async () => ({
	kind: "text",
	contents: "",
	byteLength: 0,
	truncated: false,
	revision: "a".repeat(64),
});

afterEach(cleanup);

describe("MarkdownPreview", () => {
	it("keeps a rendered Mermaid diagram mounted across parent re-renders", async () => {
		const onOpenFile = vi.fn();
		const preview = () => (
			<MarkdownPreview
				contents={"# Diagram\n\n```mermaid\nflowchart LR\n  Start --> Done\n```"}
				onOpenFile={onOpenFile}
				read={read}
				relativePath="docs/readme.md"
				workspaceDirectory="/workspace/project"
			/>
		);
		const { rerender } = render(preview());
		await expect
			.poll(() => document.querySelector('[data-markdown="mermaid"] svg'), { timeout: 10_000 })
			.not.toBeNull();
		const svg = document.querySelector('[data-markdown="mermaid"] svg');

		rerender(preview());
		rerender(preview());

		expect(document.querySelector('[data-markdown="mermaid"] svg')).toBe(svg);
	});

	it("opens a relative link as a workspace file", async () => {
		const onOpenFile = vi.fn();
		render(
			<MarkdownPreview
				contents={"See [the guide](../guide/setup.md#install) or [the site](https://example.com)."}
				onOpenFile={onOpenFile}
				read={read}
				relativePath="docs/readme.md"
				workspaceDirectory="/workspace/project"
			/>,
		);

		await page.getByRole("link", { name: "the guide" }).click();

		expect(onOpenFile).toHaveBeenCalledWith("guide/setup.md");
	});

	it("loads a relative image from the workspace", async () => {
		const readImage = vi.fn<ReadFile>(async () => ({
			kind: "image",
			mimeType: "image/gif",
			base64: "R0lGODlhAQABAAAAACw=",
			byteLength: 14,
		}));
		render(
			<MarkdownPreview
				contents={"![Logo](./assets/logo.gif)"}
				onOpenFile={vi.fn()}
				read={readImage}
				relativePath="docs/readme.md"
				workspaceDirectory="/workspace/project"
			/>,
		);

		await expect
			.element(page.getByRole("img", { name: "Logo" }))
			.toHaveAttribute("src", expect.stringMatching(/^data:image\/gif;base64,/u));
		expect(readImage).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			relativePath: "docs/assets/logo.gif",
		});
	});
});
