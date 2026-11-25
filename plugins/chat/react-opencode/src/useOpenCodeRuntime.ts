"use client";

import {
	ExportedMessageRepository,
	pickExternalStoreSharedOptions,
	useAui,
	useAuiState,
	useExternalStoreRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import type {
	AppendMessage,
	AssistantRuntime,
	ExternalStoreAdapter,
	ThreadMessage,
	ThreadMessageLike,
} from "@assistant-ui/react";
import { createKiloClient as createOpencodeClient } from "@kilocode/sdk/v2/client";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
	OpenCodeRuntimeBackend,
	OpenCodeRuntimeOptions,
	OpenCodeThreadControllerLike,
	OpenCodeThreadState,
	QuestionAnswer,
} from "./types";
import { OpenCodeEventSource } from "./OpenCodeEventSource";
import { toOpenCodePermissionResponse } from "./openCodePermissionApproval";
import { OpenCodeThreadController } from "./OpenCodeThreadController";
import {
	createOpenCodeProjectionCache,
	projectOpenCodeThreadRepository,
} from "./openCodeMessageProjection";
import { EMPTY_OPENCODE_THREAD_STATE } from "./openCodeThreadState";
import { openCodeExtras } from "./openCodeExtras";
import { createOpenCodeThreadListAdapter } from "./openCodeThreadListAdapter";
import { OPEN_CODE_REQUEST_OPTIONS } from "./openCodeRequestOptions";
import {
	createOpenCodeMessageQueue,
	type OpenCodeMessageQueueController,
	type OpenCodeMessageQueueControls,
} from "./openCodeMessageQueue";
import { useOpenCodeControllerState } from "./useOpenCodeControllerState";
import { useOpenCodeStreamingTiming } from "./useOpenCodeStreamingTiming";

type OpenCodeControllerRegistry = {
	getEventSource(): ReturnType<OpenCodeRuntimeBackend["createEventSource"]>;
	controllers: Map<string, OpenCodeThreadController>;
	queues: Map<string, OpenCodeMessageQueueController>;
	dispose(): void;
};

const createRegistry = (backend: OpenCodeRuntimeBackend): OpenCodeControllerRegistry => {
	let eventSource: ReturnType<OpenCodeRuntimeBackend["createEventSource"]> | null = null;
	const controllers = new Map<string, OpenCodeThreadController>();
	const queues = new Map<string, OpenCodeMessageQueueController>();

	const getEventSource = () => {
		eventSource ??= backend.createEventSource();
		return eventSource;
	};

	return {
		getEventSource,
		controllers,
		queues,
		dispose() {
			for (const controller of controllers.values()) {
				controller.dispose();
			}
			// Keep controllers cached across React StrictMode cleanup/remount.
			// Cleanup only detaches subscriptions; a real unmount drops this registry.
			// A running controller keeps applying its events until its run ends, so
			// the source it listens to stays open meanwhile.
			const inUse = [...controllers.values()].some((controller) => controller.isAttachedToEvents());
			if (inUse) return;
			eventSource?.dispose();
			eventSource = null;
		},
	};
};

const getQueue = (
	registry: OpenCodeControllerRegistry,
	threadId: string,
	options: NonNullable<OpenCodeRuntimeOptions["messageQueue"]>,
) => {
	const existing = registry.queues.get(threadId);
	if (existing) return existing;
	const queue = options.create ? options.create(threadId) : createOpenCodeMessageQueue(options);
	registry.queues.set(threadId, queue);
	return queue;
};

const subscribeToNothing = () => () => {};
const getZeroSnapshot = () => 0;

const messageQueueControls = (
	queue: OpenCodeMessageQueueController,
): OpenCodeMessageQueueControls => ({
	...queue.getControlsState(),
	pause: queue.pause,
	resume: queue.resume,
	reorder: queue.reorder,
	beginEdit: queue.beginEdit,
	setEditDraft: queue.setEditDraft,
	getEditDraft: queue.getEditDraft,
	commitEdit: queue.commitEdit,
	cancelEdit: queue.cancelEdit,
});

