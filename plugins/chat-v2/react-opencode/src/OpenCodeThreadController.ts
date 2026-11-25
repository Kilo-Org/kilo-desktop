import type { AppendMessage, ThreadUserMessagePart } from "@assistant-ui/react";
import type {
	FormAnswer,
	FormInfo,
	OpenCodeEvent,
	PermissionRequest as KiloPermissionRequest,
	SessionMessageInfo,
} from "@kilocode/client";
import { newMessageId, readHistory, type KiloClient } from "./kilo";
import { streamedAssistantId } from "./kiloTranscript";
import { createOpenCodeThreadState, reduceOpenCodeThreadState } from "./openCodeThreadState";
import type {
	OpenCodePermissionRequest,
	OpenCodePermissionResponse,
	OpenCodeQuestionRequest,
	OpenCodeServerEvent,
	OpenCodeStateEvent,
	OpenCodeThreadControllerLike,
	OpenCodeThreadState,
	OpenCodeUnhandledEvent,
	OpenCodeUserMessageOptions,
	PendingUserMessage,
} from "./types";
import { STREAM_RECONNECTED_EVENT_TYPE, type OpenCodeEventSource } from "./OpenCodeEventSource";
import {
	resolveFileMediaType,
	resolveImageMediaType,
	toMediaWireUrl,
} from "@assistant-ui/core/internal";
import { serializeOpenCodeParts } from "./serializeUserParts";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";

type OpenCodeEventSourceProvider = () => Pick<OpenCodeEventSource, "subscribe">;

export type OpenCodeThreadControllerOptions = {
	/** Adjusts a loaded history before the thread shows it (`OpenCodeRuntimeBackend.patchHistory`). */
	patchHistory?:
		| ((
				sessionId: string,
				messages: readonly SessionMessageInfo[],
		  ) => readonly SessionMessageInfo[])
		| undefined;
};

type ChildControllerEntry = {
	controller: OpenCodeThreadController;
	unsubscribe: (() => void) | null;
};

