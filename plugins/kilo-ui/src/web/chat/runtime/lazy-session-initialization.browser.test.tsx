import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { KiloClient } from "@kilocode/sdk/v2/client";

type SessionCreateResult = { data: { id: string } };

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
		title: "New session",
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
			summarize: vi.fn(async () => ({ data: undefined })),
		},
		event: { subscribe: eventSubscribe },
	} as unknown as KiloClient;

	return { client, create, list, promptAsync };
}

function RuntimeState() {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const attachmentCount = useAuiState((state) => state.composer.attachments.length);
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
	return (
		<>
			<button
				type="button"
				onClick={() => {
					void aui.composer.addAttachment({
						id: "attachment-1",
						type: "document",
						name: "notes.txt",
						contentType: "text/plain",
						content: [{ type: "text", text: "Remember this attachment" }],
					});
				}}
			>
				Add attachment
			</button>
			<output data-qa-id="remote-session-id">{remoteId ?? "none"}</output>
			<output data-qa-id="attachment-count">{attachmentCount}</output>
			<output data-qa-id="message-count">{messageCount}</output>
			<output data-qa-id="user-message-count">{userMessageCount}</output>
			<output data-qa-id="last-user-text">{lastUserText}</output>
			<output data-qa-id="last-user-attachment-count">{lastUserAttachmentCount}</output>
		</>
	);
}

function RuntimeHarness({
	client,
	initialSessionId,
	onError,
	onRuntime,
}: {
	client: KiloClient;
	initialSessionId?: string;
	onError?: (error: unknown) => void;
	onRuntime?: (runtime: ReturnType<typeof useOpenCodeRuntime>) => void;
}) {
	const runtime = useOpenCodeRuntime({
		client,
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onError === undefined ? {} : { onError }),
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
					expect.objectContaining({ type: "text", text: "Remember this attachment" }),
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