/**
 * The extras brand is a non-enumerable symbol, so spreading drops it; branded
 * extras are re-provided or `useOpenCodeRuntimeExtras` would stop resolving.
 */
const withMessageQueueExtras = (
	extras: unknown,
	messageQueue: OpenCodeMessageQueueControls,
): unknown => {
	if (openCodeExtras.is(extras)) {
		return openCodeExtras.provide({ ...extras, messageQueue });
	}
	return {
		...(typeof extras === "object" && extras !== null ? extras : {}),
		messageQueue,
	};
};

const getController = (
	registry: OpenCodeControllerRegistry,
	backend: OpenCodeRuntimeBackend,
	sessionId: string,
) => {
	const existing = registry.controllers.get(sessionId);
	if (existing) return existing;

	const controller = new OpenCodeThreadController(
		backend.getSessionClient({ id: sessionId }),
		registry.getEventSource,
		sessionId,
	);
	registry.controllers.set(sessionId, controller);
	return controller;
};

const NOOP_CONTROLLER: OpenCodeThreadControllerLike = {
	getState: () => EMPTY_OPENCODE_THREAD_STATE,
	subscribe: () => () => {},
	load: async () => {},
	refresh: async () => {},
	sendMessage: async () => {},
	stageMessage: async () => {},
	sendStagedMessage: async () => false,
	cancel: async () => {},
	revert: async () => {},
	unrevert: async () => {},
	fork: async () => "",
	replyToPermission: async () => {},
	replyToQuestion: async () => {},
	rejectQuestion: async () => {},
};

const isOpenCodeStateRunning = (state: OpenCodeThreadState): boolean =>
	state.runState.type === "streaming" ||
	state.runState.type === "cancelling" ||
	state.runState.type === "reverting" ||
	state.sessionStatus?.type === "busy" ||
	state.sessionStatus?.type === "retry";

const sendMessage = async (
	controller: OpenCodeThreadControllerLike,
	message: AppendMessage,
	options: OpenCodeRuntimeOptions,
) => {
	const sendOptions = {
		model: options.defaultModel,
		agent: options.defaultAgent,
	};
	if (!(message.startRun ?? message.role === "user")) {
		await controller.stageMessage(message, sendOptions);
		return;
	}
	await controller.sendMessage(message, sendOptions);
};

const toOptimisticThreadMessage = (message: AppendMessage, index: number): ThreadMessageLike => ({
	id: `opencode-new-user:${index}`,
	role: "user",
	createdAt: new Date(),
	content: [...message.content],
	// Keep attachments separate so UserMessageAttachments can render tiles
	// (flattening into content drops the attachments array).
	...(message.attachments != null && message.attachments.length > 0
		? { attachments: message.attachments }
		: {}),
});

const optimisticMessagesByRegistry = new WeakMap<
	OpenCodeControllerRegistry,
	Map<string, readonly ThreadMessageLike[]>
>();

const getOptimisticMessagesByThreadId = (registry: OpenCodeControllerRegistry) => {
	let messagesByThreadId = optimisticMessagesByRegistry.get(registry);
	if (!messagesByThreadId) {
		messagesByThreadId = new Map();
		optimisticMessagesByRegistry.set(registry, messagesByThreadId);
	}
	return messagesByThreadId;
};

const liveThreadHasUserMessage = (state: OpenCodeThreadState): boolean => {
	if (Object.keys(state.pendingUserMessages).length > 0) return true;
	return state.messageOrder.some(
		(messageId) => state.messagesById[messageId]?.info?.role === "user",
	);
};

