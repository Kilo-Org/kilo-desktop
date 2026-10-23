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
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";
import { useRightPanelStore } from "./right-panel/right-panel-store.js";
import { NewSessionButton } from "./NewSessionButton.js";

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
				<SidebarProvider>
					<div style={{ width: 255 }}>
						<NewSessionButton />
					</div>
				</SidebarProvider>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

function renderNewSessionButton({ threadsPending = false }: { threadsPending?: boolean } = {}) {
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

describe("NewSessionButton", () => {
	it("renders New session", async () => {
		const { screen } = renderNewSessionButton();

		const button = screen.getByRole("button", { name: "New session" }).element();
		await expect.element(button).toBeVisible();
		expect(button.textContent).toBe("New session");
		expect(button.querySelector('[data-slot="aui_thread-list-new-icon"]')).not.toBeNull();
		expect(button.className).toContain("hover:bg-sidebar-accent");
		expect(screen.getByRole("button").elements()).toHaveLength(1);
	});

	it("creates a chat from the button", async () => {
		const { navigate, screen } = renderNewSessionButton();
		const button = screen.getByRole("button", { name: "New session" });

		await expect.element(button).toBeEnabled();
		fireEvent.click(button.element());

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("waits for the remote thread list before creating a fresh draft", async () => {
		const { navigate, screen } = renderNewSessionButton({ threadsPending: true });
		const button = screen.getByRole("button", { name: "New session" });

		await expect.element(button).toBeDisabled();
		fireEvent.click(button.element());

		expect(navigate).not.toHaveBeenCalled();
	});
});
