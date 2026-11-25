import type { AppendMessage, ThreadUserMessagePart } from "@assistant-ui/react";
import type {
	KiloClient as OpencodeClient,
	PermissionRequest,
	QuestionRequest,
	SessionStatus,
} from "@kilocode/sdk/v2/client";
import { createOpenCodeThreadState, reduceOpenCodeThreadState } from "./openCodeThreadState";
import type {
	MessageWithParts,
	OpenCodePermissionRequest,
	OpenCodePermissionResponse,
	OpenCodeQuestionRequest,
	Part,
	QuestionAnswer,
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
import { OPEN_CODE_REQUEST_OPTIONS } from "./openCodeRequestOptions";
import { serializeOpenCodeParts } from "./serializeUserParts";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";

type OpenCodeEventSourceProvider = () => Pick<OpenCodeEventSource, "subscribe">;

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
				filename: (part as { filename?: string }).filename ?? attachment.name,
			}),
			...(attachment.contentType != null && {
				contentType: attachment.contentType,
			}),
		})),
	) ?? []),
];

const getPromptParts = (message: AppendMessage) => {
	const content = flattenMessageParts(message);

	const promptParts: Array<Record<string, unknown>> = [];
	for (const part of content) {
		if (part.type === "text") {
			promptParts.push({ type: "text", text: part.text });
			continue;
		}

		if (part.type === "image") {
			// OpenCode has no image part: its input union is text, file, agent and
			// subtask, so an `image` part never reached the model.
			const mime = resolveImageMediaType(
				part.image,
				(part as { contentType?: string }).contentType,
			);
			promptParts.push({
				type: "file",
				...(part.filename != null && { filename: part.filename }),
				mime,
				url: toMediaWireUrl(part.image, mime),
			});
			continue;
		}

		if (part.type === "file") {
			const fileMime = resolveFileMediaType(part.data, part.mimeType);
			promptParts.push({
				type: "file",
				filename: part.filename,
				mime: fileMime,
				// An `id` reference is an opaque handle this adapter cannot send, left
				// unwrapped so it fails loudly rather than shipping a corrupt payload.
				url: part.sourceType === "id" ? part.data : toMediaWireUrl(part.data, fileMime),
			});
		}
	}

	return promptParts;
};

const getRecordValue = (record: Record<string, unknown>, keys: readonly string[]) => {
	for (const key of keys) {
		if (key in record) {
			return record[key];
		}
	}

	return undefined;
};

const toPermissionRequest = (request: PermissionRequest): OpenCodePermissionRequest | null => {
	if (typeof request.id !== "string" || typeof request.sessionID !== "string") {
		return null;
	}

	const metadata =
		typeof request.metadata === "object" && request.metadata !== null
			? (request.metadata as Record<string, unknown>)
			: {};

	const titleValue = getRecordValue(metadata, ["title", "message", "prompt"]);
	const toolNameValue = getRecordValue(metadata, ["toolName", "tool", "name", "permission"]);
	const toolInputValue = getRecordValue(metadata, ["toolInput", "input", "args", "arguments"]);

	return {
		id: request.id,
		sessionId: request.sessionID,
		permission: request.permission,
		patterns: request.patterns,
		metadata,
		always: Array.isArray(request.always) ? request.always : [],
		tool: request.tool,
		toolName: typeof toolNameValue === "string" ? toolNameValue : request.permission,
		toolInput: toolInputValue,
		title: typeof titleValue === "string" ? titleValue : undefined,
		askedAt: Date.now(),
		raw: request,
	};
};

const extractPermissionRequest = (event: OpenCodeServerEvent): OpenCodePermissionRequest | null =>
	toPermissionRequest(event.properties as PermissionRequest);

const toQuestionRequest = (request: QuestionRequest): OpenCodeQuestionRequest | null => {
	if (typeof request.id !== "string" || typeof request.sessionID !== "string") {
		return null;
	}

	return {
		...request,
		askedAt: Date.now(),
	};
};

const extractQuestionRequest = (event: OpenCodeServerEvent): OpenCodeQuestionRequest | null =>
	toQuestionRequest(event.properties as unknown as QuestionRequest);

const normalizeUnhandledEvent = (event: OpenCodeServerEvent): OpenCodeUnhandledEvent => ({
	type: event.type,
	sessionId: event.sessionId,
	properties: event.properties as Record<string, unknown>,
	seenAt: Date.now(),
});

const isSupportedDelta = (
	state: OpenCodeThreadState,
	messageId: string,
	partId: string,
	field: string,
) => {
	const message = state.messagesById[messageId];
	const part = message?.parts.find((candidate) => candidate.id === partId);
	if (!part) return false;

	return field === "text" && (part.type === "text" || part.type === "reasoning");
};