const useOpenCodeThreadStore = (
	controller: OpenCodeThreadControllerLike,
	options: OpenCodeRuntimeOptions,
): ExternalStoreAdapter<ThreadMessage> => {
	const aui = useAui();
	const state = useOpenCodeControllerState(controller);
	const listStatus = useAuiState((s) => s.threadListItem.status);
	const sessionTitle = state.session?.title?.trim() ?? "";
	const onLoadError = useEffectEvent((error: unknown) => {
		options.onError?.(error);
	});

	// A loaded thread stays current through the event stream, so an effect
	// replay (a hidden Activity shown again, StrictMode) doesn't load the whole
	// history again; only a thread that hasn't loaded, or failed to, loads.
	useEffect(() => {
		if (controller === NOOP_CONTROLLER) return;
		const { loadState } = controller.getState();
		if (loadState.type === "ready" || loadState.type === "loading") return;
		void controller.load().catch(onLoadError);
	}, [controller]);

	// Lazy session init marks the thread "regular" before RemoteThreadList's
	// runEnd→generateTitle listener is registered, so auto-titles never reach
	// the sidebar. Mirror OpenCode session.title (including its default
	// "New session - <timestamp>") into the thread list item whenever it
	// changes; the adapter skips the server write for these echoes. The list
	// title is read imperatively so an in-flight user rename is not reverted.
	useEffect(() => {
		if (listStatus === "new" || !sessionTitle) return;
		if (aui.threadListItem.getState().title === sessionTitle) return;
		void aui.threadListItem.rename(sessionTitle);
	}, [aui, listStatus, sessionTitle]);

	const isRunning = isOpenCodeStateRunning(state);

	const messageTiming = useOpenCodeStreamingTiming(state, isRunning);

	const projectionCache = useMemo(() => createOpenCodeProjectionCache(), [controller]);
	const messageRepository = useMemo(
		() => projectOpenCodeThreadRepository(state, messageTiming, projectionCache),
		[state, messageTiming, projectionCache],
	);

	const extras = useMemo(
		() =>
			openCodeExtras.provide({
				session: state.session,
				state,
				permissions: state.interactions.permissions.pending,
				questions: state.interactions.questions.pending,
				fork: (messageId: string) => controller.fork(messageId),
				revert: (messageId: string) => controller.revert(messageId),
				unrevert: () => controller.unrevert(),
				cancel: () => controller.cancel(),
				refresh: () => controller.refresh(),
				replyToPermission: (permissionId: string, response: "once" | "always" | "reject") =>
					controller.replyToPermission(permissionId, response),
				replyToQuestion: (questionId: string, answers: readonly QuestionAnswer[]) =>
					controller.replyToQuestion(questionId, answers),
				rejectQuestion: (questionId: string) => controller.rejectQuestion(questionId),
			}),
		[controller, state],
	);

	return useMemo<ExternalStoreAdapter<ThreadMessage>>(
		() => ({
			...pickExternalStoreSharedOptions(options),
			isLoading: state.loadState.type === "loading",
			isRunning,
			messageRepository,
			extras,
			...(options.adapters && { adapters: options.adapters }),
			onNew: async (message: AppendMessage) => {
				try {
					await sendMessage(controller, message, options);
				} catch (error) {
					options.onError?.(error);
					throw error;
				}
			},
			onCancel: async () => {
				try {
					await controller.cancel();
				} catch (error) {
					options.onError?.(error);
					throw error;
				}
			},
			onRespondToToolApproval: async (response) => {
				try {
					await controller.replyToPermission(
						response.approvalId,
						toOpenCodePermissionResponse(response),
					);
				} catch (error) {
					options.onError?.(error);
					throw error;
				}
			},
			onReload: async (parentId: string | null) => {
				if (!parentId) return;
				try {
					const sentStagedMessage = await controller.sendStagedMessage(parentId, {
						model: options.defaultModel,
						agent: options.defaultAgent,
					});
					if (sentStagedMessage) return;

					await controller.revert(parentId);
				} catch (error) {
					options.onError?.(error);
					throw error;
				}
			},
		}),
		[controller, extras, isRunning, messageRepository, options, state],
	);
};

