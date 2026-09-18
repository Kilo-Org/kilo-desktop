import {
	AssistantRuntimeProvider,
	useAui,
	useAuiState,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { Thread } from "./thread.js";

const extrasRef = vi.hoisted(() => ({
	current: undefined as OpenCodeRuntimeExtras | undefined,
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => extrasRef.current,
	selectOpenCodeExtras: () => extrasRef.current,
}));

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

function LastUserIdProbe() {
	const lastUserId = useAuiState((s) => {
		const last = s.thread.messages.findLast((message) => message.role === "user");
		return last?.id ?? "";
	});
	const userIds = useAuiState((s) =>
		s.thread.messages
			.filter((message) => message.role === "user")
			.map((message) => message.id)
			.join(","),
	);
	const allMessageIds = useAuiState((s) =>
		s.thread.messages.map((message) => message.id).join(","),
	);
	return (
		<>
			<output data-qa-id="last-user-id">{lastUserId}</output>
			<output data-qa-id="user-ids">{userIds}</output>
			<output data-qa-id="all-message-ids">{allMessageIds}</output>
		</>
	);
}

/**
 * Exposes composer attachment ids for assertions and provides a button to add a
 * stale attachment (id "stale-attachment") before a revert click.
 */
function ComposerProbe() {
	const aui = useAui();
	const attachmentIds = useAuiState((s) =>
		s.thread.composer.attachments.map((a) => a.id ?? "").join(","),
	);
	const composerText = useAuiState((s) => s.thread.composer.text);
	return (
		<>
			<output data-qa-id="composer-attachment-ids">{attachmentIds}</output>
			<output data-qa-id="composer-text">{composerText}</output>
			<button
				type="button"
				data-qa-id="add-stale-attachment"
				onClick={() => {
					void aui.thread.composer().addAttachment({
						id: "stale-attachment",
						type: "file",
						name: "stale.txt",
						content: [
							{ type: "file", data: "data:text/plain;base64,c3RhbGU=", mimeType: "text/plain" },
						],
					});
				}}
			>
				Add stale attachment
			</button>
		</>
	);
}

function ThreadHarness({
	initialMessages,
	chatModel,
}: {
	initialMessages?: readonly ThreadMessageLike[];
	chatModel?: ChatModelAdapter | undefined;
}) {
	const runtime = useLocalRuntime(chatModel ?? stubChatModel, {
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
							<LastUserIdProbe />
							<ComposerProbe />
						</div>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

function renderThread(
	initialMessages: readonly ThreadMessageLike[],
	extras: OpenCodeRuntimeExtras | undefined,
	chatModel?: ChatModelAdapter,
) {
	extrasRef.current = extras;
	const copyText = vi.fn(async () => undefined);
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		shell: { copyText },
	});
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness initialMessages={initialMessages} chatModel={chatModel} />
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);

	return { screen: page.elementLocator(baseElement) };
}

const revert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const unrevert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

function makeExtras(
	session: Record<string, unknown> | null = null,
	state: Record<string, unknown> = { messageOrder: [], messagesById: {} },
): OpenCodeRuntimeExtras {
	return {
		session: session as never,
		state: state as never,
		permissions: {},
		questions: {},
		fork: vi.fn(),
		revert,
		unrevert,
		cancel: vi.fn(),
		refresh: vi.fn(),
		replyToPermission: vi.fn(),
		replyToQuestion: vi.fn(),
		rejectQuestion: vi.fn(),
	};
}

function serverMessage(
	id: string,
	role: "user" | "assistant",
	parts: Array<Record<string, unknown>> = [],
	summary?: { diffs: Array<Record<string, unknown>> },
) {
	return { id, info: { id, role, ...(summary ? { summary } : {}) }, parts };
}

function revertSession(messageID: string) {
	return { id: "ses_1", revert: { messageID } };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	extrasRef.current = undefined;
	revert.mockClear();
	unrevert.mockClear();
});

