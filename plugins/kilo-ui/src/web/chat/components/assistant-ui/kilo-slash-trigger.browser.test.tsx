import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Command } from "@kilocode/sdk/v2/client";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { createKiloDirectoryClient } from "../../runtime/create-kilo-runtime-client.js";
import { Thread } from "./thread.js";

const commandList = vi.hoisted(() => vi.fn());

vi.mock("../../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		command: { list: commandList },
	})),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

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

const kiloModelSelection = {
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

const commands: Command[] = [
	{
		name: "init",
		description: "Create an AGENTS.md",
		source: "command",
		template: "/init $ARGUMENTS",
		hints: [],
	},
	{
		name: "compact",
		description: "Compact the conversation",
		source: "command",
		template: "/compact",
		hints: [],
	},
];

function renderSlashThread(connectionStatus?: {
	isPending: boolean;
	isError: boolean;
	error: Error | null;
	connection: KiloGlobalConnection | undefined;
	connectionPromise: Promise<KiloGlobalConnection>;
}) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	function Tree() {
		const runtime = useLocalRuntime(stubChatModel, { initialMessages: [] });
		return (
			<KiloAuthContext.Provider value={signedInAuth}>
				<AssistantRuntimeProvider runtime={runtime}>
					<ChatConnectionProvider
						status={
							connectionStatus ?? {
								isPending: false,
								isError: false,
								error: null,
								connection,
								connectionPromise: Promise.resolve(connection),
							}
						}
					>
						<ChatAgentSelectionProvider value={agentSelection}>
							<ChatModelSelectionProvider value={kiloModelSelection}>
								<div className="h-[480px]">
									<Thread />
								</div>
							</ChatModelSelectionProvider>
						</ChatAgentSelectionProvider>
					</ChatConnectionProvider>
				</AssistantRuntimeProvider>
			</KiloAuthContext.Provider>
		);
	}

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<Tree />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

describe("KiloSlashTrigger", () => {
	it("does not fetch commands until Kilo is connected", async () => {
		renderSlashThread({
			isPending: true,
			isError: false,
			error: null,
			connection: undefined,
			connectionPromise: Promise.resolve(connection),
		});

		await expect.element(page.getByRole("textbox", { name: "Message input" })).toBeVisible();
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
		expect(commandList).not.toHaveBeenCalled();
	});

	it("opens Kilo commands on /, filters, and inserts /init on select", async () => {
		commandList.mockResolvedValue({ data: commands });
		const screen = renderSlashThread();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await vi.waitFor(() => expect(commandList).toHaveBeenCalled());
		await input.click();
		await userEvent.keyboard("/");

		await expect.element(screen.getByText("init")).toBeVisible();
		await expect.element(screen.getByText("compact")).toBeVisible();
		await expect.element(screen.getByText("Create an AGENTS.md")).toBeVisible();

		await userEvent.keyboard("ini");
		await expect.element(screen.getByText("init")).toBeVisible();
		await expect.element(screen.getByText("compact")).not.toBeInTheDocument();

		await screen.getByText("init").click();
		await expect.element(screen.getByLabelText("command: init")).toBeVisible();
		await expect
			.element(screen.getByRole("listbox", { name: "Suggestions" }))
			.not.toBeInTheDocument();

		await input.click();
		await userEvent.keyboard("write AGENTS.md");
		await expect.element(screen.getByText("write AGENTS.md")).toBeVisible();
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.element(screen.getByLabelText("command: init")).toBeVisible();
		await expect.element(screen.getByText("write AGENTS.md")).toBeVisible();
	});

	it("scrolls the highlighted suggestion into view during keyboard navigation", async () => {
		commandList.mockResolvedValue({ data: commands });
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => undefined);
		const screen = renderSlashThread();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await vi.waitFor(() => expect(commandList).toHaveBeenCalled());
		await input.click();
		await userEvent.keyboard("/");
		await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
		scrollIntoView.mockClear();
		await userEvent.keyboard("{ArrowDown}");

		await vi.waitFor(() =>
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" }),
		);
	});

	it("wraps ArrowUp from the first suggestion to the last", async () => {
		commandList.mockResolvedValue({ data: commands });
		const screen = renderSlashThread();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await vi.waitFor(() => expect(commandList).toHaveBeenCalled());
		await input.click();
		await userEvent.keyboard("/");
		await userEvent.keyboard("{ArrowUp}");

		await expect
			.element(screen.getByRole("option", { name: /compact/u }))
			.toHaveAttribute("aria-selected", "true");
	});

	it("groups mixed sources into categories and still filters across them", async () => {
		commandList.mockResolvedValue({
			data: [
				...commands,
				{
					name: "frontend-design",
					description: "Create distinctive UI",
					source: "skill",
					template: "/frontend-design $ARGUMENTS",
					hints: [],
				},
			],
		});
		const screen = renderSlashThread();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await vi.waitFor(() => expect(commandList).toHaveBeenCalled());
		await input.click();
		await userEvent.keyboard("/");

		await expect.element(screen.getByText("Commands")).toBeVisible();
		await expect.element(screen.getByText("Skills")).toBeVisible();
		await expect.element(screen.getByText("init")).not.toBeInTheDocument();

		await screen.getByText("Commands").click();
		await expect.element(screen.getByText("init")).toBeVisible();
		await expect.element(screen.getByText("compact")).toBeVisible();
		await expect.element(screen.getByText("Back")).toBeVisible();
		await expect.element(screen.getByText("frontend-design")).not.toBeInTheDocument();

		await screen.getByText("Back").click();
		await expect.element(screen.getByText("Skills")).toBeVisible();

		await input.click();
		await userEvent.keyboard("front");
		await expect.element(screen.getByText("frontend-design")).toBeVisible();
		await expect.element(screen.getByText("Commands")).not.toBeInTheDocument();

		await screen.getByText("frontend-design").click();
		await expect.element(screen.getByLabelText("skill: frontend-design")).toBeVisible();
	});

	it("does not open the command menu after a mid-sentence slash", async () => {
		commandList.mockResolvedValue({ data: commands });
		const screen = renderSlashThread();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await vi.waitFor(() => expect(commandList).toHaveBeenCalled());
		await input.click();
		await userEvent.keyboard("what is /");

		await expect.element(screen.getByText("init")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Commands")).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole("listbox", { name: "Suggestions" }))
			.not.toBeInTheDocument();
	});
});
