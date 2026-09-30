import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import type * as SessionModelUsage from "../../usage/session-model-usage.js";
import { ComposerFooter, ComposerSessionMode } from "./composer-footer.js";

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

// Minimal duck-typed OpenCode extras: selectOpenCodeExtras only checks the three
// reply functions; the usage hook reads `session.id`/`session.directory`.
const testRuntimeExtras = {
	replyToQuestion: () => undefined,
	rejectQuestion: () => undefined,
	replyToPermission: () => undefined,
	session: { id: "ses_test-session", directory: "/tmp/kilo-runtime" },
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
	withSession,
}: {
	initialMessages?: readonly ThreadMessageLike[];
	width?: string;
	withSession?: boolean;
}) {
	const runtime = useExternalStoreRuntime({
		messages: initialMessages ?? [],
		onNew: async () => {},
		convertMessage: (message) => message as never,
		// Simulate the production runtime: after lazy session initialization resolves,
		// thread.extras carries the server session ref. Without it the composer usage
		// meter must not fetch (DESK-2884 guard).
		...(withSession ? { extras: testRuntimeExtras } : {}),
	});

	const isDraft = (initialMessages ?? []).length === 0;

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
							{isDraft ? <div data-qa-id="kilo-composer-draft-footer" /> : <ComposerFooter />}
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
	withSession?: boolean,
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
							{...(withSession === undefined ? {} : { withSession })}
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
	it("labels a worktree-backed active session as Worktree", async () => {
		const { baseElement } = render(<ComposerSessionMode isWorktree />);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("kilo-composer-session-mode"))
			.toHaveTextContent("Worktree");
		await expect
			.element(screen.getByTestId("kilo-composer-session-mode"))
			.toHaveAttribute("aria-label", "Session mode Worktree");
	});

	it("hides the footer on an empty draft", async () => {
		fetchSessionModelUsage.mockResolvedValue(undefined);
		const { screen } = await renderThread();

		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-composer-footer")).not.toBeInTheDocument();
	});

	it("does not fetch usage before the server session id resolves (DESK-2884)", async () => {
		fetchSessionModelUsage.mockResolvedValue(undefined);
		const { screen } = await renderThread(activeMessages);

		await expect.element(screen.getByTestId("kilo-composer-footer")).toBeVisible();
		await expect.poll(() => fetchSessionModelUsage.mock.calls.length, { timeout: 500 }).toBe(0);
		await expect.element(screen.getByRole("button", { name: "Context usage" })).toBeVisible();
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

		const { screen } = await renderThread(activeMessages, undefined, undefined, true);

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
		await expect.element(popover).not.toBeInTheDocument();
		await ring.click();
		await expect.element(ring).toHaveAttribute("aria-expanded", "true");
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
		await expect.element(popover.getByText("Cache read")).toBeVisible();
		await expect.element(popover.getByText("20.0K")).toBeVisible();
		await expect.element(popover.getByText("Cache write")).toBeVisible();
		await expect.element(popover.getByText("2.0K")).toBeVisible();
		await expect.element(screen.getByText("Total")).not.toBeInTheDocument();
		await expect.element(screen.getByText("System")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Tools")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Messages")).not.toBeInTheDocument();
		await expect.element(screen.getByText("last turn")).toBeVisible();
		await ring.click();
		await expect.element(ring).toHaveAttribute("aria-expanded", "false");
		await expect
			.poll(() => {
				const element = document.querySelector<HTMLElement>(
					'[data-qa-id="kilo-composer-context-popover"]',
				);
				return element === null || getComputedStyle(element).display === "none";
			})
			.toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await expect.element(popover).not.toBeInTheDocument();

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await ring.click();
			await expect.element(ring).toHaveAttribute("aria-expanded", "true");
			await ring.click();
			await expect.element(ring).toHaveAttribute("aria-expanded", "false");
		}
	});

	it("shows Local and active-thread contributions without repeating the workspace selection", async () => {
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
		await expect.element(screen.getByTestId("kilo-composer-workspace")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-composer-session-mode"))
			.toHaveTextContent("Local");
		await expect
			.element(screen.getByTestId("kilo-composer-session-mode"))
			.toHaveAttribute("aria-label", "Session mode Local");
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
					name: "Kilo Desktop",
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
			true,
		);

		await expect.element(screen.getByTestId("kilo-composer-footer")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-footer-cost").getByText("$0.12"))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Context usage" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-footer-tokens-in")).not.toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-footer-tokens-out")).not.toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-workspace")).not.toBeInTheDocument();
	});
});
