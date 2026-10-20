import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import {
	OpenCodeAttachmentAdapter,
	useOpenCodeRuntime,
	useOpenCodeSession,
} from "@assistant-ui/react-opencode";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { KiloClient } from "@kilocode/sdk/v2/client";

type SessionCreateResult = { data: { id: string } };

const KILO_DEFAULT_TITLE = "New session - 2026-10-20T17:00:00.000Z";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createFakeClient(
	createSession: () => Promise<SessionCreateResult> = async () => ({
		data: { id: "session-1" },
	}),
) {
	const session = {
		id: "session-1",
		title: KILO_DEFAULT_TITLE,
		directory: "/workspace",
		time: { created: Date.now(), updated: Date.now() },
	};
	const create = vi.fn(createSession);
	const list = vi.fn(async () => ({ data: [] as (typeof session)[] }));
	const promptAsync = vi.fn(async () => ({ data: undefined }));
	const get = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
		data: { ...session, id: sessionID },
	}));
	const messages = vi.fn(async () => ({ data: [] }));
	const update = vi.fn(async () => ({ data: undefined }));
	const eventSubscribe = vi.fn(async (_input: unknown, options: { signal: AbortSignal }) => ({
		stream: (async function* () {
			await new Promise<void>((resolve) => {
				if (options.signal.aborted) {
					resolve();
					return;
				}
				options.signal.addEventListener("abort", () => resolve(), { once: true });
			});
			yield* [];
		})(),
	}));
	const client = {
		experimental: {
			session: {
				list,
			},
		},
		session: {
			create,
			get,
			messages,
			promptAsync,
			update,
			summarize: vi.fn(async () => ({ data: undefined })),
		},
		event: { subscribe: eventSubscribe },
	} as unknown as KiloClient;

	return { client, create, list, promptAsync, update };
}

function RuntimeState() {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const threadTitle = useAuiState((state) => state.threadListItem.title);
	const attachmentCount = useAuiState((state) => state.composer.attachments.length);
	const queuedCount = useAuiState((state) => state.composer.queue.length);
	const messageCount = useAuiState((state) => state.thread.messages.length);
	const userMessageCount = useAuiState(
		(state) => state.thread.messages.filter((message) => message.role === "user").length,
	);
	const lastUserText = useAuiState((state) => {
		const lastUser = state.thread.messages.findLast((message) => message.role === "user");
		if (!lastUser) return "";
		return lastUser.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
	});
	const lastUserAttachmentCount = useAuiState((state) => {
		const lastUser = state.thread.messages.findLast((message) => message.role === "user");
		if (!lastUser || lastUser.role !== "user") return 0;
		return lastUser.attachments.length;
	});
	const queueControls = useAuiState((state) => {
		const extras = state.thread.extras as { messageQueue?: { pause?: unknown } } | undefined;
		return typeof extras?.messageQueue?.pause === "function" ? "available" : "none";
	});
	// Resolves only through the branded extras, so it reads "none" if the brand is lost.
	const openCodeSessionId = useOpenCodeSession()?.id ?? "none";
	return (
		<>
			<button
				type="button"
				onClick={() => {
					void aui.composer.addAttachment(
						new File(["Remember this attachment"], "notes.txt", { type: "text/plain" }),
					);
				}}
			>
				Add attachment
			</button>
			<output data-qa-id="remote-session-id">{remoteId ?? "none"}</output>
			<output data-qa-id="thread-title">{threadTitle ?? "none"}</output>
			<output data-qa-id="attachment-count">{attachmentCount}</output>
			<output data-qa-id="queued-count">{queuedCount}</output>
			<output data-qa-id="message-count">{messageCount}</output>
			<output data-qa-id="user-message-count">{userMessageCount}</output>
			<output data-qa-id="last-user-text">{lastUserText}</output>
			<output data-qa-id="last-user-attachment-count">{lastUserAttachmentCount}</output>
			<output data-qa-id="queue-controls">{queueControls}</output>
			<output data-qa-id="opencode-session-id">{openCodeSessionId}</output>
		</>
	);
}