describe("RevertToHereButton", () => {
	const seededMessages: ThreadMessageLike[] = [
		{
			role: "user",
			content: [{ type: "text", text: "Revert my prompt" }],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Assistant reply" }],
		},
	];

	// Pending-dim uses messageOrder index comparison. Generated ids are
	// random nanoids — pin explicit ids so the fixture state and the rendered
	// runtime share the same namespace for the seedFileChanges helper.
	const twoTurnMessages: ThreadMessageLike[] = [
		{ id: "msg-a1", role: "user", content: [{ type: "text", text: "First prompt" }] },
		{ id: "msg-a2", role: "assistant", content: [{ type: "text", text: "First reply" }] },
		{ id: "msg-b1", role: "user", content: [{ type: "text", text: "Second prompt" }] },
		{ id: "msg-b2", role: "assistant", content: [{ type: "text", text: "Second reply" }] },
	];

	const seededFileDiff = {
		file: "src/changed.ts",
		additions: 2,
		deletions: 1,
		status: "modified",
	} as const;

	function userRoots() {
		return document.querySelectorAll('[data-slot="aui_user-message-root"]');
	}

	// DOM-based reads for post-click assertions: vitest's expect.element
	// resolves via a text snapshot of the captured element, and the clicked
	// button's text changes with the "Reverting…" tooltip state swap.
	function revertButtonAt(index: number) {
		return (
			userRoots()[index]?.querySelector<HTMLButtonElement>(
				'[data-qa-id="kilo-revert-to-here-button"]',
			) ?? null
		);
	}

	function revertSpinnerAt(index: number) {
		return userRoots()[index]?.querySelector('[data-qa-id="kilo-revert-spinner"]') ?? null;
	}

	function assistantRoots() {
		return document.querySelectorAll('[data-slot="aui_assistant-message-root"]');
	}

	async function readUserIds(): Promise<string[]> {
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="user-ids"]')?.textContent ?? "",
			)
			.not.toBe("");
		return (document.querySelector<HTMLOutputElement>('[data-qa-id="user-ids"]')?.textContent ?? "")
			.split(",")
			.filter(Boolean);
	}

	async function readAllMessageIds(): Promise<string[]> {
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="all-message-ids"]')
						?.textContent ?? "",
			)
			.not.toBe("");
		return (
			document.querySelector<HTMLOutputElement>('[data-qa-id="all-message-ids"]')?.textContent ?? ""
		)
			.split(",")
			.filter(Boolean);
	}

	// Hovering the bubble both reveals the (non-last) action bar and pokes
	// the aui store so selectors re-read the mocked extras ref. A hover onto
	// coordinates the pointer already occupies is a no-op — and the pointer
	// persists across tests — so ping-pong through document.body first;
	// that makes the bubble hover a real move in every test. Using body (not
	// the thread viewport) avoids hover failures on Ubuntu headless where the
	// viewport container's center can fall outside the visible window area.
	async function hoverUserBubble(index: number) {
		await expect.poll(() => userRoots().length > index).toBe(true);
		await page.elementLocator(document.body).hover();
		await page
			.elementLocator(userRoots()[index]!.querySelector(".aui-user-message-content")!)
			.hover();
	}

	/**
	 * Fake extras whose per-turn `summary.diffs` make the revert-range gate
	 * pass for the given user messages. Runtime ids and fixture state must
	 * share one namespace, so the ids come from the rendered thread's probe.
	 * `messageOrder` mirrors the real server by including all messages (user
	 * and assistant) in render order — required for index-based dim lookups.
	 */
	async function seedFileChanges(userIds: readonly string[]) {
		const allIds = await readAllMessageIds();
		extrasRef.current = makeExtras(null, {
			messageOrder: allIds.length > 0 ? allIds : [...userIds],
			messagesById: Object.fromEntries(
				[...userIds].map((id) => [
					id,
					serverMessage(id, "user", [], { diffs: [seededFileDiff as Record<string, unknown>] }),
				]),
			),
		});
		await hoverUserBubble(0);
	}

	/**
	 * Renders two turns, seeds both gates, clicks the first turn's revert with
	 * a stalled promise, and waits for the in-flight spinner. `finish` settles
	 * the stalled revert call.
	 */
	async function startPendingRevert() {
		let settle: { resolve: () => void; reject: (error: Error) => void } = {
			resolve: () => undefined,
			reject: () => undefined,
		};
		revert.mockImplementationOnce(
			() =>
				new Promise<void>((resolve, reject) => {
					settle = { resolve, reject };
				}),
		);
		const { screen } = renderThread(twoTurnMessages, makeExtras());
		const [firstUserId, secondUserId] = (await readUserIds()) as [string, string];
		await seedFileChanges([firstUserId, secondUserId]);
		await hoverUserBubble(0);
		await page.elementLocator(userRoots()[0]!).getByTestId("kilo-revert-to-here-button").click();
		await expect.poll(() => revertSpinnerAt(0) !== null).toBe(true);
		const finish = (error?: Error) => (error ? settle.reject(error) : settle.resolve());
		return { screen, firstUserId, secondUserId, finish };
	}

	it("shows the revert action when the revert range has recorded file changes", async () => {
		const { screen } = renderThread(seededMessages, makeExtras());
		await seedFileChanges(await readUserIds());

		await expect.element(screen.getByTestId("kilo-revert-to-here-button")).toBeVisible();
	});

	it("hides the revert action when no OpenCode extras exist", async () => {
		const { screen } = renderThread(seededMessages, undefined);

		await expect.element(screen.getByTestId("kilo-revert-to-here-button")).not.toBeInTheDocument();
	});

	it("hides the revert action when the revert range has no file changes", async () => {
		const { screen } = renderThread(seededMessages, makeExtras());
		await hoverUserBubble(0);

		await expect.element(screen.getByTestId("kilo-revert-to-here-button")).not.toBeInTheDocument();
	});

	it("hides the revert action when file changes are only before the boundary candidate", async () => {
		renderThread(twoTurnMessages, makeExtras());
		const [firstUserId] = (await readUserIds()) as [string];
		await seedFileChanges([firstUserId]);
		await hoverUserBubble(1);

		// The second user message's range starts at itself, so the first
		// turn's diffs never reach it; the first turn's button still shows.
		const secondButton = page
			.elementLocator(userRoots()[1]!)
			.getByTestId("kilo-revert-to-here-button");
		await expect.element(secondButton).not.toBeInTheDocument();
		const firstButton = page
			.elementLocator(userRoots()[0]!)
			.getByTestId("kilo-revert-to-here-button");
		await expect.element(firstButton).toBeVisible();
	});

	it("hides the revert action when the user message has no assistant reply", async () => {
		const { screen } = renderThread(
			[
				{
					role: "user",
					content: [{ type: "text", text: "Unanswered prompt" }],
				},
			],
			makeExtras(),
		);
		await seedFileChanges(await readUserIds());

		await expect.element(screen.getByTestId("kilo-revert-to-here-button")).not.toBeInTheDocument();
	});

	it("reverts the message and prefills the composer", async () => {
		const { screen } = renderThread(seededMessages, makeExtras());
		await seedFileChanges(await readUserIds());

		await hoverUserBubble(0);
		await screen.getByTestId("kilo-revert-to-here-button").click();

		const lastUserId = document.querySelector<HTMLOutputElement>(
			'[data-qa-id="last-user-id"]',
		)?.textContent;
		await expect.poll(() => revert.mock.calls).toEqual([[lastUserId]]);
		await expect
			.element(screen.getByRole("textbox", { name: "Message input" }))
			.toHaveTextContent("Revert my prompt");
	});

	it("removes stale composer attachments and restores the message's attachments on revert", async () => {
		// Render a message that has an attachment — the attachment id is stable
		// because ThreadMessageLike lets us pin it.
		const messagesWithAttachment: ThreadMessageLike[] = [
			{
				role: "user",
				content: [{ type: "text", text: "With attachment" }],
				attachments: [
					{
						id: "restore-attachment-1",
						type: "file",
						name: "restore.txt",
						status: { type: "complete" },
						content: [
							{ type: "file", data: "data:text/plain;base64,aGVsbG8=", mimeType: "text/plain" },
						],
					},
				],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Assistant reply" }],
			},
		];

		const { screen } = renderThread(messagesWithAttachment, makeExtras());
		await seedFileChanges(await readUserIds());

		// Pre-seed a stale attachment that should be removed on revert.
		await screen.getByTestId("add-stale-attachment").click();
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-attachment-ids"]')
						?.textContent,
			)
			.toBe("stale-attachment");

		await hoverUserBubble(0);
		await screen.getByTestId("kilo-revert-to-here-button").click();

		// After revert resolves: stale attachment removed, restored one present.
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-attachment-ids"]')
						?.textContent,
			)
			.toBe("restore-attachment-1");
	});

	it("dims later messages and shows the spinner while the revert is in flight", async () => {
		const { firstUserId, finish } = await startPendingRevert();

		await expect.poll(() => revert.mock.calls).toEqual([[firstUserId]]);
		// The clicked button's undo icon is replaced by the in-flight spinner.
		await expect.poll(() => revertSpinnerAt(0) !== null).toBe(true);
		// Other revert targets stay disabled for the in-flight window.
		await expect.poll(() => revertButtonAt(1)?.disabled).toBe(true);
		// Messages strictly after the boundary dim; the clicked one does not.
		await expect.poll(() => userRoots()[0]?.classList.contains("opacity-50")).toBe(false);
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(true);
		await expect.poll(() => userRoots()[1]?.classList.contains("opacity-50")).toBe(true);
		await expect.poll(() => assistantRoots()[1]?.classList.contains("opacity-50")).toBe(true);
		// Composer prefill stays gated on success.
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-text"]')?.textContent,
			)
			.toBe("");

		finish();
	});

	it("clears the in-flight feedback and leaves the composer untouched when the revert fails", async () => {
		const { finish } = await startPendingRevert();
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(true);

		finish(new Error("revert failed"));

		await expect.poll(() => revertSpinnerAt(0) === null).toBe(true);
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(false);
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-text"]')?.textContent,
			)
			.toBe("");
		await expect.poll(() => revertButtonAt(0)?.disabled).toBe(false);
	});

	it("clears the dimming once the landed revert reports the new boundary", async () => {
		const { screen, firstUserId, finish } = await startPendingRevert();
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(true);

		finish();
		// Prefill runs once the HTTP call succeeds.
		await expect
			.element(screen.getByRole("textbox", { name: "Message input" }))
			.toHaveTextContent("First prompt");

		// Simulate the session.updated SSE: flip the fake extras to a pending
		// revert whose boundary is the clicked message, then poke the aui
		// store (the mock ref is not observed) so the provider's render-time
		// clear runs.
		extrasRef.current = makeExtras(revertSession(firstUserId), {
			messageOrder: [firstUserId],
			messagesById: {
				[firstUserId]: serverMessage(firstUserId, "user", [
					{ id: `${firstUserId}_1`, type: "text", text: "First prompt" },
				]),
			},
		});
		await hoverUserBubble(0);

		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(false);
		await expect.poll(() => userRoots()[1]?.classList.contains("opacity-50")).toBe(false);
	});

	it("clears pendingId when the revert resolves but the boundary lands on a different message id", async () => {
		// Regression: if another pane reverts while ours is in flight, the landed
		// boundary never equals our pendingId — RevertPendingProvider's render-time
		// clear never fires. revertNow must clear manually when the landed id is
		// defined and different.
		const { secondUserId, finish } = await startPendingRevert();
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(true);

		// Before settling, simulate another pane moving the boundary to the
		// second user message.
		extrasRef.current = makeExtras(revertSession(secondUserId), {
			messageOrder: [],
			messagesById: {},
		});

		finish();

		// After the revert promise resolves, the spinner and dim must clear even
		// though the landed boundary id !== the clicked id.
		await expect.poll(() => revertSpinnerAt(0) === null).toBe(true);
		await expect.poll(() => assistantRoots()[0]?.classList.contains("opacity-50")).toBe(false);
	});

	it("shows the revert button for a message with diffs even when its id sorts before the boundary id lexicographically", async () => {
		// Regression: string comparison `id < messageId` skips ids that are
		// lexicographically smaller, hiding the button incorrectly for non-monotonic ids.
		// Use deliberately reversed IDs: first user "zz-first" (lex > "aa-second"),
		// second user "aa-second" (lex < "zz-first"). Seed diffs only on "aa-second".
		renderThread([], makeExtras());
		// We need to use non-default ids — use twoTurnMessages with explicit ids
		// from the fixture but override extras to use non-monotonic ids.
		// The fixture ids are assigned by the runtime; we seed custom extras ids
		// that don't match — instead render with our own pinned-id messages.
		cleanup();

		const nonMonotonicMessages: ThreadMessageLike[] = [
			{ id: "zz-first", role: "user", content: [{ type: "text", text: "First" }] },
			{ id: "zz-first-reply", role: "assistant", content: [{ type: "text", text: "Reply 1" }] },
			{ id: "aa-second", role: "user", content: [{ type: "text", text: "Second" }] },
			{ id: "aa-second-reply", role: "assistant", content: [{ type: "text", text: "Reply 2" }] },
		];

		const seededFileDiffNonMonotonic = {
			file: "src/changed.ts",
			additions: 2,
			deletions: 1,
			status: "modified",
		} as const;

		extrasRef.current = makeExtras(null, {
			messageOrder: ["zz-first", "zz-first-reply", "aa-second", "aa-second-reply"],
			messagesById: {
				"zz-first": serverMessage("zz-first", "user"),
				"zz-first-reply": serverMessage("zz-first-reply", "assistant"),
				// Only the second user message has diffs.
				"aa-second": serverMessage("aa-second", "user", [], {
					diffs: [seededFileDiffNonMonotonic as Record<string, unknown>],
				}),
				"aa-second-reply": serverMessage("aa-second-reply", "assistant"),
			},
		});

		const copyText = vi.fn(async () => undefined);
		const sdk = createFakeSdk({ featureId: "kilo-ui", shell: { copyText } });
		const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
		kiloUiBrowserRegister(mainSdk);
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { baseElement } = render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<WorkspacesFeatureProvider>
						<KiloAuthContext.Provider value={signedInAuth}>
							<ThreadHarness initialMessages={nonMonotonicMessages} />
						</KiloAuthContext.Provider>
					</WorkspacesFeatureProvider>
				</QueryClientProvider>
			</SdkProvider>,
		);

		// Hover first user bubble to reveal its action bar.
		void baseElement; // the render side-effect is what matters
		await expect
			.poll(() => document.querySelectorAll('[data-slot="aui_user-message-root"]').length >= 2)
			.toBe(true);
		await page.elementLocator(document.body).hover();
		await page
			.elementLocator(
				document
					.querySelectorAll('[data-slot="aui_user-message-root"]')[0]!
					.querySelector(".aui-user-message-content")!,
			)
			.hover();

		// The first user message ("zz-first") has no diffs in its range starting at
		// itself — only "aa-second" has diffs, which is *before* "zz-first" in
		// lexicographic order but *after* it in messageOrder. So the first
		// message's button should NOT be shown (no diffs at or after it in lex order
		// would mean it appears, but we want the opposite: confirm button is hidden).
		// Actually, the range for "zz-first" starts at index 0 and scans forward
		// through the whole order — "aa-second" at index 2 has diffs, so the button
		// SHOULD show for "zz-first".
		// Pre-fix: `id < messageId` uses string comparison: "aa-second" < "zz-first"
		// is true, so it is skipped in the scan — the button incorrectly hides.
		// Post-fix: index-based scan includes "aa-second" — the button shows.
		const firstButton = page
			.elementLocator(document.querySelectorAll('[data-slot="aui_user-message-root"]')[0]!)
			.getByTestId("kilo-revert-to-here-button");
		await expect.element(firstButton).toBeVisible();

		cleanup();
	});

	it("keeps the user action bar visible and disables revert while the agent is running", async () => {
		let resolveRun: () => void = () => undefined;
		const blockingChatModel: ChatModelAdapter = {
			run: () =>
				new Promise((resolve) => {
					resolveRun = () => resolve({ content: [{ type: "text", text: "ok" }] });
				}),
		};
		const { screen } = renderThread(seededMessages, makeExtras(), blockingChatModel);

		await expect.poll(() => userRoots().length).toBe(1);
		await seedFileChanges(await readUserIds());
		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("Second prompt");
		await screen.getByRole("button", { name: "Send message" }).click();

		await expect.poll(() => userRoots().length).toBe(2);
		const firstUserRoot = page.elementLocator(userRoots()[0]!);
		await hoverUserBubble(0);

		// The bar must stay visible while running — hiding it made the disabled
		// state (and the copy action) unreachable mid-run.
		await expect
			.poll(() =>
				document
					.querySelector('[data-slot="aui_user-message-root"] .aui-user-action-bar-root')
					?.classList.contains("opacity-100"),
			)
			.toBe(true);

		await expect.element(firstUserRoot.getByTestId("kilo-revert-to-here-button")).toBeDisabled();
		await expect.element(firstUserRoot.getByRole("button", { name: "Copy" })).toBeEnabled();

		resolveRun();
	});
});

