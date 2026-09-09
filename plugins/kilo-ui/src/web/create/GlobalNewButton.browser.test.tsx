import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../workspaces/WorkspacesFeatureContext.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "../chat/right-panel/right-panel-store.js";
import { GlobalNewButton } from "./GlobalNewButton.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

class EmptyThreadListAdapter implements RemoteThreadListAdapter {
	list() {
		return Promise.resolve({ threads: [] });
	}
	archive() {
		return Promise.resolve();
	}
	unarchive() {
		return Promise.resolve();
	}
	rename() {
		return Promise.resolve();
	}
	delete() {
		return Promise.resolve();
	}
	initialize(threadId: string) {
		return Promise.resolve({ remoteId: threadId, externalId: undefined });
	}
	generateTitle() {
		return Promise.resolve(
			new ReadableStream({
				start(controller) {
					controller.close();
				},
			}),
		);
	}
	fetch() {
		return Promise.reject(new Error("No threads."));
	}
}

const workspacesValue: WorkspacesContextValue = {
	workspaces: [],
	activeWorkspaceId: null,
	setActiveWorkspaceId: () => undefined,
	isLoading: false,
	isUnavailable: false,
	openCreate: () => undefined,
	openEdit: () => undefined,
	openDelete: () => undefined,
};

function Harness({
	system,
	workspaces,
}: {
	system: ReturnType<typeof createFakeFeatureSystem>;
	workspaces: WorkspacesContextValue;
}) {
	const runtime = useRemoteThreadListRuntime({
		adapter: new EmptyThreadListAdapter(),
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});

	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<WorkspacesContext.Provider value={workspaces}>
					<div style={{ width: 255 }}>
						<GlobalNewButton />
					</div>
				</WorkspacesContext.Provider>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

function renderGlobalNew() {
	const navigate = vi.fn();
	const openCreate = vi.fn();
	const sdk = createFakeSdk({ featureId: "kilo-ui", navigation: { navigate } });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const workspaces = { ...workspacesValue, openCreate };
	const result = render(<Harness system={system} workspaces={workspaces} />);
	return { ...result, navigate, openCreate, screen: page.elementLocator(result.baseElement) };
}

afterEach(() => {
	cleanup();
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("GlobalNewButton", () => {
	it("renders a New button with a Chat and Workspace menu", async () => {
		const { screen } = renderGlobalNew();

		const button = screen.getByRole("button", { name: "New" }).element();
		await expect.element(button).toBeVisible();
		expect(button.textContent).toBe("New");
		expect(button.querySelector('[data-slot="aui_thread-list-new-icon"]')).not.toBeNull();
		expect(button.className).toContain("border-border");
		expect(button.className).toContain("bg-background");
		await expect.element(screen.getByRole("button", { name: "More new options" })).toBeVisible();
		expect(screen.getByRole("button").elements()).toHaveLength(2);
	});

	it("creates a chat when New is pressed", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "New" }).click();

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(openCreate).not.toHaveBeenCalled();
		await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
	});

	it("returns to a fresh empty chat by clearing leftover draft panes", async () => {
		useRightPanelStore.getState().openTab(DRAFT_RIGHT_PANEL_SESSION_KEY, {
			id: "files.files",
			title: "Files",
		});
		const { screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "New" }).click();

		expect(
			useRightPanelStore.getState().bySessionId[DRAFT_RIGHT_PANEL_SESSION_KEY],
		).toBeUndefined();
	});

	it("opens a New menu with Chat first and Workspace next", async () => {
		const { screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "More new options" }).click();

		const chat = screen.getByRole("menuitem", { name: "Chat" });
		const workspace = screen.getByRole("menuitem", { name: "Workspace" });
		await expect.element(chat).toBeVisible();
		await expect.element(workspace).toBeVisible();
		expect(screen.getByRole("menu").element().textContent).not.toContain("New");
		expect(
			chat.element().compareDocumentPosition(workspace.element()) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("creates a chat from the New menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "More new options" }).click();
		await screen.getByRole("menuitem", { name: "Chat" }).click();

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(openCreate).not.toHaveBeenCalled();
	});

	it("opens the create-workspace dialog from the New menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "More new options" }).click();
		await screen.getByRole("menuitem", { name: "Workspace" }).click();

		expect(openCreate).toHaveBeenCalledTimes(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it("opens the New menu to the right, sized to its items", async () => {
		const { screen } = renderGlobalNew();
		const group = screen.getByRole("group", { name: "New" }).element();

		await screen.getByRole("button", { name: "More new options" }).click();

		const menu = screen.getByRole("menu");
		await expect.element(menu).toBeVisible();
		await expect.element(menu).toHaveAttribute("data-side", "right");
		await vi.waitFor(() => {
			const groupWidth = group.getBoundingClientRect().width;
			const menuWidth = menu.element().getBoundingClientRect().width;
			expect(menuWidth).toBeGreaterThan(80);
			expect(menuWidth).toBeLessThan(groupWidth);
		});
	});
});
