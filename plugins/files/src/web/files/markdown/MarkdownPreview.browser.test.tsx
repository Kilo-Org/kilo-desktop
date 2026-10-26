import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { FilesServiceContract } from "../../../contracts/schemas.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

const read: FilesServiceContract["read"] = async () => ({
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
		await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
		const svg = document.querySelector('[data-qa-id="mermaid-diagram"] svg');
		expect(svg).not.toBeNull();

		rerender(preview());
		rerender(preview());

		expect(document.querySelector('[data-qa-id="mermaid-diagram"] svg')).toBe(svg);
		expect(document.querySelector('[data-qa-id="mermaid-diagram"]')?.textContent).not.toContain(
			"Rendering diagram",
		);
	});
});
