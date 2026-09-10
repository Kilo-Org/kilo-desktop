import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "../../../../contracts/workspaces/schemas.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { DraftWelcomeHeadline } from "./draft-welcome-headline.js";

const workspace: Workspace = {
	id: "workspace-1",
	name: "Alpha",
	folders: [
		{
			id: "folder-1",
			path: "/tmp/Alpha",
			isPrimary: true,
			position: 0,
		},
	],
	createdAt: 1,
	updatedAt: 1,
};

const otherWorkspace: Workspace = {
	id: "workspace-2",
	name: "Beta",
	folders: [
		{
			id: "folder-2",
			path: "/tmp/Beta",
			isPrimary: true,
			position: 0,
		},
	],
	createdAt: 2,
	updatedAt: 2,
};

function renderHeadline(
	options: {
		workspaces?: Workspace[];
		activeWorkspaceId?: string | null;
	} = {},
) {
	const workspaces = options.workspaces ?? [];
	if (options.activeWorkspaceId) {
		localStorage.setItem("kilo-ui.active-workspace", options.activeWorkspaceId);
	}

	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspacesContract,
		handlers: {
			list: async () => workspaces,
			get: async ({ id }) => workspaces.find((candidate) => candidate.id === id) ?? null,
			create: async () => workspace,
			update: async () => workspace,
			remove: async () => ({ deleted: true }),
		} satisfies Partial<WorkspacesService>,
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<DraftWelcomeHeadline />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("DraftWelcomeHeadline", () => {
	it("shows plain copy without a title picker when no workspace is active", async () => {
		const { baseElement } = renderHeadline({ workspaces: [workspace] });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByRole("heading", { name: "What should we work on?" }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("combobox", { name: "Change workspace" }))
			.not.toBeInTheDocument();
	});

	it("shows a clickable workspace name that opens the shared picker", async () => {
		const { baseElement } = renderHeadline({
			workspaces: [workspace, otherWorkspace],
			activeWorkspaceId: workspace.id,
		});
		const screen = page.elementLocator(baseElement);
		const heading = screen.getByRole("heading", { level: 1 });

		await expect.element(heading).toHaveTextContent("What should we work on in Alpha?");

		const trigger = screen.getByRole("combobox", { name: "Change workspace" });
		await expect.element(trigger).not.toHaveAttribute("title");
		expect(trigger.element().className).toMatch(/max-w-40/);
		expect(trigger.element().querySelector(".truncate")).not.toBeNull();

		await trigger.click();
		expect(
			document.querySelector('[data-slot="popover-content"]')?.parentElement?.dataset.side,
		).toBe("bottom");
		await expect.element(page.getByRole("option", { name: /Beta/ })).toBeVisible();

		await page.getByRole("option", { name: /Beta/ }).click();
		await expect.element(heading).toHaveTextContent("What should we work on in Beta?");

		await screen.getByRole("combobox", { name: "Change workspace" }).click();
		await page.getByTestId("workspace-unscoped-command").click();
		await expect
			.element(screen.getByRole("heading", { name: "What should we work on?" }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("combobox", { name: "Change workspace" }))
			.not.toBeInTheDocument();
	});

	it("keeps a long workspace name on one line with an ellipsis", async () => {
		const longName = "anaconda-agentic-desktop-with-a-very-long-workspace-name";
		const longWorkspace: Workspace = {
			...workspace,
			id: "workspace-long",
			name: longName,
		};
		const { baseElement } = renderHeadline({
			workspaces: [longWorkspace],
			activeWorkspaceId: longWorkspace.id,
		});
		const screen = page.elementLocator(baseElement);
		const trigger = screen.getByRole("combobox", { name: "Change workspace" });

		await expect.element(trigger).not.toHaveAttribute("title");
		await expect
			.element(screen.getByRole("heading", { level: 1 }))
			.toHaveTextContent(`What should we work on in ${longName}?`);

		const headingEl = screen.getByRole("heading", { level: 1 }).element();
		const triggerEl = trigger.element();
		const label = triggerEl.querySelector(".truncate");
		expect(headingEl.getBoundingClientRect().height).toBeLessThan(48);
		expect(label).not.toBeNull();
		expect(label!.scrollWidth).toBeGreaterThan(label!.clientWidth);
	});
});