function RuntimeHarness({
	client,
	initialSessionId,
	onError,
	onRuntime,
	withMessageQueue = false,
	queueUserControls = false,
}: {
	client: KiloClient;
	initialSessionId?: string;
	onError?: (error: unknown) => void;
	onRuntime?: (runtime: ReturnType<typeof useOpenCodeRuntime>) => void;
	/** Mirrors the production option in use-kilo-runtime.ts. */
	withMessageQueue?: boolean;
	/** Mirrors the prompt-queue-editing flag. */
	queueUserControls?: boolean;
}) {
	const runtime = useOpenCodeRuntime({
		client,
		adapters: { attachments: new OpenCodeAttachmentAdapter() },
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onError === undefined ? {} : { onError }),
		...(withMessageQueue
			? {
					messageQueue: {
						cancelBehavior: "pause" as const,
						...(queueUserControls ? { userControls: true } : {}),
					},
				}
			: {}),
	});

	useEffect(() => onRuntime?.(runtime), [onRuntime, runtime]);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ComposerPrimitive.Root>
				<ComposerPrimitive.Input aria-label="Message" />
				<ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
			</ComposerPrimitive.Root>
			<RuntimeState />
		</AssistantRuntimeProvider>
	);
}

function renderRuntime(props: Parameters<typeof RuntimeHarness>[0]) {
	return render(<RuntimeHarness {...props} />);
}

afterEach(() => cleanup());