const useRuntimeHook = (
	backend: OpenCodeRuntimeBackend,
	registry: OpenCodeControllerRegistry,
	options: OpenCodeRuntimeOptions,
) => {
	const aui = useAui();
	const sessionId = useAuiState(
		(state) => state.threadListItem.externalId ?? state.threadListItem.remoteId,
	);
	const localThreadId = useAuiState((state) => state.threadListItem.id);
	const threadStatus = useAuiState((state) => state.threadListItem.status);
	const initializationRef = useRef<Promise<OpenCodeThreadControllerLike> | undefined>(undefined);
	const scheduledRestorationsRef = useRef(new WeakSet<AppendMessage>());
	const optimisticIdRef = useRef(0);
	const optimisticMessagesByThreadId = getOptimisticMessagesByThreadId(registry);
	// Retain this thread's optimistic messages across initialize() remounts.
	const [optimisticMessages, setOptimisticMessagesState] = useState<readonly ThreadMessageLike[]>(
		() => optimisticMessagesByThreadId.get(localThreadId) ?? [],
	);
	const setOptimisticMessages = (
		updater:
			| readonly ThreadMessageLike[]
			| ((previous: readonly ThreadMessageLike[]) => readonly ThreadMessageLike[]),
	) => {
		setOptimisticMessagesState((previous) => {
			const next = typeof updater === "function" ? updater(previous) : updater;
			if (next.length === 0) {
				optimisticMessagesByThreadId.delete(localThreadId);
			} else {
				optimisticMessagesByThreadId.set(localThreadId, next);
			}
			return next;
		});
	};

	const initializeController = () => {
		initializationRef.current ??= aui.threadListItem
			.initialize()
			.then(({ externalId, remoteId }) => getController(registry, backend, externalId ?? remoteId))
			.catch((error: unknown) => {
				initializationRef.current = undefined;
				throw error;
			});
		return initializationRef.current;
	};

	const restoreMessage = async (message: AppendMessage) => {
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
		const currentText = aui.composer.getState().text;
		if (text && currentText !== text && !currentText.startsWith(`${text}\n`)) {
			aui.composer.setText(currentText.length > 0 ? `${text}\n${currentText}` : text);
		}
		const attachmentIds = new Set(aui.composer.getState().attachments.map(({ id }) => id));
		for (const attachment of message.attachments ?? []) {
			if (!attachmentIds.has(attachment.id)) {
				// Restored one at a time so the composer keeps the message's order.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await aui.composer.addAttachment(attachment as never);
			}
		}
	};

	const controller = sessionId ? getController(registry, backend, sessionId) : NOOP_CONTROLLER;

	const liveState = useOpenCodeControllerState(controller);
	const liveHasUserMessage = liveThreadHasUserMessage(liveState);
	const threadStore = useOpenCodeThreadStore(controller, options);

	const optimisticRepository = useMemo(
		() => ExportedMessageRepository.fromArray(optimisticMessages),
		[optimisticMessages],
	);

	useEffect(() => {
		if (!liveHasUserMessage || optimisticMessages.length === 0) return;
		setOptimisticMessages([]);
	}, [liveHasUserMessage, optimisticMessages.length]);

	const newThreadStore = useMemo<ExternalStoreAdapter<ThreadMessage>>(
		() => ({
			...pickExternalStoreSharedOptions(options),
			isDisabled: false,
			isSendDisabled: options.isSendDisabled || threadStatus !== "new",
			isLoading: false,
			isRunning: false,
			messageRepository: optimisticRepository,
			...(options.adapters && { adapters: options.adapters }),
			onNew: async (message: AppendMessage) => {
				const optimistic = toOptimisticThreadMessage(message, optimisticIdRef.current++);
				setOptimisticMessages((messages) => [...messages, optimistic]);
				let initialized = false;
				try {
					const initializedController = await initializeController();
					await sendMessage(initializedController, message, options);
					initialized = true;
					// Optimistics clear once the live controller projects the user
					// message — clearing earlier blanks the thread across remount.
				} catch (error) {
					setOptimisticMessages((messages) => messages.filter((entry) => entry !== optimistic));
					if (!initialized && !scheduledRestorationsRef.current.has(message)) {
						scheduledRestorationsRef.current.add(message);
						setTimeout(() => {
							void restoreMessage(message).catch((restoreError: unknown) => {
								options.onError?.(restoreError);
							});
						}, 0);
					}
					options.onError?.(error);
					throw error;
				}
			},
		}),
		[optimisticRepository, options, threadStatus],
	);

	const selectedStore = !sessionId || optimisticMessages.length > 0 ? newThreadStore : threadStore;
	const queue = options.messageQueue
		? getQueue(registry, localThreadId, options.messageQueue)
		: undefined;
	const queueVersion = useSyncExternalStore(
		queue?.subscribe ?? subscribeToNothing,
		queue?.getSnapshot ?? getZeroSnapshot,
		queue?.getSnapshot ?? getZeroSnapshot,
	);

	queue?.setDriver({
		send: async (message) => {
			try {
				await selectedStore.onNew(message);
				return undefined;
			} catch (error) {
				// A draft send that failed before the session existed is restored to
				// the composer; the composer then owns the retry, not the queue.
				if (scheduledRestorationsRef.current.has(message)) {
					return "returned-to-composer" as const;
				}
				throw error;
			}
		},
		cancel: async () => {
			await selectedStore.onCancel?.();
		},
	});

	const cancelBehavior = options.messageQueue?.cancelBehavior;
	const userControls = options.messageQueue?.userControls ?? false;
	// Queues outlive renders, so a flipped option is applied to the live queue.
	useEffect(() => {
		if (cancelBehavior) queue?.setOptions({ cancelBehavior, userControls });
	}, [cancelBehavior, queue, userControls]);

	useEffect(() => {
		queue?.setRunning(selectedStore.isRunning ?? false, liveState.sync);
	}, [liveState.sync, queue, selectedStore.isRunning]);

	const storeWithQueue = useMemo<ExternalStoreAdapter<ThreadMessage>>(() => {
		if (!queue) return selectedStore;
		if (!userControls) return { ...selectedStore, queue: queue.adapter };
		return {
			...selectedStore,
			queue: queue.adapter,
			extras: withMessageQueueExtras(selectedStore.extras, messageQueueControls(queue)),
		};
	}, [queue, queueVersion, selectedStore, userControls]);

	// One runtime whose store CONTENT switches. Alternating runtime instances
	// remount the thread and break remote-thread-list main binding (see react-pi).
	// Stay on the optimistic store until the live controller has the user message.
	return useExternalStoreRuntime<ThreadMessage>(storeWithQueue);
};