describe("CheckpointRestoreControls", () => {
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

	const revertedState = {
		messageOrder: ["msg-1", "msg-2", "msg-3", "msg-4"],
		messagesById: {
			"msg-1": serverMessage("msg-1", "assistant"),
			"msg-2": serverMessage("msg-2", "user", [{ id: "msg-2_1", type: "text", text: "second" }]),
			"msg-3": serverMessage("msg-3", "assistant"),
			"msg-4": serverMessage("msg-4", "user", [
				{ id: "msg-4_1", type: "text", text: "next prompt" },
			]),
		},
	};

	it("shows the revert count and an Undo-only header while a revert is pending", async () => {
		const { screen } = renderThread(
			seededMessages,
			makeExtras(revertSession("msg-2"), revertedState),
		);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
		await expect.element(screen.getByText("2 messages reverted")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Undo revert" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-revert-undo-button")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-restore-button")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-restore-all-button")).not.toBeInTheDocument();
	});

	it("hides the header while no revert is pending", async () => {
		const { screen } = renderThread(seededMessages, makeExtras());

		await expect.element(screen.getByTestId("kilo-composer-header")).not.toBeInTheDocument();
	});

	it("undoes the pending revert and clears the composer", async () => {
		const { screen } = renderThread(
			seededMessages,
			makeExtras(revertSession("msg-2"), revertedState),
		);

		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("keep this draft");
		await screen.getByTestId("kilo-revert-undo-button").click();

		await expect.poll(() => unrevert.mock.calls).toHaveLength(1);
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-text"]')?.textContent,
			)
			.toBe("");
		expect(revert).not.toHaveBeenCalled();
	});

	it("disables Undo while the agent is running", async () => {
		let resolveRun: () => void = () => undefined;
		const blockingChatModel: ChatModelAdapter = {
			run: () =>
				new Promise((resolve) => {
					resolveRun = () => resolve({ content: [{ type: "text", text: "ok" }] });
				}),
		};
		const { screen } = renderThread(
			seededMessages,
			makeExtras(revertSession("msg-2"), revertedState),
			blockingChatModel,
		);

		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("go");
		await screen.getByRole("button", { name: "Send message" }).click();

		await expect.element(screen.getByTestId("kilo-revert-undo-button")).toBeDisabled();

		resolveRun();
	});

	// DOM-based read: two rows share the restore-button qa-id, so tests pick
	// the row by its reverted-range position (messageOrder order).
	function rowRestoreButtonAt(index: number) {
		return (
			document
				.querySelectorAll('[data-qa-id="kilo-revert-message-row"]')
				[index]?.querySelector<HTMLButtonElement>(
					'[data-qa-id="kilo-revert-row-restore-button"]',
				) ?? null
		);
	}

	it("restores through the clicked row by stepping the boundary to the next user message", async () => {
		const { screen } = renderThread(
			seededMessages,
			makeExtras(revertSession("msg-2"), revertedState),
		);

		await screen.getByTestId("kilo-revert-messages-toggle").click();
		await expect.poll(() => rowRestoreButtonAt(0) !== null).toBe(true);
		// Wait for the CollapsibleContent animation to finish so the button is
		// actionable before clicking; on Ubuntu the open animation can still be
		// running when the DOM node is first present.
		await expect.element(page.elementLocator(rowRestoreButtonAt(0)!)).toBeVisible();
		await page.elementLocator(rowRestoreButtonAt(0)!).click();

		await expect.poll(() => revert.mock.calls).toEqual([["msg-4"]]);
		await expect
			.element(screen.getByRole("textbox", { name: "Message input" }))
			.toHaveTextContent("next prompt");
		expect(unrevert).not.toHaveBeenCalled();
	});

	it("unreverts and clears the composer when the last row has no next user message", async () => {
		const { screen } = renderThread(
			seededMessages,
			makeExtras(revertSession("msg-2"), revertedState),
		);
		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("keep this draft");

		await screen.getByTestId("kilo-revert-messages-toggle").click();
		await expect.poll(() => rowRestoreButtonAt(1) !== null).toBe(true);
		await page.elementLocator(rowRestoreButtonAt(1)!).click();

		await expect.poll(() => unrevert.mock.calls).toHaveLength(1);
		await expect
			.poll(
				() =>
					document.querySelector<HTMLOutputElement>('[data-qa-id="composer-text"]')?.textContent,
			)
			.toBe("");
		expect(revert).not.toHaveBeenCalled();
	});
});