describe("patched OpenCode lazy session initialization", () => {
	it("keeps the composer writable and creates the remote session on first send", async () => {
		const fake = createFakeClient();
		const { baseElement } = renderRuntime({ client: fake.client });
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await expect.element(input).toBeEnabled();
		await expect.element(screen.getByTestId("remote-session-id")).toHaveTextContent("none");
		expect(fake.create).not.toHaveBeenCalled();

		await input.fill("Inspect the workspace");
		expect(fake.create).not.toHaveBeenCalled();
		await screen.getByRole("button", { name: "Send" }).click();

		await waitFor(() => expect(fake.create).toHaveBeenCalledOnce());
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("remote-session-id")).toHaveTextContent("session-1");
		expect(fake.promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "session-1",
				parts: [{ type: "text", text: "Inspect the workspace" }],
			}),
			expect.objectContaining({ throwOnError: true }),
		);
	});

	it("titles a new chat with Kilo's session title without writing it back", async () => {
		const fake = createFakeClient();
		const { baseElement } = renderRuntime({ client: fake.client });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent("none");
		await screen.getByRole("textbox", { name: "Message" }).fill("Inspect the workspace");
		await screen.getByRole("button", { name: "Send" }).click();

		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent(KILO_DEFAULT_TITLE);
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("keeps Kilo's session title when the first run ends", async () => {
		const fake = createFakeClient();
		let runtime: ReturnType<typeof useOpenCodeRuntime> | undefined;
		const { baseElement } = renderRuntime({
			client: fake.client,
			onRuntime: (value) => {
				runtime = value;
			},
		});
		const screen = page.elementLocator(baseElement);
		await screen.getByRole("textbox", { name: "Message" }).fill("Inspect the workspace");
		await screen.getByRole("button", { name: "Send" }).click();
		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent(KILO_DEFAULT_TITLE);

		// RemoteThreadList calls generateTitle on the first runEnd.
		await runtime!.threads.mainItem.generateTitle();

		expect(runtime!.threads.mainItem.getState().title).toBe(KILO_DEFAULT_TITLE);
		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent(KILO_DEFAULT_TITLE);
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("still sends a user rename of a mirrored title to Kilo", async () => {
		const fake = createFakeClient();
		let runtime: ReturnType<typeof useOpenCodeRuntime> | undefined;
		const { baseElement } = renderRuntime({
			client: fake.client,
			initialSessionId: "existing-session",
			onRuntime: (value) => {
				runtime = value;
			},
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent(KILO_DEFAULT_TITLE);

		await runtime!.threads.mainItem.rename("Workspace audit");

		await expect.element(screen.getByTestId("thread-title")).toHaveTextContent("Workspace audit");
		expect(fake.update).toHaveBeenCalledWith(
			expect.objectContaining({ sessionID: "existing-session", title: "Workspace audit" }),
			expect.anything(),
		);
	});

	it("shows an optimistic user bubble before session creation resolves", async () => {
		const creation = deferred<SessionCreateResult>();
		const fake = createFakeClient(() => creation.promise);
		const { baseElement } = renderRuntime({ client: fake.client });
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await input.fill("Show me immediately");
		await screen.getByRole("button", { name: "Send" }).click();

		await expect
			.element(screen.getByTestId("last-user-text"))
			.toHaveTextContent("Show me immediately");
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("1");
		expect(fake.create).toHaveBeenCalledOnce();
		expect(fake.promptAsync).not.toHaveBeenCalled();
		await expect.element(screen.getByTestId("remote-session-id")).toHaveTextContent("none");

		creation.resolve({ data: { id: "session-1" } });
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("remote-session-id")).toHaveTextContent("session-1");
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("1");
		await expect
			.element(screen.getByTestId("last-user-text"))
			.toHaveTextContent("Show me immediately");
	});

	it("does not show a provisional thread's optimistic message in another thread", async () => {
		const creation = deferred<SessionCreateResult>();
		const fake = createFakeClient(() => creation.promise);
		fake.list.mockResolvedValue({
			data: [
				{
					id: "existing-session",
					title: "Existing session",
					directory: "/workspace",
					time: { created: Date.now(), updated: Date.now() },
				},
			],
		});
		let runtime: ReturnType<typeof useOpenCodeRuntime> | undefined;
		const { baseElement } = renderRuntime({
			client: fake.client,
			onRuntime: (value) => {
				runtime = value;
			},
		});
		const screen = page.elementLocator(baseElement);

		await waitFor(() => expect(runtime).toBeDefined());
		await runtime!.threads.getLoadThreadsPromise();
		expect(runtime!.threads.getState().threadIds).toContain("existing-session");

		await screen.getByRole("textbox", { name: "Message" }).fill("Only in the draft thread");
		await screen.getByRole("button", { name: "Send" }).click();
		await expect
			.element(screen.getByTestId("last-user-text"))
			.toHaveTextContent("Only in the draft thread");

		await runtime!.threads.switchToThread("existing-session");

		await expect
			.element(screen.getByTestId("remote-session-id"))
			.toHaveTextContent("existing-session");
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("0");
		await expect.element(screen.getByTestId("last-user-text")).toBeEmptyDOMElement();
	});

	it("keeps attachments on the optimistic user bubble before session creation resolves", async () => {
		const creation = deferred<SessionCreateResult>();
		const fake = createFakeClient(() => creation.promise);
		const { baseElement } = renderRuntime({ client: fake.client });
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("textbox", { name: "Message" }).fill("With a file");
		await screen.getByRole("button", { name: "Add attachment" }).click();
		await expect.element(screen.getByTestId("attachment-count")).toHaveTextContent("1");
		await screen.getByRole("button", { name: "Send" }).click();

		await expect.element(screen.getByTestId("last-user-text")).toHaveTextContent("With a file");
		await expect.element(screen.getByTestId("last-user-attachment-count")).toHaveTextContent("1");
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("1");
		expect(fake.promptAsync).not.toHaveBeenCalled();

		creation.resolve({ data: { id: "session-1" } });
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("last-user-attachment-count")).toHaveTextContent("1");
		expect(fake.promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "session-1",
				parts: expect.arrayContaining([
					{ type: "text", text: "With a file" },
					expect.objectContaining({
						type: "file",
						filename: "notes.txt",
						mime: "text/plain",
						url: expect.stringMatching(/^data:text\/plain;base64,/),
					}),
				]),
			}),
			expect.objectContaining({ throwOnError: true }),
		);
	});

	it("keeps the optimistic bubble across session-id remount before prompt", async () => {
		const creation = deferred<SessionCreateResult>();
		const fake = createFakeClient(() => creation.promise);
		const { baseElement } = renderRuntime({ client: fake.client });
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("textbox", { name: "Message" }).fill("Stay visible");
		await screen.getByRole("button", { name: "Send" }).click();

		await expect.element(screen.getByTestId("last-user-text")).toHaveTextContent("Stay visible");
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("1");

		creation.resolve({ data: { id: "session-1" } });
		// After remote id assignment the runtime hook remounts; the bubble must
		// not disappear before promptAsync lands.
		await expect.element(screen.getByTestId("last-user-text")).toHaveTextContent("Stay visible");
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("user-message-count")).toHaveTextContent("1");
		await expect.element(screen.getByTestId("last-user-text")).toHaveTextContent("Stay visible");
	});

	it("reuses one initialization for rapid provisional appends", async () => {
		const creation = deferred<SessionCreateResult>();
		const fake = createFakeClient(() => creation.promise);
		let runtime: ReturnType<typeof useOpenCodeRuntime> | undefined;
		renderRuntime({
			client: fake.client,
			onRuntime: (value) => {
				runtime = value;
			},
		});

		await waitFor(() => expect(runtime).toBeDefined());
		runtime!.thread.append("First message");
		runtime!.thread.append("Second message");

		await waitFor(() => expect(fake.create).toHaveBeenCalledOnce());
		creation.resolve({ data: { id: "session-1" } });
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(2));
	});

	it("preserves the draft and uses the latest client before first send", async () => {
		const firstWorkspace = createFakeClient();
		const secondWorkspace = createFakeClient();
		const rendered = renderRuntime({ client: firstWorkspace.client });
		const screen = page.elementLocator(rendered.baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await input.fill("Keep this while switching");
		rendered.rerender(<RuntimeHarness client={secondWorkspace.client} />);

		await expect.element(input).toHaveValue("Keep this while switching");
		await screen.getByRole("button", { name: "Send" }).click();

		await waitFor(() => expect(secondWorkspace.create).toHaveBeenCalledOnce());
		await waitFor(() => expect(secondWorkspace.promptAsync).toHaveBeenCalledOnce());
		expect(firstWorkspace.create).not.toHaveBeenCalled();
		expect(firstWorkspace.promptAsync).not.toHaveBeenCalled();
	});

	it("restores the draft after initialization fails and permits a retry", async () => {
		const creationError = new Error("Session creation failed");
		const fake = createFakeClient(
			vi
				.fn<() => Promise<SessionCreateResult>>()
				.mockRejectedValueOnce(creationError)
				.mockResolvedValueOnce({ data: { id: "session-1" } }),
		);
		const onError = vi.fn();
		const { baseElement } = renderRuntime({ client: fake.client, onError });
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await input.fill("Keep this draft");
		await screen.getByRole("button", { name: "Add attachment" }).click();
		await expect.element(screen.getByTestId("attachment-count")).toHaveTextContent("1");

		const suppressCreationFailure = (event: PromiseRejectionEvent) => {
			if (event.reason === creationError) {
				event.preventDefault();
			}
		};
		window.addEventListener("unhandledrejection", suppressCreationFailure);
		try {
			await screen.getByRole("button", { name: "Send" }).click();
			await waitFor(() => expect(onError).toHaveBeenCalledWith(creationError));
		} finally {
			window.removeEventListener("unhandledrejection", suppressCreationFailure);
		}

		expect(onError).toHaveBeenCalledOnce();
		await expect.element(input).toHaveValue("Keep this draft");
		await expect.element(screen.getByTestId("attachment-count")).toHaveTextContent("1");
		await screen.getByRole("button", { name: "Send" }).click();

		await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
	});

	it("sends a retry after a failed first send when the message queue is enabled", async () => {
		const creationError = new Error("Session creation failed");
		const fake = createFakeClient(
			vi
				.fn<() => Promise<SessionCreateResult>>()
				.mockRejectedValueOnce(creationError)
				.mockResolvedValueOnce({ data: { id: "session-1" } }),
		);
		const onError = vi.fn();
		const { baseElement } = renderRuntime({ client: fake.client, onError, withMessageQueue: true });
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await input.fill("Keep this draft");

		const suppressCreationFailure = (event: PromiseRejectionEvent) => {
			if (event.reason === creationError) {
				event.preventDefault();
			}
		};
		window.addEventListener("unhandledrejection", suppressCreationFailure);
		try {
			await screen.getByRole("button", { name: "Send" }).click();
			await waitFor(() => expect(onError).toHaveBeenCalledWith(creationError));
		} finally {
			window.removeEventListener("unhandledrejection", suppressCreationFailure);
		}

		await expect.element(input).toHaveValue("Keep this draft");
		await screen.getByRole("button", { name: "Send" }).click();

		await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("queued-count")).toHaveTextContent("0");
	});

	it("restores the draft when the first prompt fails after session creation", async () => {
		const promptError = new Error("Local model unavailable");
		const fake = createFakeClient();
		fake.promptAsync.mockRejectedValueOnce(promptError);
		const onError = vi.fn();
		const { baseElement } = renderRuntime({ client: fake.client, onError });
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message" });

		await input.fill("Prompt a local model");

		const suppressPromptFailure = (event: PromiseRejectionEvent) => {
			if (event.reason === promptError) {
				event.preventDefault();
			}
		};
		window.addEventListener("unhandledrejection", suppressPromptFailure);
		try {
			await screen.getByRole("button", { name: "Send" }).click();
			await waitFor(() => expect(fake.create).toHaveBeenCalledOnce());
			await waitFor(() => expect(onError).toHaveBeenCalledWith(promptError));
		} finally {
			window.removeEventListener("unhandledrejection", suppressPromptFailure);
		}

		await expect.element(input).toHaveValue("Prompt a local model");
		expect(fake.promptAsync).toHaveBeenCalledOnce();
	});

	it("exposes message queue controls only once user controls are switched on", async () => {
		const fake = createFakeClient();
		const props = {
			client: fake.client,
			initialSessionId: "existing-session",
			withMessageQueue: true,
		};
		const rendered = renderRuntime(props);
		const screen = page.elementLocator(rendered.baseElement);

		await expect
			.element(screen.getByTestId("opencode-session-id"))
			.toHaveTextContent("existing-session");
		await expect.element(screen.getByTestId("queue-controls")).toHaveTextContent("none");

		rendered.rerender(<RuntimeHarness {...props} queueUserControls />);

		await expect.element(screen.getByTestId("queue-controls")).toHaveTextContent("available");
	});

	it("exposes message queue controls without breaking OpenCode extras", async () => {
		const fake = createFakeClient();
		const { baseElement } = renderRuntime({
			client: fake.client,
			initialSessionId: "existing-session",
			withMessageQueue: true,
			queueUserControls: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("remote-session-id"))
			.toHaveTextContent("existing-session");
		await expect.element(screen.getByTestId("queue-controls")).toHaveTextContent("available");
		await expect
			.element(screen.getByTestId("opencode-session-id"))
			.toHaveTextContent("existing-session");
	});

	it("uses an existing session without creating another one", async () => {
		const fake = createFakeClient();
		const { baseElement } = renderRuntime({
			client: fake.client,
			initialSessionId: "existing-session",
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("remote-session-id"))
			.toHaveTextContent("existing-session");
		await screen.getByRole("textbox", { name: "Message" }).fill("Continue the chat");
		await screen.getByRole("button", { name: "Send" }).click();

		await waitFor(() => expect(fake.promptAsync).toHaveBeenCalledOnce());
		expect(fake.create).not.toHaveBeenCalled();
		expect(fake.promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({ sessionID: "existing-session" }),
			expect.objectContaining({ throwOnError: true }),
		);
	});
});