export const useOpenCodeRuntime = (options: OpenCodeRuntimeOptions = {}): AssistantRuntime => {
	const baseUrl = options.baseUrl ?? "http://localhost:4096";
	const client = useMemo(
		() => options.backend?.globalClient ?? options.client ?? createOpencodeClient({ baseUrl }),
		[baseUrl, options.backend, options.client],
	);
	const backend = useMemo<OpenCodeRuntimeBackend>(
		() =>
			options.backend ?? {
				globalClient: client,
				getSessionClient: () => client,
				initializeSession: async () => {
					const response = await client.session.create({}, OPEN_CODE_REQUEST_OPTIONS);
					if (!response.data?.id) {
						throw new Error("Failed to create OpenCode session");
					}
					return {
						id: response.data.id,
						directory: response.data.directory,
					};
				},
				createEventSource: () => new OpenCodeEventSource(client),
			},
		[client, options.backend],
	);
	const registry = useMemo(() => createRegistry(backend), [backend]);

	useEffect(() => {
		return () => {
			registry.dispose();
		};
	}, [registry]);

	const adapter = useMemo(
		() =>
			createOpenCodeThreadListAdapter(
				backend,
				(sessionId) => registry.controllers.get(sessionId)?.getState().session?.title,
			),
		[backend, registry],
	);

	return useRemoteThreadListRuntime({
		allowNesting: true,
		adapter,
		initialThreadId: options.initialSessionId,
		onThreadIdChange: options.onThreadIdChange,
		// oxlint-disable-next-line react-hooks/rules-of-hooks -- runtimeHook callback is invoked by useRemoteThreadListRuntime at the appropriate hook position
		runtimeHook: () => useRuntimeHook(backend, registry, options),
	});
};