const createLocalId = (prefix: string) =>
	`${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const getTextContent = (parts: readonly ThreadUserMessagePart[]) =>
	serializeOpenCodeParts(parts).trim();

// The attachment carries a name and content type its parts do not, so they
// ride along rather than being dropped at the flatten. Both the outbound
// prompt and the pending copy read this, so their fingerprints agree.
const flattenMessageParts = (message: AppendMessage) => [
	...message.content,
	...(message.attachments?.flatMap((attachment) =>
		(attachment.content ?? []).map((part) => ({
			...part,
			...(attachment.name != null && {
				filename: ("filename" in part ? part.filename : undefined) ?? attachment.name,
			}),
			...(attachment.contentType != null && {
				contentType: attachment.contentType,
			}),
		})),
	) ?? []),
];

/**
 * The message as Kilo v2's prompt: its text, and its images and files as
 * file references (data URLs for inline content).
 */
const getPromptInput = (message: AppendMessage) => {
	const text: string[] = [];
	const files: { uri: string; name?: string }[] = [];
	for (const part of flattenMessageParts(message)) {
		if (part.type === "text") {
			text.push(part.text);
			continue;
		}

		if (part.type === "image") {
			const mime = resolveImageMediaType(
				part.image,
				(part as { contentType?: string }).contentType,
			);
			files.push({
				uri: toMediaWireUrl(part.image, mime),
				...(part.filename != null && { name: part.filename }),
			});
			continue;
		}

		if (part.type === "file") {
			const fileMime = resolveFileMediaType(part.data, part.mimeType);
			files.push({
				// An `id` reference is an opaque handle this adapter cannot send, left
				// unwrapped so it fails loudly rather than shipping a corrupt payload.
				uri: part.sourceType === "id" ? part.data : toMediaWireUrl(part.data, fileMime),
				...(part.filename != null && { name: part.filename }),
			});
		}
	}

	return { text: text.join("\n"), files };
};

const toPermissionRequest = (request: KiloPermissionRequest): OpenCodePermissionRequest | null =>
	typeof request.id === "string" && typeof request.sessionID === "string"
		? { ...request, askedAt: Date.now() }
		: null;

const toQuestionRequest = (form: FormInfo | undefined): OpenCodeQuestionRequest | null =>
	typeof form?.id === "string" && typeof form.sessionID === "string"
		? { ...form, askedAt: Date.now() }
		: null;

const record = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const PERMISSION_REPLIES: ReadonlySet<unknown> = new Set(["once", "always", "reject"]);

const normalizeUnhandledEvent = (event: OpenCodeServerEvent): OpenCodeUnhandledEvent => ({
	type: event.type,
	sessionId: event.sessionId,
	properties: event.properties as Record<string, unknown>,
	seenAt: Date.now(),
});

const STATUS_EVENT_TYPES: ReadonlySet<OpenCodeStateEvent["type"]> = new Set([
	"session.status",
	"session.idle",
	"run.started",
	"run.cancelling",
	"run.reverting",
]);

const setsStatus = (event: OpenCodeStateEvent) =>
	STATUS_EVENT_TYPES.has(event.type) ||
	(event.type === "kilo.event" && /^session\.(execution\.|retry\.|idle$)/.test(event.event.type));

/** Events that change which child sessions a message's subagent calls run in. */
const CHILD_SESSION_EVENTS: ReadonlySet<string> = new Set([
	"session.tool.called",
	"session.tool.progress",
	"session.tool.success",
	"session.tool.failed",
]);

/** Each subagent call's child session in a message, keyed by message and call id. */
const childSessionsOf = (message: SessionMessageInfo | undefined): [string, string][] => {
	if (message?.type !== "assistant") return [];
	return message.content.flatMap((item) => {
		const sessionId = getOpenCodeTaskSessionId(item);
		return sessionId && item.type === "tool" ? [[`${message.id}:${item.id}`, sessionId]] : [];
	});
};

const isThreadRunning = (state: OpenCodeThreadState): boolean =>
	state.runState.type === "streaming" ||
	state.runState.type === "cancelling" ||
	state.runState.type === "reverting" ||
	state.sessionStatus?.type === "busy" ||
	state.sessionStatus?.type === "retry";

export class OpenCodeThreadController implements OpenCodeThreadControllerLike {
	private state: OpenCodeThreadState;
	private readonly listeners = new Set<() => void>();
	private readonly getEventSource: OpenCodeEventSourceProvider;
	private unsubscribeFromEvents: (() => void) | null = null;
	/*
	 * While no one listens, the controller only watches whether the stream
	 * brought anything for its session (or reconnected). A listener returning
	 * then refreshes the history only if it did: a thread shown again after
	 * being hidden (a kept work session, a tab switched back) doesn't fetch and
	 * rebuild its whole history when nothing changed.
	 */
	private stopStaleWatch: (() => void) | null = null;
	private stale = false;
	// Set by `dispose` until a listener returns: a disposed thread whose run
	// ends lets go of the event source entirely, as no one can read `stale`.
	private disposed = false;
	/*
	 * A running thread keeps applying its session's events after its last
	 * listener leaves (and after `dispose`), and only lets go once its run ends.
	 * A streamed part's text exists only as deltas until the part ends, so a
	 * thread that dropped them could not get them back from a history refresh;
	 * one shown again mid-run instead shows exactly what was streamed.
	 */
	private loadPromise: Promise<void> | null = null;
	/*
	 * A history loads whole: Kilo v2's markers early in a session (agent and
	 * model switches) set what the messages after them carry.
	 */
	private reconnectSyncToken = 0;
	// Bumped by every event that sets run/session status, so a status fetch
	// that resolves after a newer live event cannot overwrite it.
	private statusEpoch = 0;
	private readonly childControllersById = new Map<string, ChildControllerEntry>();
	/** Child session ids by `messageId:callId` of the subagent call running them. */
	private readonly childSessionIdByCallKey = new Map<string, string>();
	private ancestorSessionIds: ReadonlySet<string>;
	private isChildSession = false;
	private readonly stagedMessages = new Map<
		string,
		{
			message: AppendMessage;
			options: OpenCodeUserMessageOptions | undefined;
			pending: PendingUserMessage;
		}
	>();

	private readonly client: KiloClient;
	private readonly sessionId: string;
	private readonly options: OpenCodeThreadControllerOptions;

	constructor(
		client: KiloClient,
		getEventSource: OpenCodeEventSourceProvider,
		sessionId: string,
		options: OpenCodeThreadControllerOptions = {},
	) {
		this.client = client;
		this.sessionId = sessionId;
		this.options = options;
		this.state = createOpenCodeThreadState(sessionId);
		this.getEventSource = getEventSource;
		this.ancestorSessionIds = new Set([sessionId]);
	}

	private notifyListeners() {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("[react-opencode] Listener threw an error", error);
			}
		}
	}

	private updateChildSnapshot(sessionId: string, childState: OpenCodeThreadState) {
		if (this.state.childSessionsById[sessionId] === childState) return;

		this.state = {
			...this.state,
			childSessionsById: {
				...this.state.childSessionsById,
				[sessionId]: childState,
			},
		};
		this.notifyListeners();
	}

	private attachChildController(sessionId: string, entry: ChildControllerEntry) {
		if (entry.unsubscribe) return;

		entry.unsubscribe = entry.controller.subscribe(() => {
			this.updateChildSnapshot(sessionId, entry.controller.getState());
		});
		this.updateChildSnapshot(sessionId, entry.controller.getState());
		if (entry.controller.getState().loadState.type !== "ready") {
			void entry.controller.load().catch(() => undefined);
		}
	}

	private detachChildControllers() {
		for (const entry of this.childControllersById.values()) {
			entry.unsubscribe?.();
			entry.unsubscribe = null;
		}
	}

	private discard() {
		this.loadPromise = null;
		this.reconnectSyncToken += 1;
		this.statusEpoch += 1;
		this.unsubscribeFromEvents?.();
		this.unsubscribeFromEvents = null;
		this.stopWatchingForStaleness();
		for (const entry of this.childControllersById.values()) {
			entry.unsubscribe?.();
			entry.controller.discard();
		}
		this.childControllersById.clear();
		this.childSessionIdByCallKey.clear();
		this.listeners.clear();
	}

	private rebuildChildSessionIndex() {
		this.childSessionIdByCallKey.clear();
		for (const message of Object.values(this.state.messagesById)) {
			for (const [key, sessionId] of childSessionsOf(message)) {
				this.childSessionIdByCallKey.set(key, sessionId);
			}
		}
		this.syncChildControllers();
	}

	private updateChildSessionIndex(messageId: string) {
		const prefix = `${messageId}:`;
		const previous = [...this.childSessionIdByCallKey].filter(([key]) => key.startsWith(prefix));
		const next = childSessionsOf(this.state.messagesById[messageId]);
		if (
			previous.length === next.length &&
			previous.every(([key, id], index) => next[index]?.[0] === key && next[index]?.[1] === id)
		) {
			return;
		}
		for (const [key] of previous) this.childSessionIdByCallKey.delete(key);
		for (const [key, sessionId] of next) this.childSessionIdByCallKey.set(key, sessionId);
		this.syncChildControllers();
	}

	private syncChildControllers() {
		const sessionIds = new Set(this.childSessionIdByCallKey.values());
		for (const sessionId of this.ancestorSessionIds) {
			sessionIds.delete(sessionId);
		}

		let childSessionsById = this.state.childSessionsById;
		for (const [sessionId, entry] of this.childControllersById) {
			if (sessionIds.has(sessionId)) continue;

			entry.unsubscribe?.();
			entry.controller.discard();
			this.childControllersById.delete(sessionId);
			const { [sessionId]: _removed, ...remaining } = childSessionsById;
			childSessionsById = remaining;
		}

		const added: [string, ChildControllerEntry][] = [];
		for (const sessionId of sessionIds) {
			if (this.childControllersById.has(sessionId)) continue;

			const controller = new OpenCodeThreadController(
				this.client,
				this.getEventSource,
				sessionId,
				this.options,
			);
			controller.ancestorSessionIds = new Set([...this.ancestorSessionIds, sessionId]);
			controller.isChildSession = true;
			const entry: ChildControllerEntry = {
				controller,
				unsubscribe: null,
			};
			this.childControllersById.set(sessionId, entry);
			childSessionsById = {
				...childSessionsById,
				[sessionId]: controller.getState(),
			};
			added.push([sessionId, entry]);
		}

		if (childSessionsById !== this.state.childSessionsById) {
			this.state = { ...this.state, childSessionsById };
		}

		for (const [sessionId, entry] of added) {
			if (this.listeners.size === 0) break;
			this.attachChildController(sessionId, entry);
		}
	}

	private syncChildSessionIndex(event: OpenCodeStateEvent) {
		if (event.type === "history.loaded" || event.type === "history.prepended") {
			this.rebuildChildSessionIndex();
			return;
		}
		if (event.type !== "kilo.event") return;
		if (event.event.type === "session.revert.committed") {
			this.rebuildChildSessionIndex();
			return;
		}
		if (!CHILD_SESSION_EVENTS.has(event.event.type)) return;
		const messageId = streamedAssistantId(event.event);
		if (messageId) this.updateChildSessionIndex(messageId);
	}

	// `applied` is the event being handled when the watch starts: a source may
	// deliver it to a listener added during its delivery.
	private watchForStaleness(applied?: OpenCodeServerEvent) {
		if (this.stopStaleWatch) return;
		this.stopStaleWatch = this.getEventSource().subscribe((event) => {
			if (event === applied) return;
			if (event.type !== STREAM_RECONNECTED_EVENT_TYPE && event.sessionId !== this.sessionId) {
				return;
			}
			this.stale = true;
			this.stopWatchingForStaleness();
		});
	}

	private stopWatchingForStaleness() {
		this.stopStaleWatch?.();
		this.stopStaleWatch = null;
	}

	private ensureEventSubscription() {
		if (this.unsubscribeFromEvents) return;
		this.stopWatchingForStaleness();
		if (this.stale && this.state.loadState.type === "ready") {
			this.refreshInBackground();
		}
		this.stale = false;

		this.unsubscribeFromEvents = this.getEventSource().subscribe((event) => {
			if (event.type === STREAM_RECONNECTED_EVENT_TYPE) {
				this.handleStreamReconnect();
				return;
			}
			if (event.sessionId !== this.sessionId) return;
			this.handleServerEvent(event);
			this.detachFromEventsIfUnobserved(event);
		});
		// Status only arrives as live events; any missed while unsubscribed (never
		// opened, thread switched away, reload mid-run) must be fetched.
		this.syncSessionStatus();
	}

	private syncSessionStatus() {
		const epoch = this.statusEpoch;
		void Promise.resolve()
			.then(() => this.client.session.active())
			.catch(() => null)
			.then((active) => {
				if (!active || epoch !== this.statusEpoch) return;
				if (active[this.sessionId]) {
					this.dispatch({ type: "session.status", status: { type: "busy" } });
				} else {
					this.dispatch({ type: "session.idle", sessionId: this.sessionId });
				}
			});
	}

	private handleStreamReconnect() {
		this.refreshInBackground();
		const token = ++this.reconnectSyncToken;
		this.syncSessionStatus();

		if (this.isChildSession) return;

		void this.client.permission
			.list({ sessionID: this.sessionId })
			.catch(() => null)
			.then((requests) => {
				if (!requests || token !== this.reconnectSyncToken) return;
				for (const item of requests) {
					const request = toPermissionRequest(item);
					if (!request || request.sessionID !== this.sessionId) continue;
					if (request.id in this.state.interactions.permissions.pending) {
						continue;
					}
					this.dispatch({ type: "permission.asked", request });
				}
			});

		void this.client.session.form
			.list({ sessionID: this.sessionId })
			.catch(() => null)
			.then((forms) => {
				if (!forms || token !== this.reconnectSyncToken) return;
				for (const item of forms) {
					const request = toQuestionRequest(item);
					if (!request || request.sessionID !== this.sessionId) continue;
					if (request.id in this.state.interactions.questions.pending) {
						continue;
					}
					this.dispatch({ type: "question.asked", request });
				}
			});
	}

	public dispose() {
		this.disposed = true;
		this.listeners.clear();
		this.stopWatchingForStaleness();
		if (isThreadRunning(this.state)) return;
		this.unsubscribeFromEvents?.();
		this.unsubscribeFromEvents = null;
		this.detachChildControllers();
	}

	/** Still applying its session's events: listened to, or running without listeners. */
	public isAttachedToEvents() {
		return this.unsubscribeFromEvents !== null;
	}

	private detachFromEventsIfUnobserved(applied?: OpenCodeServerEvent) {
		if (this.listeners.size > 0) return;
		if (this.unsubscribeFromEvents && isThreadRunning(this.state)) return;
		this.unsubscribeFromEvents?.();
		this.unsubscribeFromEvents = null;
		this.detachChildControllers();
		if (!this.disposed) this.watchForStaleness(applied);
	}

	public getState = () => {
		return this.state;
	};

	public subscribe = (listener: () => void) => {
		const wasDetached = this.listeners.size === 0;
		this.disposed = false;
		this.listeners.add(listener);
		this.ensureEventSubscription();
		if (wasDetached) {
			for (const [sessionId, entry] of this.childControllersById) {
				this.attachChildController(sessionId, entry);
			}
		}

		return () => {
			this.listeners.delete(listener);
			this.detachFromEventsIfUnobserved();
		};
	};

	public async load(force = false) {
		if (this.loadPromise && !force) return this.loadPromise;

		this.dispatch({ type: "history.loading" });

		const request = Promise.all([
			this.client.session.get({ sessionID: this.sessionId }),
			readHistory(this.client, this.sessionId),
		])
			.then(([info, history]) => {
				if (this.loadPromise !== request) return;
				this.dispatch({
					type: "history.loaded",
					session: info,
					messages: this.options.patchHistory?.(this.sessionId, history) ?? history,
					olderHistory: { type: "complete" },
				});
			})
			.catch((error) => {
				if (this.loadPromise !== request) throw error;
				this.dispatch({ type: "history.failed", error });
				throw error;
			})
			.finally(() => {
				if (this.loadPromise === request) {
					this.loadPromise = null;
				}
			});

		this.loadPromise = request;
		return request;
	}

	public refresh() {
		return this.load(true);
	}

	private createPendingMessage(message: AppendMessage): PendingUserMessage {
		const parts = flattenMessageParts(message) as readonly ThreadUserMessagePart[];

		return {
			clientId: createLocalId("local"),
			messageId: newMessageId(),
			sessionId: this.sessionId,
			createdAt: Date.now(),
			parentId: message.parentId,
			sourceId: message.sourceId,
			runConfig: message.runConfig,
			parts,
			contentText: getTextContent(parts),
			status: "pending",
		};
	}

	private async promptMessage(
		message: AppendMessage,
		pending: PendingUserMessage,
		options?: OpenCodeUserMessageOptions,
	) {
		// Subscribe before starting the run: a first-subscription status sync
		// issued after run.started could land before the server marks the
		// session busy and flip the fresh run back to idle. Issued first, its
		// epoch is superseded by run.started and the reply is discarded.
		this.ensureEventSubscription();
		this.dispatch({ type: "run.started" });

		try {
			// A v2 prompt carries no agent or model: the session is switched first.
			const sessionID = this.sessionId;
			if (options?.agent)
				await this.client.session.switchAgent({ sessionID, agent: options.agent });
			if (options?.model) {
				const { providerID, id, variant } = options.model;
				await this.client.session.switchModel({
					sessionID,
					model: { providerID, id, ...(variant ? { variant } : {}) },
				});
			}
			const { text, files } = getPromptInput(message);
			await this.client.session.prompt({
				sessionID,
				id: pending.messageId,
				text,
				...(files.length > 0 ? { files } : {}),
				...(options?.noReply ? { resume: false } : {}),
			});
		} catch (error) {
			this.dispatch({
				type: "local.message.failed",
				clientId: pending.clientId,
				error,
			});
			throw error;
		}
	}

	public async sendMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions) {
		if (message.role !== "user") {
			throw new Error("OpenCode only supports sending user messages");
		}

		const pending = this.createPendingMessage(message);
		this.dispatch({ type: "local.message.queued", pending });
		await this.promptMessage(message, pending, options);
	}

	public async stageMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions) {
		if (message.role !== "user") {
			throw new Error("OpenCode only supports sending user messages");
		}

		const pending = this.createPendingMessage(message);
		this.stagedMessages.set(`local:${pending.clientId}`, {
			message,
			options,
			pending,
		});
		this.dispatch({ type: "local.message.queued", pending });
	}

	public async sendStagedMessage(parentId: string, options?: OpenCodeUserMessageOptions) {
		const staged = this.stagedMessages.get(parentId);
		if (!staged) return false;

		if (this.state.pendingUserMessages[staged.pending.clientId]?.status === "failed") {
			this.dispatch({ type: "local.message.queued", pending: staged.pending });
		}

		await this.promptMessage(staged.message, staged.pending, options ?? staged.options);
		this.stagedMessages.delete(parentId);
		return true;
	}

	public async cancel() {
		this.dispatch({ type: "run.cancelling" });
		try {
			await this.client.session.interrupt({ sessionID: this.sessionId });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async revert(messageId: string) {
		this.dispatch({ type: "run.reverting" });
		try {
			await this.client.session.revert.stage({ sessionID: this.sessionId, messageID: messageId });
			// The session as it is now, with its revert, is the authoritative state:
			// the boundary lands at once rather than waiting for its event.
			const info = await this.client.session.get({ sessionID: this.sessionId });
			this.dispatch({ type: "session.updated", session: info });
			// Revert requires an already-idle session, so no session.idle SSE
			// follows the HTTP call — clear the reverting state here or the
			// runtime stays "running" forever.
			this.dispatch({ type: "session.idle", sessionId: this.sessionId });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async unrevert() {
		this.dispatch({ type: "run.reverting" });
		try {
			await this.client.session.revert.clear({ sessionID: this.sessionId });
			// Apply the session (its revert now cleared) before returning to idle.
			const info = await this.client.session.get({ sessionID: this.sessionId });
			this.dispatch({ type: "session.updated", session: info });
			this.dispatch({ type: "session.idle", sessionId: this.sessionId });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async fork(messageId: string) {
		const fork = await this.client.session.fork({ sessionID: this.sessionId, before: messageId });
		if (!fork?.id) {
			throw new Error("Failed to fork OpenCode session");
		}
		return fork.id;
	}

	public async replyToPermission(permissionId: string, response: OpenCodePermissionResponse) {
		await this.client.permission.reply({
			sessionID: this.sessionId,
			requestID: permissionId,
			decision: response,
		});

		this.dispatch({
			type: "permission.replied",
			permissionId,
			reply: response,
		});
	}

	public async replyToQuestion(questionId: string, answer: FormAnswer) {
		await this.client.session.form.reply({
			sessionID: this.sessionId,
			formID: questionId,
			answer: answer as Record<string, string | number | boolean | readonly string[]>,
		});

		this.dispatch({
			type: "question.replied",
			questionId,
			answer,
		});
	}

	public async rejectQuestion(questionId: string) {
		await this.client.session.form.cancel({ sessionID: this.sessionId, formID: questionId });

		this.dispatch({
			type: "question.rejected",
			questionId,
		});
	}

	private refreshInBackground() {
		void this.refresh().catch((error) => {
			this.dispatch({ type: "run.failed", error });
		});
	}

	private handleServerEvent(event: OpenCodeServerEvent) {
		switch (event.type) {
			case "permission.asked": {
				const request = toPermissionRequest(event.properties as KiloPermissionRequest);
				if (request) {
					this.dispatch({
						type: "permission.asked",
						request,
					});
				}
				return;
			}

			case "permission.replied":
				if (
					typeof event.properties.requestID === "string" &&
					PERMISSION_REPLIES.has(event.properties.reply)
				) {
					this.dispatch({
						type: "permission.replied",
						permissionId: event.properties.requestID,
						reply: event.properties.reply as OpenCodePermissionResponse,
					});
				}
				return;

			case "form.created": {
				const request = toQuestionRequest(event.properties.form as FormInfo | undefined);
				if (request) {
					this.dispatch({
						type: "question.asked",
						request,
					});
				}
				return;
			}

			case "form.replied":
				if (typeof event.properties.id === "string") {
					this.dispatch({
						type: "question.replied",
						questionId: event.properties.id,
						answer: record(event.properties.answer) as FormAnswer,
					});
				}
				return;

			case "form.cancelled":
				if (typeof event.properties.id === "string") {
					this.dispatch({
						type: "question.rejected",
						questionId: event.properties.id,
					});
				}
				return;
		}

		if (event.raw && this.applyKiloEvent(event.raw)) return;

		this.dispatch({
			type: "unhandled.event",
			event: normalizeUnhandledEvent(event),
		});
	}

	/** Folds a Kilo v2 event into the thread; false when it changes nothing. */
	private applyKiloEvent(event: OpenCodeEvent): boolean {
		// A step this thread never saw start (it joined mid-turn, or missed
		// events) streams into nothing: the history has it.
		const assistantId = streamedAssistantId(event);
		if (assistantId && !(assistantId in this.state.messagesById)) {
			if (this.state.loadState.type === "ready") this.refreshInBackground();
			return true;
		}
		const before = this.state;
		this.dispatch({ type: "kilo.event", event });
		return this.state !== before;
	}

	private dispatch(event: Parameters<typeof reduceOpenCodeThreadState>[1]) {
		if (setsStatus(event)) this.statusEpoch += 1;
		const nextState = reduceOpenCodeThreadState(this.state, event);
		if (nextState === this.state) return;
		this.state = nextState;
		this.syncChildSessionIndex(event);
		this.notifyListeners();
	}
}