/** Messages a session's history opens with; the older ones follow in the background. */
export const OPEN_CODE_HISTORY_PAGE_SIZE = 50;

/** A `limit` covering every older message: the server takes `before` only with one. */
const OLDER_HISTORY_LIMIT = 1_000_000;

/** The cursor to the messages older than a page, absent once there are none. */
const nextHistoryCursor = (result: unknown): string | undefined =>
	(result as { response?: Response } | undefined)?.response?.headers?.get("X-Next-Cursor") ??
	undefined;

const whenIdle = () =>
	new Promise<void>((resolve) => {
		if (typeof requestIdleCallback === "function") {
			requestIdleCallback(() => resolve(), { timeout: 1_000 });
		} else {
			setTimeout(resolve, 0);
		}
	});

const STATUS_EVENT_TYPES: ReadonlySet<OpenCodeStateEvent["type"]> = new Set([
	"session.status",
	"session.idle",
	"run.started",
	"run.cancelling",
	"run.reverting",
]);

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
	 * A history loads its newest page, shows it, then fetches everything older
	 * once the browser is idle and adds it in one dispatch: a long session opens
	 * at the cost of a page, and its full history (for the conversation map,
	 * find and revert) follows without stalling the first paint. Each load bumps
	 * the epoch, so older history fetched for a superseded load is dropped.
	 */
	private historyEpoch = 0;
	private reconnectSyncToken = 0;
	// Bumped by every event that sets run/session status, so a status fetch
	// that resolves after a newer live event cannot overwrite it.
	private statusEpoch = 0;
	private readonly childControllersById = new Map<string, ChildControllerEntry>();
	private readonly childSessionIdByPartId = new Map<string, string>();
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

	private readonly client: OpencodeClient;
	private readonly sessionId: string;

	constructor(
		client: OpencodeClient,
		getEventSource: OpenCodeEventSourceProvider,
		sessionId: string,
	) {
		this.client = client;
		this.sessionId = sessionId;
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
		this.historyEpoch += 1;
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
		this.childSessionIdByPartId.clear();
		this.listeners.clear();
	}

	private rebuildChildSessionIndex() {
		this.childSessionIdByPartId.clear();
		for (const message of Object.values(this.state.messagesById)) {
			for (const part of message.parts) {
				const sessionId = getOpenCodeTaskSessionId(part);
				if (sessionId) {
					this.childSessionIdByPartId.set(part.id, sessionId);
				}
			}
		}
		this.syncChildControllers();
	}

	private updateChildSessionIndex(part: Part) {
		const previousSessionId = this.childSessionIdByPartId.get(part.id);
		const sessionId = getOpenCodeTaskSessionId(part);
		if (sessionId === previousSessionId) return;

		if (sessionId) {
			this.childSessionIdByPartId.set(part.id, sessionId);
		} else {
			this.childSessionIdByPartId.delete(part.id);
		}
		this.syncChildControllers();
	}

	private removeFromChildSessionIndex(partId: string) {
		if (!this.childSessionIdByPartId.delete(partId)) return;
		this.syncChildControllers();
	}

	private syncChildControllers() {
		const sessionIds = new Set(this.childSessionIdByPartId.values());
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

			const controller = new OpenCodeThreadController(this.client, this.getEventSource, sessionId);
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
		switch (event.type) {
			case "history.loaded":
			case "history.prepended":
			case "message.removed":
				this.rebuildChildSessionIndex();
				break;
			case "part.updated":
				this.updateChildSessionIndex(event.part);
				break;
			case "part.removed":
				this.removeFromChildSessionIndex(event.partId);
				break;
			default:
				break;
		}
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
			.then(() => this.client.session.status(undefined, OPEN_CODE_REQUEST_OPTIONS))
			.catch(() => null)
			.then((response) => {
				if (!response?.data || epoch !== this.statusEpoch) return;
				const status = response.data[this.sessionId];
				if (status) {
					this.dispatch({ type: "session.status", status });
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
			.list(undefined, OPEN_CODE_REQUEST_OPTIONS)
			.catch(() => null)
			.then((response) => {
				if (!response || token !== this.reconnectSyncToken) return;
				for (const item of response.data ?? []) {
					const request = toPermissionRequest(item);
					if (!request || request.sessionId !== this.sessionId) continue;
					if (request.id in this.state.interactions.permissions.pending) {
						continue;
					}
					this.dispatch({ type: "permission.asked", request });
				}
			});

		void this.client.question
			.list(undefined, OPEN_CODE_REQUEST_OPTIONS)
			.catch(() => null)
			.then((response) => {
				if (!response || token !== this.reconnectSyncToken) return;
				for (const item of response.data ?? []) {
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
		const epoch = ++this.historyEpoch;

		const request = Promise.all([
			this.client.session.get({ sessionID: this.sessionId }, OPEN_CODE_REQUEST_OPTIONS),
			this.client.session.messages(
				{ sessionID: this.sessionId, limit: OPEN_CODE_HISTORY_PAGE_SIZE },
				OPEN_CODE_REQUEST_OPTIONS,
			),
		])
			.then(async ([sessionResponse, messagesResponse]) => {
				if (this.loadPromise !== request) return;
				const session = sessionResponse.data ?? null;
				let messages = ((messagesResponse.data ?? []) as MessageWithParts[]).slice();
				let cursor = nextHistoryCursor(messagesResponse);
				// A reverted session hides everything from its revert point on, so a
				// page that starts at or after it would show nothing: load it all.
				const revertId = session?.revert?.messageID;
				const oldestId = messages[0]?.info.id;
				if (cursor && revertId && oldestId && revertId <= oldestId) {
					const older = await this.fetchOlderHistory(cursor);
					if (this.loadPromise !== request) return;
					messages = [...older, ...messages];
					cursor = undefined;
				}
				this.dispatch({
					type: "history.loaded",
					session,
					messages,
					olderHistory: cursor ? { type: "loading" } : { type: "complete" },
				});
				if (cursor && oldestId) {
					void this.loadOlderHistory(cursor, oldestId, epoch);
				}
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

	private async loadOlderHistory(cursor: string, boundaryId: string, epoch: number) {
		// After the first page has painted: parsing and merging a long history
		// is a long task of its own.
		await whenIdle();
		if (epoch !== this.historyEpoch) return;
		try {
			const messages = await this.fetchOlderHistory(cursor);
			if (epoch !== this.historyEpoch) return;
			this.dispatch({ type: "history.prepended", messages, boundaryId });
		} catch (error) {
			if (epoch !== this.historyEpoch) return;
			this.dispatch({ type: "history.olderFailed", error });
		}
	}

	private async fetchOlderHistory(before: string) {
		const response = await this.client.session.messages(
			{ sessionID: this.sessionId, limit: OLDER_HISTORY_LIMIT, before },
			OPEN_CODE_REQUEST_OPTIONS,
		);
		return ((response.data ?? []) as MessageWithParts[]).slice();
	}

	private createPendingMessage(message: AppendMessage): PendingUserMessage {
		const parts = flattenMessageParts(message) as readonly ThreadUserMessagePart[];

		return {
			clientId: createLocalId("local"),
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
			await this.client.session.promptAsync(
				{
					sessionID: this.sessionId,
					// The SDK currently infers a narrower payload shape than the runtime
					// accepts here, so we cast at the boundary instead of widening types
					// throughout the caller stack.
					parts: getPromptParts(message) as never,
					...(options?.model ? { model: options.model } : {}),
					...(options?.agent ? { agent: options.agent } : {}),
					...(options?.noReply ? { noReply: options.noReply } : {}),
				},
				OPEN_CODE_REQUEST_OPTIONS,
			);
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
			await this.client.session.abort(
				{
					sessionID: this.sessionId,
				},
				OPEN_CODE_REQUEST_OPTIONS,
			);
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async revert(messageId: string) {
		this.dispatch({ type: "run.reverting" });
		try {
			const response = await this.client.session.revert(
				{
					sessionID: this.sessionId,
					messageID: messageId,
				},
				OPEN_CODE_REQUEST_OPTIONS,
			);
			// The server always returns Session.Info on 2xx — match the extension's
			// error handling (KiloProvider.ts:4463).
			if (!response.data) throw new Error("Revert returned no session");
			// Dispatch the REST response as the authoritative session state so
			// the boundary lands synchronously rather than waiting for an SSE.
			this.dispatch({ type: "session.updated", session: response.data as never });
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
			const response = await this.client.session.unrevert(
				{
					sessionID: this.sessionId,
				},
				OPEN_CODE_REQUEST_OPTIONS,
			);
			// Mirror revert / extension (KiloProvider.ts:4478): no-data is an error.
			if (!response.data) throw new Error("Redo returned no session");
			// Apply the REST response (revert field now cleared) before returning to idle.
			this.dispatch({ type: "session.updated", session: response.data as never });
			this.dispatch({ type: "session.idle", sessionId: this.sessionId });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async fork(messageId: string) {
		const response = await this.client.session.fork(
			{
				sessionID: this.sessionId,
				messageID: messageId,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
		if (!response.data?.id) {
			throw new Error("Failed to fork OpenCode session");
		}
		return response.data.id;
	}

	public async replyToPermission(permissionId: string, response: OpenCodePermissionResponse) {
		await this.client.permission.reply(
			{
				requestID: permissionId,
				reply: response,
				// A human answered this prompt. The server refuses non-reject
				// approvals of sensitive (skill-shell / sandbox-escalation)
				// permissions unless `interactive` is set, silently leaving them
				// pending — which later gets swept to "rejected" when a sibling
				// permission in the same session is answered. Mirror the TUI, which
				// sets interactive:true on Allow/Always and omits it on reject.
				...(response !== "reject" ? { interactive: true } : {}),
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);

		this.dispatch({
			type: "permission.replied",
			permissionId,
			reply: response,
		});
	}

	public async replyToQuestion(questionId: string, answers: readonly QuestionAnswer[]) {
		await this.client.question.reply(
			{
				requestID: questionId,
				answers: answers.slice(),
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);

		this.dispatch({
			type: "question.replied",
			questionId,
			answers,
		});
	}

	public async rejectQuestion(questionId: string) {
		await this.client.question.reject(
			{
				requestID: questionId,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);

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
			case "session.updated": {
				const session = event.properties.info;
				if (session && typeof session === "object") {
					this.dispatch({
						type: "session.updated",
						session: session as never,
					});
				}
				return;
			}

			case "session.status":
				if (event.properties.status) {
					this.dispatch({
						type: "session.status",
						status: event.properties.status as SessionStatus,
					});
				}
				return;

			case "session.idle":
				this.dispatch({ type: "session.idle", sessionId: this.sessionId });
				return;

			case "session.compacted":
				this.dispatch({ type: "session.compacted", sessionId: this.sessionId });
				this.refreshInBackground();
				return;

			case "session.error":
				if (event.properties.error !== undefined) {
					this.dispatch({
						type: "run.failed",
						error: event.properties.error,
					});
					return;
				}
				break;

			case "message.updated": {
				const info = event.properties.info;
				if (info && typeof info === "object" && "id" in info) {
					this.dispatch({
						type: "message.updated",
						info: info as never,
					});
				}
				return;
			}

			case "message.removed":
				if (typeof event.properties.messageID === "string") {
					this.dispatch({
						type: "message.removed",
						messageId: event.properties.messageID,
					});
				}
				return;

			case "message.part.updated": {
				const part = event.properties.part;
				const messageId =
					part &&
					typeof part === "object" &&
					"messageID" in part &&
					typeof part.messageID === "string"
						? part.messageID
						: undefined;

				if (messageId && part && typeof part === "object") {
					if (!(messageId in this.state.messagesById)) {
						this.refreshInBackground();
						return;
					}

					this.dispatch({
						type: "part.updated",
						messageId,
						part: part as never,
					});
				}
				return;
			}

			case "message.part.delta":
				if (
					typeof event.properties.messageID === "string" &&
					typeof event.properties.partID === "string" &&
					typeof event.properties.field === "string" &&
					typeof event.properties.delta === "string"
				) {
					const { messageID, partID, field, delta } = event.properties;

					if (isSupportedDelta(this.state, messageID, partID, field)) {
						this.dispatch({
							type: "part.delta",
							messageId: messageID,
							partId: partID,
							field,
							delta,
						});
					} else {
						this.refreshInBackground();
					}
				}
				return;

			case "message.part.removed":
				if (
					typeof event.properties.messageID === "string" &&
					typeof event.properties.partID === "string"
				) {
					if (!(event.properties.messageID in this.state.messagesById)) {
						this.refreshInBackground();
						return;
					}

					this.dispatch({
						type: "part.removed",
						messageId: event.properties.messageID,
						partId: event.properties.partID,
					});
				}
				return;

			case "permission.asked": {
				const request = extractPermissionRequest(event);
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
					(event.properties.reply === "once" ||
						event.properties.reply === "always" ||
						event.properties.reply === "reject")
				) {
					this.dispatch({
						type: "permission.replied",
						permissionId: event.properties.requestID,
						reply: event.properties.reply,
					});
				}
				return;

			case "question.asked": {
				const request = extractQuestionRequest(event);
				if (request) {
					this.dispatch({
						type: "question.asked",
						request,
					});
				}
				return;
			}

			case "question.replied":
				if (
					typeof event.properties.requestID === "string" &&
					Array.isArray(event.properties.answers)
				) {
					this.dispatch({
						type: "question.replied",
						questionId: event.properties.requestID,
						answers: event.properties.answers as never,
					});
				}
				return;

			case "question.rejected":
				if (typeof event.properties.requestID === "string") {
					this.dispatch({
						type: "question.rejected",
						questionId: event.properties.requestID,
					});
				}
				return;
		}

		this.dispatch({
			type: "unhandled.event",
			event: normalizeUnhandledEvent(event),
		});
	}

	private dispatch(event: Parameters<typeof reduceOpenCodeThreadState>[1]) {
		if (STATUS_EVENT_TYPES.has(event.type)) this.statusEpoch += 1;
		const nextState = reduceOpenCodeThreadState(this.state, event);
		if (nextState === this.state) return;
		this.state = nextState;
		this.syncChildSessionIndex(event);
		this.notifyListeners();
	}
}
