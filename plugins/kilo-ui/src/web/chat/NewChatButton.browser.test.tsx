import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "./right-panel/right-panel-store.js";
import { NewChatButton } from "./NewChatButton.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

class EmptyThreadListAdapter implements RemoteThreadListAdapter {
	constructor(private readonly pending = false) {}

	list(): ReturnType<RemoteThreadListAdapter["list"]> {
		if (this.pending) return new Promise(() => undefined);
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

function Harness({
	system,
	threadsPending = false,
}: {
	system: ReturnType<typeof createFakeFeatureSystem>;
	threadsPending?: boolean;
}) {
	const runtime = useRemoteThreadListRuntime({
		adapter: new EmptyThreadListAdapter(threadsPending),
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});

	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<div style={{ width: 255 }}>
					<NewChatButton />
				</div>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

function renderNewChatButton({ threadsPending = false }: { threadsPending?: boolean } = {}) {
	const navigate = vi.fn();
	const sdk = createFakeSdk({ featureId: "kilo-ui", navigation: { navigate } });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const result = render(<Harness system={system} threadsPending={threadsPending} />);
	return { ...result, navigate, screen: page.elementLocator(result.baseElement) };
}

afterEach(() => {
	cleanup();
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("NewChatButton", () => {
	it("renders New Chat", async () => {
		const { screen } = renderNewChatButton();

		const button = screen.getByRole("button", { name: "New Chat" }).element();
		await expect.element(button).toBeVisible();
		expect(button.textContent).toBe("New Chat");
		expect(button.querySelector('[data-slot="aui_thread-list-new-icon"]')).not.toBeNull();
		expect(button.className).not.toContain("border-border");
		expect(button.className).not.toContain("bg-background");
		expect(screen.getByRole("button").elements()).toHaveLength(1);
	});

	it("creates a chat from the button", async () => {
		const { navigate, screen } = renderNewChatButton();
		const button = screen.getByRole("button", { name: "New Chat" });

		await expect.element(button).toBeEnabled();
		fireEvent.click(button.element());

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("waits for the remote thread list before creating a fresh draft", async () => {
		const { navigate, screen } = renderNewChatButton({ threadsPending: true });
		const button = screen.getByRole("button", { name: "New Chat" });

		await expect.element(button).toBeDisabled();
		fireEvent.click(button.element());

		expect(navigate).not.toHaveBeenCalled();
	});

	it("returns to a fresh empty chat by clearing leftover draft panes", async () => {
		useRightPanelStore.getState().openTab(DRAFT_RIGHT_PANEL_SESSION_KEY, {
			id: "files.files",
			title: "Files",
		});
		const { screen } = renderNewChatButton();

		await screen.getByRole("button", { name: "New Chat" }).click();

		expect(
			useRightPanelStore.getState().bySessionId[DRAFT_RIGHT_PANEL_SESSION_KEY],
		).toBeUndefined();
	});
});
