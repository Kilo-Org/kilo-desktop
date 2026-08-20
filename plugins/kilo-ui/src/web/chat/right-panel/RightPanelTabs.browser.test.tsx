import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { RightPanelTabs } from "./RightPanelTabs.js";
import type {
	RightPanelTabDefinition,
	RightPanelTabIconProps,
} from "./right-panel-tab-registry.js";

function ContributedIcon({ className, iconKey }: RightPanelTabIconProps) {
	return <svg className={className} data-contributed-icon-key={iconKey} />;
}

const FILES_DEFINITION: RightPanelTabDefinition = {
	id: "files.files",
	title: "Files",
	description: "Browse workspace files.",
	Icon: ContributedIcon,
	addable: true,
	Content: () => null,
};

afterEach(cleanup);

describe("RightPanelTabs", () => {
	it("passes the opaque icon key to the contributed tab icon", async () => {
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
						iconKey: "src/index.ts",
						ordinal: 1,
					},
				]}
			>
				<div>File contents</div>
			</RightPanelTabs>,
		);

		await expect.element(page.getByTestId("chat-right-panel-tab-files-1")).toBeVisible();
		const icon = document.querySelector<SVGElement>(
			'[data-qa-id="chat-right-panel-tab-files-1"] [data-contributed-icon-key]',
		);
		expect(icon?.getAttribute("data-contributed-icon-key")).toBe("src/index.ts");
	});
});
