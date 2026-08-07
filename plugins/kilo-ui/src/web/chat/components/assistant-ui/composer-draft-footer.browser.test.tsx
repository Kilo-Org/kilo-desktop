import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

import type { KiloWorkspaceConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { ChatConnectionProvider } from "../../ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { Thread } from "./thread.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

const connection: KiloWorkspaceConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	directory: "/tmp/chats/test",
};

const emptyModelSelection = {
	model: undefined,
	setModel: () => undefined,
	effort: undefined,
	setEffort: () => undefined,
	catalog: {
		providers: [],
		models: [],
		defaults: {},
	},
	isCatalogPending: false,
	isCatalogError: false,
};

function ThreadHarness({ initialMessages }: { initialMessages?: readonly ThreadMessageLike[] }) {
	const runtime = useLocalRuntime(stubChatModel, {
		...(initialMessages === undefined ? {} : { initialMessages }),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatConnectionProvider
				status={{
					isPending: false,
					isError: false,
					error: null,
					connectionPromise: Promise.resolve(connection),
				}}
			>
				<ChatModelSelectionProvider value={emptyModelSelection}>
					<div className="h-[480px]">
						<Thread />
					</div>
				</ChatModelSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

function renderThread(
	options: {
		initialMessages?: readonly ThreadMessageLike[];
		shell?: Partial<SDK["shell"]>;
	} = {},
) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		...(options.shell === undefined ? {} : { shell: options.shell }),
	});
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ThreadHarness
						{...(options.initialMessages === undefined
							? {}
							: { initialMessages: options.initialMessages })}
					/>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("ComposerDraftFooter", () => {
	it("shows the draft footer with the workspace selector on an empty chat", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).toBeVisible();
		await expect.element(screen.getByRole("combobox", { name: "Select workspace" })).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
	});

	it("hides the draft footer when the thread has messages", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole("combobox", { name: "Select workspace" }))
			.not.toBeInTheDocument();
	});
});
