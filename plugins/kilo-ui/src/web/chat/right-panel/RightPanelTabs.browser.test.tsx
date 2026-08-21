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
	mountPolicy: "active-only",
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

	it("activates a tab from its icon while keeping close as a separate action", async () => {
		const tab = {
			instanceId: "files-1",
			definitionId: FILES_DEFINITION.id,
			title: "Files",
			iconKey: "src",
			ordinal: 1,
		};
		const onActivate = vi.fn();
		const onCloseTab = vi.fn();
		render(
			<RightPanelTabs
				activeTabId={null}
				definitions={[FILES_DEFINITION]}
				onActivate={onActivate}
				onAddTab={vi.fn()}
				onCloseTab={onCloseTab}
				tabs={[tab]}
			>
				<div>File contents</div>
			</RightPanelTabs>,
		);

		const icon = document.querySelector<SVGElement>(
			'[data-qa-id="chat-right-panel-tab-files-1"] [data-contributed-icon-key]',
		);
		expect(icon).not.toBeNull();
		expect(getComputedStyle(icon!.closest("button")!).columnGap).toBe("4px");
		icon!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onActivate).toHaveBeenCalledWith(tab);

		const closeButton = document.querySelector<HTMLElement>(
			'[data-qa-id="chat-right-panel-close-tab-files-1"]',
		)!;
		const closeHoverTarget = document.querySelector<HTMLElement>(
			'[data-qa-id="chat-right-panel-close-hover-files-1"]',
		)!;
		expect(closeButton.getBoundingClientRect().height).toBe(28);
		expect(closeHoverTarget.getBoundingClientRect().height).toBe(16);

		await page.getByTestId("chat-right-panel-close-tab-files-1").click();
		expect(onCloseTab).toHaveBeenCalledWith(tab);
		expect(onActivate).toHaveBeenCalledTimes(1);
	});
});
