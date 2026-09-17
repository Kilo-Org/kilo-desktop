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

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

const extrasRef = vi.hoisted(() => ({
	current: undefined as OpenCodeRuntimeExtras | undefined,
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => extrasRef.current,
	selectOpenCodeExtras: () => extrasRef.current,
}));

const toastWarning = vi.hoisted(() => vi.fn());

vi.mock("@anaconda-agentic-desktop/ui/components/sonner", () => ({
	toast: {
		warning: toastWarning,
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
	},
}));

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { Thread } from "./thread.js";
import { resetCheckpointNoticeHistory } from "./checkpoint-restore-controls.js";

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

type SnapshotFileDiffFixture = {
	file?: string;
	additions: number;
	deletions: number;
	status?: "added" | "deleted" | "modified";
};

type RevertWorkspace = "restored" | "snapshots-disabled" | "unavailable";

function serverMessage(
	id: string,
	role: "user" | "assistant",
	parts: Array<Record<string, unknown>> = [],
	summary?: { diffs: Array<Record<string, unknown>> },
) {
	return { id, info: { id, role, ...(summary ? { summary } : {}) }, parts };
}

const defaultState = {
	messageOrder: ["msg-2"],
	messagesById: { "msg-2": serverMessage("msg-2", "user") },
};

function makePendingRevertExtras(options: {
	diffs?: SnapshotFileDiffFixture[];
	revertWorkspace?: RevertWorkspace | null;
	boundaryId?: string;
	state?: { messageOrder: string[]; messagesById: Record<string, unknown> };
}): OpenCodeRuntimeExtras {
	return {
		session: {
			id: "ses_1",
			revert: {
				messageID: options.boundaryId ?? "msg-2",
				...(options.revertWorkspace ? { workspace: options.revertWorkspace } : {}),
			},
			...(options.diffs === undefined
				? {}
				: {
						summary: {
							additions: 0,
							deletions: 0,
							files: 0,
							diffs: options.diffs,
						},
					}),
		} as never,
		state: (options.state ?? defaultState) as never,
		permissions: {},
		questions: {},
		fork: vi.fn(),
		revert: vi.fn().mockResolvedValue(undefined),
		unrevert: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn(),
		refresh: vi.fn(),
		replyToPermission: vi.fn(),
		replyToQuestion: vi.fn(),
		rejectQuestion: vi.fn(),
	} as OpenCodeRuntimeExtras;
}

const seededMessages: ThreadMessageLike[] = [
	{
		role: "user",
		content: [{ type: "text", text: "Hello" }],
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "Hi there" }],
	},
];

function renderThread(
	options: {
		diffs?: SnapshotFileDiffFixture[];
		revertWorkspace?: RevertWorkspace | null;
		boundaryId?: string;
		state?: { messageOrder: string[]; messagesById: Record<string, unknown> };
	} = {},
) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	extrasRef.current = makePendingRevertExtras(options);

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness initialMessages={seededMessages} />
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);

	return { screen: page.elementLocator(baseElement) };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	extrasRef.current = undefined;
	toastWarning.mockClear();
	resetCheckpointNoticeHistory();
});

