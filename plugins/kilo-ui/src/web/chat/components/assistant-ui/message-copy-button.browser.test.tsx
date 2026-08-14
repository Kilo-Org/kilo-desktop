import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { Thread } from "./thread.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

const modelSelection = {
	model: { providerID: "kilo", modelID: "test-model" },
	setModel: () => undefined,
	effort: undefined,
	setEffort: () => undefined,
	name: "Test Model",
	efforts: undefined,
	catalog: {
		providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
		models: [
			{
				id: "kilo/test-model",
				name: "Test Model",
				providerID: "kilo",
				modelID: "test-model",
			},
		],
		defaults: { kilo: "test-model" },
	},
	isCatalogPending: false,
	isCatalogError: false,
};

const agentSelection = {
	agent: "code",
	setAgent: () => undefined,
	catalog: {
		agents: OPTIMISTIC_AGENT_CATALOG.agents.filter(
			(entry) => entry.name === "code" || entry.name === "plan",
		),
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
				<ChatAgentSelectionProvider value={agentSelection}>
					<ChatModelSelectionProvider value={modelSelection}>
						<div className="h-[480px]">
							<Thread />
						</div>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
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
	const copyText = vi.fn(async () => undefined);
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		shell: {
			copyText,
			...options.shell,
		},
	});
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	render(
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

	return { copyText };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("MessageCopyButton", () => {
	it("copies assistant message text through sdk.shell.copyText", async () => {
		const { copyText } = renderThread({
			initialMessages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Copy me via shell" }],
				},
			],
		});
		const screen = page.elementLocator(document.body);

		const copyButton = screen.getByRole("button", { name: "Copy" });
		await expect.element(copyButton).toBeVisible();
		await copyButton.click();

		await expect.poll(() => copyText.mock.calls).toEqual([["Copy me via shell"]]);
	});
});

describe("AssistantActionMoreTrigger", () => {
	it("keeps the More tooltip visible while hovering the overflow button", async () => {
		renderThread({
			initialMessages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Hover the more action" }],
				},
			],
		});
		const screen = page.elementLocator(document.body);

		const moreButton = screen.getByRole("button", { name: "More" });
		await expect.element(moreButton).toBeVisible();
		await moreButton.hover();

		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("More");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe("More");
	});
});
