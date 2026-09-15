import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

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
import type * as SessionModelUsage from "../../usage/session-model-usage.js";
import { Thread } from "./thread.js";

const fetchSessionModelUsage = vi.hoisted(() => vi.fn());

vi.mock("../../usage/session-model-usage.js", async (importOriginal) => {
	const actual = await importOriginal<typeof SessionModelUsage>();
	return {
		...actual,
		fetchSessionModelUsage,
	};
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
				contextWindow: 200_000,
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

const activeMessages: readonly ThreadMessageLike[] = [
	{
		role: "user",
		content: [{ type: "text", text: "Hello" }],
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "Hi" }],
		metadata: {
			custom: {},
			steps: [{ usage: { inputTokens: 12_400, outputTokens: 3_200 } }],
		},
	},
];

function ThreadHarness({
	initialMessages,
	width,
}: {
	initialMessages?: readonly ThreadMessageLike[];
	width?: string;
}) {
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
						<div className="h-[480px]" style={{ width: width ?? "48rem" }}>
							<Thread />
						</div>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

function Probe({ workspaceDirectory }: { workspaceDirectory?: string }) {
	return <output data-qa-id="footer-probe">{workspaceDirectory ?? "<none>"}</output>;
}

async function renderThread(
	initialMessages?: readonly ThreadMessageLike[],
	setup?: (
		sdk: ReturnType<typeof createFakeSdk>,
		mainSdk: ReturnType<typeof createFakeMainSdk>,
	) => void | Promise<void>,
	width?: string,
) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	await setup?.(sdk, mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness
							{...(initialMessages === undefined ? {} : { initialMessages })}
							{...(width === undefined ? {} : { width })}
						/>
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), sdk, mainSdk };
}

afterEach(() => {
	cleanup();
	fetchSessionModelUsage.mockReset();
});

describe("ComposerFooter", () => {
	it("hides the footer on an empty draft", async () => {
		fetchSessionModelUsage.mockResolvedValue(undefined);
		const { screen } = await renderThread();

		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-footer")).not.toBeInTheDocument();
	});

	it("shows Tokens In, Tokens Out, Cost, and the stock context popover on an active thread", async () => {
		fetchSessionModelUsage.mockResolvedValue({
			sessionIDs: ["ses-1"],
			totals: {
				steps: 1,
				cost: 0.231471,
				tokens: {
					input: 50_000,
					output: 8_000,
					reasoning: 1_200,
					cache: { read: 20_000, write: 2_000 },
				},
			},
			models: [
				{
					providerID: "kilo",
					modelID: "test-model",
					steps: 1,
					cost: 0.231471,
					tokens: {
						input: 50_000,
						output: 8_000,
						reasoning: 1_200,
						cache: { read: 20_000, write: 2_000 },
					},
				},
			],
		});

		const { screen } = await renderThread(activeMessages);

		await expect.element(screen.getByTestId("kilo-composer-footer")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-workspace")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-composer-footer-tokens-in").getByText("50.0K"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-footer-tokens-out").getByText("8.0K"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-footer-cost").getByText("$0.23"))
			.toBeVisible();
		await expect.element(screen.getByText("Tokens In")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Tokens Out")).not.toBeInTheDocument();

		const ring = screen.getByRole("button", { name: "Context usage" });
		await expect.element(ring).toBeVisible();
		await userEvent.hover(screen.getByTestId("kilo-composer-footer-cost"));

		const popover = screen.getByTestId("kilo-composer-context-popover");
		await expect.element(popover.getByText("Context")).toBeVisible();
		await expect.element(popover.getByText("15.6K / 200.0K")).toBeVisible();
		await expect.element(popover.getByText("8%")).toBeVisible();
		await expect.element(popover.getByText("Token usage")).toBeVisible();
		await expect.element(popover.getByText("Input")).toBeVisible();
		await expect.element(popover.getByText("50.0K")).toBeVisible();
		await expect.element(popover.getByText("Output")).toBeVisible();
		await expect.element(popover.getByText("8.0K")).toBeVisible();
		await expect.element(popover.getByText("Reasoning")).toBeVisible();
		await expect.element(popover.getByText("1.2K")).toBeVisible();
		await expect.element(popover.getByText("Cache Read")).toBeVisible();
		await expect.element(popover.getByText("20.0K")).toBeVisible();
		await expect.element(popover.getByText("Cache Write")).toBeVisible();
		await expect.element(popover.getByText("2.0K")).toBeVisible();
		await expect.element(screen.getByText("Total")).not.toBeInTheDocument();
		await expect.element(screen.getByText("System")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Tools")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Messages")).not.toBeInTheDocument();
		await expect.element(screen.getByText("last turn")).toBeVisible();
	});

	it("renders left-rail zone contributions with the active workspace folder", async () => {
		fetchSessionModelUsage.mockResolvedValue({
			sessionIDs: ["ses-1"],
			totals: {
				steps: 1,
				cost: 0.01,
				tokens: {
					input: 1_200,
					output: 300,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
			},
			models: [],
		});

		const { screen } = await renderThread(activeMessages, async (nextSdk, nextMainSdk) => {
			const saved = (await nextMainSdk.invoke("create", {
				name: "Project",
				color: "#F87171",
				folders: [
					{ path: "/repo/project", isPrimary: false },
					{ path: "/repo/primary", isPrimary: true },
				],
			})) as { id: string };
			localStorage.setItem("kilo-ui.active-workspace", saved.id);
			nextSdk.contribute("kilo-ui/chat-composer-footer", {
				id: "probe",
				component: Probe,
				label: "Probe",
			});
		});

		await expect.element(screen.getByTestId("kilo-composer-footer")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-workspace"))
			.toHaveTextContent("Project");
		await expect
			.element(screen.getByTestId("kilo-composer-workspace"))
			.toHaveAttribute("aria-label", "Workspace Project");
		await expect
			.element(screen.getByRole("button", { name: "Select workspace" }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("footer-probe")).toHaveTextContent("/repo/primary");
	});

	it("keeps cost and hides token counts on a narrow footer", async () => {
		fetchSessionModelUsage.mockResolvedValue({
			sessionIDs: ["ses-1"],
			totals: {
				steps: 1,
				cost: 0.12,
				tokens: {
					input: 50_000,
					output: 8_000,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
			},
			models: [],
		});

		const { screen } = await renderThread(
			activeMessages,
			async (nextSdk, nextMainSdk) => {
				const saved = (await nextMainSdk.invoke("create", {
					name: "Agentic Desktop",
					color: "#F87171",
					folders: [{ path: "/repo/primary", isPrimary: true }],
				})) as { id: string };
				localStorage.setItem("kilo-ui.active-workspace", saved.id);
				nextSdk.contribute("kilo-ui/chat-composer-footer", {
					id: "probe",
					component: Probe,
					label: "Probe",
				});
			},
			"20rem",
		);

		await expect.element(screen.getByTestId("kilo-composer-footer")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-footer-cost").getByText("$0.12"))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Context usage" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-footer-tokens-in")).not.toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-footer-tokens-out")).not.toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-workspace")).not.toBeVisible();
	});
});