describe("CheckpointRestoreControls", () => {
	it("merges the reverted-message count and aggregate diff totals into one collapsed toggle row", async () => {
		const { screen } = renderThread({
			diffs: [
				{ file: "src/alpha.ts", additions: 3, deletions: 1, status: "modified" },
				{ file: "src/beta.ts", additions: 2, deletions: 0, status: "added" },
			],
		});

		const toggle = screen.getByTestId("kilo-revert-messages-toggle");
		await expect.element(toggle).toBeVisible();
		await expect.element(screen.getByText("1 message reverted")).toBeVisible();
		await expect.element(screen.getByText("+5")).toBeVisible();
		await expect.element(screen.getByText("−1")).toBeVisible();
		// The old standalone "N files changed" line is gone for good.
		await expect
			.poll(() => document.querySelector('[data-qa-id="kilo-composer-header"]')?.textContent ?? "")
			.not.toContain("file");
		await expect.element(screen.getByTestId("kilo-revert-messages-list")).not.toBeInTheDocument();
	});

	it("expands one row per reverted user message with per-turn diff stats", async () => {
		const { screen } = renderThread({
			state: {
				messageOrder: ["msg-2", "msg-3", "msg-4"],
				messagesById: {
					"msg-2": serverMessage(
						"msg-2",
						"user",
						[{ id: "msg-2_1", type: "text", text: "second" }],
						{ diffs: [{ file: "src/alpha.ts", additions: 3, deletions: 1, status: "modified" }] },
					),
					"msg-3": serverMessage("msg-3", "assistant"),
					"msg-4": serverMessage("msg-4", "user", [
						{ id: "msg-4_1", type: "text", text: "next prompt" },
					]),
				},
			},
		});

		const toggle = screen.getByTestId("kilo-revert-messages-toggle");
		await expect.element(screen.getByText("2 messages reverted")).toBeVisible();
		await toggle.click();

		const list = screen.getByTestId("kilo-revert-messages-list");
		await expect.element(list).toBeVisible();
		// The list names the region for screen readers via aria-label.
		await expect.element(list).toHaveAttribute("aria-label", "Reverted messages");

		// One row per reverted user turn.
		await expect.element(list.getByText("second")).toBeVisible();
		await expect.element(list.getByText("next prompt")).toBeVisible();
		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="kilo-revert-message-row"]').length)
			.toBe(2);
		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="kilo-revert-row-restore-button"]').length)
			.toBe(2);

		// The per-turn stat only appears for turns that recorded file changes;
		// diff-less rows read "No changes" instead of a zero stat.
		await expect.element(list.getByText("+3")).toBeVisible();
		await expect.element(list.getByText("−1")).toBeVisible();
		await expect.element(list.getByText("No changes")).toBeVisible();
		await expect
			.poll(
				() =>
					Array.from(document.querySelectorAll('[data-qa-id="kilo-revert-message-row"]')).filter(
						(row) => row.textContent?.includes("No changes"),
					).length,
			)
			.toBe(1);
	});

	it("falls back to '(no text)' for attachment-only reverted messages", async () => {
		const { screen } = renderThread({
			state: {
				messageOrder: ["msg-2"],
				messagesById: {
					"msg-2": serverMessage("msg-2", "user", [
						{
							id: "msg-2_1",
							type: "file",
							filename: "clip.png",
							mime: "image/png",
							url: "file:///tmp/clip.png",
						},
					]),
				},
			},
		});

		await screen.getByTestId("kilo-revert-messages-toggle").click();

		await expect.element(screen.getByTestId("kilo-revert-messages-list")).toBeVisible();
		await expect.element(screen.getByText("(no text)")).toBeVisible();
		// The attachment-only turn also recorded no diffs, so its stat slot
		// reads "No changes".
		await expect
			.element(screen.getByTestId("kilo-revert-message-row").getByText("No changes"))
			.toBeVisible();
	});

	it("expands the trigger even when the reverted turns recorded no file diffs", async () => {
		const { screen } = renderThread();

		const toggle = screen.getByTestId("kilo-revert-messages-toggle");
		await expect.element(toggle).toBeVisible();
		await expect.element(screen.getByText("1 message reverted")).toBeVisible();
		// No aggregate stat when the revert recorded no file changes.
		await expect.element(screen.getByText("+0")).not.toBeInTheDocument();
		await toggle.click();
		await expect.element(screen.getByTestId("kilo-revert-messages-list")).toBeVisible();
	});

	it("falls back to a plain summary when a legacy partID boundary hides all user rows", async () => {
		const { screen } = renderThread({
			boundaryId: "msg-5",
			state: {
				messageOrder: ["msg-5", "msg-6"],
				messagesById: {
					"msg-5": serverMessage("msg-5", "assistant"),
					"msg-6": serverMessage("msg-6", "assistant"),
				},
			},
		});

		await expect.element(screen.getByText("0 messages reverted")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-revert-messages-toggle")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-revert-messages-list")).not.toBeInTheDocument();
		// Undo stays reachable for reverts the desktop client did not create.
		await expect.element(screen.getByTestId("kilo-revert-undo-button")).toBeVisible();
	});

	it("composes the merged toggle for reverts without workspace status", async () => {
		const { screen } = renderThread({
			diffs: [{ file: "src/legacy.ts", additions: 4, deletions: 2, status: "modified" }],
		});

		const toggle = screen.getByTestId("kilo-revert-messages-toggle");
		await expect.element(toggle).toBeVisible();
		await expect.element(screen.getByText("1 message reverted")).toBeVisible();
		await expect.element(screen.getByText("+4")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Conversation reverted. Workspace restoration status is unavailable for this earlier revert.",
				),
			)
			.not.toBeInTheDocument();
	});

	it("composes the merged toggle with the snapshots-disabled workspace status", async () => {
		const { screen } = renderThread({
			diffs: [{ file: "src/kept.ts", additions: 1, deletions: 0, status: "added" }],
			revertWorkspace: "snapshots-disabled",
		});

		const toggle = screen.getByTestId("kilo-revert-messages-toggle");
		await expect.element(toggle).toBeVisible();
		await expect.element(screen.getByText("+1")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Conversation reverted. File changes were not restored because snapshots are disabled.",
				),
			)
			.not.toBeInTheDocument();
	});

	it("fires toast.warning exactly once per boundary+workspace combination", async () => {
		renderThread({ revertWorkspace: "snapshots-disabled", boundaryId: "msg-2" });

		await expect.poll(() => toastWarning.mock.calls.length).toBe(1);
		expect(toastWarning).toHaveBeenCalledWith(
			"Conversation reverted. File changes were not restored because snapshots are disabled.",
		);
	});

	it("fires the notice for each session when two different sessions share the same boundary id", async () => {
		// Regression: module-level Set keyed by `${boundaryId}:${workspace}` without
		// the session id suppresses the notice for a second session that happens to
		// share the same boundary id string.
		renderThread({ revertWorkspace: "snapshots-disabled", boundaryId: "msg-2" });
		await expect.poll(() => toastWarning.mock.calls.length).toBe(1);
		toastWarning.mockClear();
		cleanup();

		// Render a second thread whose session id is different but whose boundary id
		// is the same string. The notice must fire again.
		const sdk2 = createFakeSdk({ featureId: "kilo-ui" });
		const mainSdk2 = createFakeMainSdk({ featureId: "kilo-ui", services: sdk2.services });
		kiloUiBrowserRegister(mainSdk2);
		const system2 = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk2 } });
		const queryClient2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		// Override the extras session id to "ses_2".
		extrasRef.current = {
			...makePendingRevertExtras({ revertWorkspace: "snapshots-disabled", boundaryId: "msg-2" }),
			session: {
				id: "ses_2",
				revert: { messageID: "msg-2", workspace: "snapshots-disabled" },
			} as never,
		};

		const { baseElement } = render(
			<SdkProvider system={system2}>
				<QueryClientProvider client={queryClient2}>
					<WorkspacesFeatureProvider>
						<KiloAuthContext.Provider value={signedInAuth}>
							<ThreadHarness initialMessages={seededMessages} />
						</KiloAuthContext.Provider>
					</WorkspacesFeatureProvider>
				</QueryClientProvider>
			</SdkProvider>,
		);
		void baseElement; // suppress unused warning

		await expect.poll(() => toastWarning.mock.calls.length).toBe(1);
	});

	it("does not fire the toast again on unmount and remount with the same boundary", async () => {
		renderThread({ revertWorkspace: "snapshots-disabled", boundaryId: "msg-2" });
		await expect.poll(() => toastWarning.mock.calls.length).toBe(1);

		// Unmount and remount with the same boundary+workspace.
		cleanup();
		toastWarning.mockClear();

		renderThread({ revertWorkspace: "snapshots-disabled", boundaryId: "msg-2" });

		// The dedupe set prevents a second toast.
		await expect.poll(() => toastWarning.mock.calls.length).toBe(0);
	});
});
