import {
	AssistantRuntimeProvider,
	useAuiState,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	ChatComposerCapabilityHost,
	type ChatComposerCapability,
} from "./ChatComposerCapabilityHost.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "./right-panel/right-panel-store.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

class EmptyThreadListAdapter implements RemoteThreadListAdapter {
	list(): ReturnType<RemoteThreadListAdapter["list"]> {
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
		return Promise.resolve(new ReadableStream({ start: (controller) => controller.close() }));
	}
	fetch() {
		return Promise.reject(new Error("No threads."));
	}
}

function ComposerText() {
	const text = useAuiState((s) => s.composer.text);
	return <output data-qa-id="composer-text">{text}</output>;
}

function Harness({ system }: { system: ReturnType<typeof createFakeFeatureSystem> }) {
	const runtime = useRemoteThreadListRuntime({
		adapter: new EmptyThreadListAdapter(),
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});
	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<ChatComposerCapabilityHost />
				<ComposerText />
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

afterEach(() => {
	cleanup();
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("ChatComposerCapabilityHost", () => {
	it("lets another plugin open a new chat with an unsent draft", async () => {
		const navigate = vi.fn();
		const kiloUi = createFakeSdk({ featureId: "kilo-ui", navigation: { navigate } });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": kiloUi } });
		const marketplace = system.getSdk("kilo-marketplace");
		useRightPanelStore.getState().openTab(DRAFT_RIGHT_PANEL_SESSION_KEY, {
			id: "files.files",
			title: "Files",
		});
		render(<Harness system={system} />);

		await vi.waitFor(() =>
			expect(
				marketplace.plugins.get<ChatComposerCapability>("kilo-ui")?.chatComposer,
			).toBeDefined(),
		);
		await marketplace.plugins
			.get<ChatComposerCapability>("kilo-ui")!
			.chatComposer.startNewChat({ text: "Help me install Node.js." });

		await expect
			.element(page.getByTestId("composer-text"))
			.toHaveTextContent("Help me install Node.js.");
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(
			useRightPanelStore.getState().bySessionId[DRAFT_RIGHT_PANEL_SESSION_KEY],
		).toBeUndefined();
	});
});
