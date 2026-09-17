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
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { Thread } from "./thread.js";

const signedInAuth: KiloAuthContextValue = {
	isLoading: false,
	connectionUnavailable: false,
	authenticated: true,
	profile: null,
	deviceAuth: { status: "idle" },
	isRefreshing: false,
	isSwitchingOrg: false,
	profileError: null,
	orgError: null,
	login: () => undefined,
	cancelLogin: () => undefined,
	logout: () => undefined,
	refreshProfile: () => undefined,
	setOrganization: () => undefined,
	dismissOrgError: () => undefined,
	openExternal: () => undefined,
};

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
					connection,
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
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness
							{...(options.initialMessages === undefined
								? {}
								: { initialMessages: options.initialMessages })}
						/>
					</KiloAuthContext.Provider>
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

describe("UserActionBar", () => {
	it("does not widen a short user message bubble to fit its actions", async () => {
		renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "hi" }],
				},
			],
		});

		await expect
			.poll(() => document.querySelector<HTMLElement>(".aui-user-message-content")?.offsetWidth)
			.toBeGreaterThan(0);

		const wrapper = document.querySelector<HTMLElement>(".aui-user-message-content-wrapper")!;
		const bubble = document.querySelector<HTMLElement>(".aui-user-message-content")!;
		expect(wrapper.offsetWidth).toBe(bubble.offsetWidth);
	});

	it("copies user message text through sdk.shell.copyText", async () => {
		const { copyText } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Copy my prompt" }],
				},
			],
		});
		// Messages render a tick after mount; the existing assistant tests rely on
		// locator auto-retry, but elementLocator needs a live element up front.
		await expect
			.poll(() => document.querySelector('[data-slot="aui_user-message-root"]') !== null)
			.toBe(true);
		const userRoot = page.elementLocator(
			document.querySelector('[data-slot="aui_user-message-root"]')!,
		);

		const copyButton = userRoot.getByRole("button", { name: "Copy" });
		await expect.element(copyButton).toBeVisible();
		await copyButton.click();

		await expect.poll(() => copyText.mock.calls).toEqual([["Copy my prompt"]]);
	});

	it("reveals the copy action when hovering a non-last user message", async () => {
		const { copyText } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "First prompt" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Reply" }],
				},
			],
		});
		await expect
			.poll(() => document.querySelector('[data-slot="aui_user-message-root"]') !== null)
			.toBe(true);

		// Park the cursor on the assistant message: a previous test can leave the
		// physical mouse over the user root, auto-hovering it at mount.
		await page
			.elementLocator(document.querySelector('[data-slot="aui_assistant-message-root"]')!)
			.hover();

		// Bar stays in DOM (no layout shift) but is opacity-0 + pointer-events-none
		// while the user message is not hovered.
		const userActionBar = document.querySelector(".aui-user-action-bar-root");
		expect(userActionBar?.classList.contains("opacity-0")).toBe(true);

		await page
			.elementLocator(
				document.querySelector('[data-slot="aui_user-message-root"] .aui-user-message-content')!,
			)
			.hover();

		// After hover the bar transitions to opacity-100.
		await expect
			.poll(() => {
				return document
					.querySelector(".aui-user-action-bar-root")
					?.classList.contains("opacity-100");
			})
			.toBe(true);

		// Re-derive after the opacity class settles so elementLocator text filter is stable.
		const revealedRoot = page.elementLocator(
			document.querySelector('[data-slot="aui_user-message-root"]')!,
		);
		const copyButton = revealedRoot.getByRole("button", { name: "Copy" });
		await expect.element(copyButton).toBeVisible();
		await copyButton.click();

		await expect.poll(() => copyText.mock.calls).toEqual([["First prompt"]]);
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
