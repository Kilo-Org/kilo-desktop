import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import type * as AssistantUiReact from "@assistant-ui/react";

import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { WorkspacesFeatureProvider } from "../workspaces/WorkspacesFeatureProvider.js";
import { SessionBreadcrumb } from "./SessionBreadcrumb.js";
import { SessionActivityProvider } from "./activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./activity/session-activity-store.js";

const threadListItem = vi.hoisted(() => ({
	status: "new" as "new" | "regular" | "archived",
	remoteId: undefined as string | undefined,
	title: undefined as string | undefined,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		useAuiState: (selector: (state: { threadListItem: typeof threadListItem }) => unknown) =>
			selector({ threadListItem }),
	};
});

const workspace: Workspace = {
	id: "workspace-1",
	name: "Alpha Workspace",
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

function renderBreadcrumb(
	session: { id: string; workspaceId?: string; directory?: string } = {
		id: "session-1",
		workspaceId: workspace.id,
		directory: "/tmp/Alpha",
	},
) {
	const store = createSessionActivityStore({ storage: null });
	store.getState().hydrateSessions([session]);

	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspacesContract,
		handlers: {
			list: async () => [workspace],
			get: async ({ id }) => (id === workspace.id ? workspace : null),
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
					<SessionActivityProvider store={store}>
						<SessionBreadcrumb />
					</SessionActivityProvider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	threadListItem.status = "new";
	threadListItem.remoteId = undefined;
	threadListItem.title = undefined;
});

describe("SessionBreadcrumb", () => {
	it("hides on a draft (new) session", async () => {
		const { baseElement } = renderBreadcrumb();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-session-breadcrumb")).not.toBeInTheDocument();
	});

	it("shows folder icon, workspace name, and session title for an active session", async () => {
		threadListItem.status = "regular";
		threadListItem.remoteId = "session-1";
		threadListItem.title = "Refactor breadcrumbs";

		const { baseElement } = renderBreadcrumb();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-session-breadcrumb")).toBeVisible();
		await expect.element(screen.getByText("Alpha Workspace")).toBeVisible();
		await expect.element(screen.getByText("Refactor breadcrumbs")).toBeVisible();
	});

	it("falls back to New session when the session has no title", async () => {
		threadListItem.status = "regular";
		threadListItem.remoteId = "session-1";

		const { baseElement } = renderBreadcrumb();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("New session")).toBeVisible();
	});

	it("shows only the session title for an unscoped session", async () => {
		threadListItem.status = "regular";
		threadListItem.remoteId = "session-unscoped";
		threadListItem.title = "Greeting";

		const { baseElement } = renderBreadcrumb({
			id: "session-unscoped",
			directory: "/chats/session-uSrBjH",
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-session-breadcrumb")).toBeVisible();
		await expect.element(screen.getByText("Greeting")).toBeVisible();
		await expect.element(screen.getByText("session-uSrBjH")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Alpha Workspace")).not.toBeInTheDocument();
	});
});
