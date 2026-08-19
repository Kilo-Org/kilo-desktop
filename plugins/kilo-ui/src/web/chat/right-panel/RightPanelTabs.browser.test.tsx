import { cleanup, render } from "@testing-library/react";
import { FilesIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { RightPanelTabs } from "./RightPanelTabs.js";
import type { RightPanelTabDefinition } from "./right-panel-tab-registry.js";

const FILES_DEFINITION: RightPanelTabDefinition = {
	id: "files.files",
	title: "Files",
	description: "Browse workspace files.",
	Icon: FilesIcon,
	addable: true,
	Content: () => null,
};

afterEach(cleanup);

describe("RightPanelTabs", () => {
	it("uses the current file icon for a contributed tab", async () => {
		render(
			<RightPanelTabs
				activeTabId="files-1"
				definitions={[FILES_DEFINITION]}
				onActivate={vi.fn()}
				onAddTab={vi.fn()}
				onCloseTab={vi.fn()}
				tabs={[
					{
						instanceId: "files-1",
						definitionId: FILES_DEFINITION.id,
						title: "index.ts",
						iconPath: "src/index.ts",
						ordinal: 1,
					},
				]}
			>
				<div>File contents</div>
			</RightPanelTabs>,
		);

		await expect.element(page.getByTestId("chat-right-panel-tab-files-1")).toBeVisible();
		const icon = document.querySelector<SVGElement>(
			'[data-qa-id="chat-right-panel-tab-files-1"] [data-pierre-file-icon]',
		);
		expect(icon?.getAttribute("data-icon-token")).toBe("typescript");
		expect(icon?.querySelector("use")?.getAttribute("href")).toBe("#file-tree-builtin-typescript");
	});
});
