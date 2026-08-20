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
	it("renders New as a filled button", async () => {
		const { screen } = renderGlobalNew();

		const trigger = screen.getByRole("button", { name: "New" }).element();
		expect(trigger.className).toContain("bg-primary");
		expect(trigger.className).toContain("justify-start");
		expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
		const label = trigger.querySelector('[data-slot="aui_thread-list-new-label"]');
		const chevron = trigger.querySelector('[data-slot="aui_thread-list-new-chevron"]');
		expect(label).not.toBeNull();
		expect(chevron).not.toBeNull();
		expect(chevron!.getBoundingClientRect().left).toBeGreaterThan(
			label!.getBoundingClientRect().right,
		);
		expect(
			trigger.getBoundingClientRect().right - chevron!.getBoundingClientRect().right,
		).toBeLessThan(16);
	});

	it("opens a New menu with Chat first and Workspace next", async () => {
		const { screen } = renderGlobalNew();

		const trigger = screen.getByRole("button", { name: "New" });
		await expect.element(trigger).toBeVisible();
		await trigger.click();

		const chat = screen.getByRole("menuitem", { name: "Chat" });
		const workspace = screen.getByRole("menuitem", { name: "Workspace" });
		await expect.element(chat).toBeVisible();
		await expect.element(workspace).toBeVisible();
		expect(
			chat.element().compareDocumentPosition(workspace.element()) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("creates a chat by default from the New menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "New" }).click();
		await screen.getByRole("menuitem", { name: "Chat" }).click();

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(openCreate).not.toHaveBeenCalled();
	});

	it("opens the create-workspace dialog from the New menu", async () => {
		const { navigate, openCreate, screen } = renderGlobalNew();

		await screen.getByRole("button", { name: "New" }).click();
		await screen.getByRole("menuitem", { name: "Workspace" }).click();

		expect(openCreate).toHaveBeenCalledTimes(1);
		expect(navigate).not.toHaveBeenCalled();
	});
});
