import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../workspaces/WorkspacesFeatureContext.js";
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
					<GlobalNewButton />
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
});

describe("GlobalNewButton", () => {
	it("renders New Chat as the default action in a split button group", async () => {
		const { screen } = renderGlobalNew();

		const primary = screen.getByRole("button", { name: "New Chat" }).element();
		const more = screen.getByRole("button", { name: "Create new" }).element();
		expect(primary.className).toContain("bg-muted");
		expect(primary.className).toContain("group-hover/new:bg-foreground/5");
		expect(more.className).toContain("bg-muted");
		expect(more.className).toContain("group-hover/new:bg-foreground/5");
		expect(primary.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
		const label = primary.querySelector('[data-slot="aui_thread-list-new-label"]');
		expect(label).not.toBeNull();
		expect(more.getBoundingClientRect().left).toBeGreaterThan(label!.getBoundingClientRect().right);
		await expect.element(screen.getByRole("group", { name: "New" })).toBeVisible();
	});

	it("hovers both halves of the split button together", async () => {
		const { screen } = renderGlobalNew();

		const primary = screen.getByRole("button", { name: "New Chat" });
		const more = screen.getByRole("button", { name: "Create new" });
		await userEvent.hover(primary);

		expect(getComputedStyle(primary.element()).backgroundColor).toBe(
			getComputedStyle(more.element()).backgroundColor,
		);
	});

	it("creates a chat from the default New Chat action without opening the menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "New Chat" }).click();

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(openCreate).not.toHaveBeenCalled();
		await expect.element(screen.getByRole("menuitem", { name: "Chat" })).not.toBeInTheDocument();
	});

	it("opens a New menu with Chat first and Workspace next", async () => {
		const { screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "Create new" }).click();

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

		await screen.getByRole("button", { name: "Create new" }).click();
		await screen.getByRole("menuitem", { name: "Chat" }).click();

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(openCreate).not.toHaveBeenCalled();
	});

	it("opens the create-workspace dialog from the New menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "Create new" }).click();
		await screen.getByRole("menuitem", { name: "Workspace" }).click();

		expect(openCreate).toHaveBeenCalledTimes(1);
		expect(navigate).not.toHaveBeenCalled();
	});
});
