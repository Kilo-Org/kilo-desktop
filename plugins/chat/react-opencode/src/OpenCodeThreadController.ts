import type { AppendMessage, ThreadUserMessagePart } from "@assistant-ui/react";
import {
	resolveFileMediaType,
	resolveImageMediaType,
	toMediaWireUrl,
} from "@assistant-ui/core/internal";
import type { FormInfo, OpenCodeClient } from "@kilocode/client";

import { STREAM_RECONNECTED_EVENT_TYPE, type OpenCodeEventSource } from "./OpenCodeEventSource";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";
import { createOpenCodeThreadState, reduceOpenCodeThreadState } from "./openCodeThreadState";
import type {
	OpenCodeOlderHistory,
	OpenCodePermissionResponse,
	OpenCodePromptSender,
	OpenCodeServerEvent,
	OpenCodeStateEvent,
	OpenCodeThreadControllerLike,
	OpenCodeThreadState,
	OpenCodeUserMessageOptions,
	PendingUserMessage,
	QuestionAnswer,
	Transcript,
} from "./types";

type OpenCodeEventSourceProvider = () => Pick<OpenCodeEventSource, "subscribe">;

type ChildControllerEntry = {
	controller: OpenCodeThreadController;
	unsubscribe: (() => void) | null;
};

/** Messages a session's history opens with; older pages follow in the background. */
export const OPEN_CODE_HISTORY_PAGE_SIZE = 50;

/** The largest page `message.list` serves. */
const OLDER_HISTORY_PAGE_SIZE = 200;

/** A message id the server accepts (`msg_…`), increasing with time like kilo2's own. */
export const createMessageId = () =>
	`msg_${Date.now().toString(36).padStart(9, "0")}${Math.random().toString(36).slice(2, 12)}`;

// The attachment carries a name and content type its parts do not, so they
// ride along rather than being dropped at the flatten.
const flattenMessageParts = (message: AppendMessage) => [
	...message.content,
	...(message.attachments?.flatMap((attachment) =>
		(attachment.content ?? []).map((part) => ({
			...part,
			...(attachment.name != null && {
				filename: (part as { filename?: string }).filename ?? attachment.name,
			}),
			...(attachment.contentType != null && { contentType: attachment.contentType }),
		})),
	) ?? []),
];

/** A prompt's parts as v2's one text and its files by URL (data URLs for inline content). */
export const toPromptInput = (parts: readonly ThreadUserMessagePart[]) => {
	const texts: string[] = [];
	const files: { uri: string; name?: string }[] = [];
	for (const part of parts) {
		if (part.type === "text") texts.push(part.text);
		else if (part.type === "image") {
			const mime = resolveImageMediaType(
				part.image,
				(part as { contentType?: string }).contentType,
			);
			files.push({
				uri: toMediaWireUrl(part.image, mime),
				...(part.filename != null && { name: part.filename }),
			});
		} else if (part.type === "file") {
			const mime = resolveFileMediaType(part.data, part.mimeType);
			files.push({
				// An `id` reference is an opaque handle; sent unwrapped so it fails loudly.
				uri: part.sourceType === "id" ? part.data : toMediaWireUrl(part.data, mime),
				...(part.filename != null && { name: part.filename }),
			});
		}
	}
	return { text: texts.join("\n\n"), files };
};

/** The default sender: the chat's agent and model switched, then `session.prompt`. */
export const createDefaultPromptSender =
	(client: OpenCodeClient): OpenCodePromptSender =>
	async ({ sessionId, messageId, parts, options }) => {
		if (options.agent)
			await client.session.switchAgent({ sessionID: sessionId, agent: options.agent });
		if (options.model) {
			await client.session.switchModel({
				sessionID: sessionId,
				model: { providerID: options.model.providerID, id: options.model.modelID },
			});
		}
		const { text, files } = toPromptInput(parts);
		await client.session.prompt({
			sessionID: sessionId,
			id: messageId,
			text,
			...(files.length > 0 ? { files } : {}),
		});
	};

/** A form reply's answer object (`{ q0: …, q1: … }`) from labels per question. */
export const toFormAnswer = (form: FormInfo, answers: readonly QuestionAnswer[]) => {
	const answer: Record<string, string | string[]> = {};
	for (const [index, field] of form.fields.entries()) {
		const chosen = answers[index];
		if (!chosen || chosen.length === 0) continue;
		answer[field.key] = field.type === "multiselect" ? [...chosen] : chosen.join(", ");
	}
	return answer;
};

const childIdsCache = new WeakMap<object, readonly string[]>();

/** The child sessions a message's subagent calls run in (cached: a streamed token replaces one message). */
const childSessionIdsOf = (message: Transcript[number]): readonly string[] => {
	if (message.type !== "assistant") return [];
	let ids = childIdsCache.get(message);
	if (!ids) {
		ids = message.content.flatMap((item) => {
			const id = item.type === "tool" ? getOpenCodeTaskSessionId(item) : undefined;
			return id ? [id] : [];
		});
		childIdsCache.set(message, ids);
	}
	return ids;
};

const whenIdle = () =>
	new Promise<void>((resolve) => {
		if (typeof requestIdleCallback === "function") {
			requestIdleCallback(() => resolve(), { timeout: 1_000 });
		} else {
			setTimeout(resolve, 0);
		}
	});

/** A page of `message.list` (newest first) in transcript order. */
const ascending = (page: { data: Transcript }) => [...page.data].reverse();

const STATUS_EVENT_TYPES: ReadonlySet<OpenCodeStateEvent["type"]> = new Set([
	"status",
	"run.started",
	"run.cancelling",
	"run.reverting",
]);

const EXECUTION_EVENT = /^session\.execution\./;

const isThreadRunning = (state: OpenCodeThreadState): boolean =>
	state.running ||
	state.runState.type === "streaming" ||
	state.runState.type === "cancelling" ||
	state.runState.type === "reverting";

/**
 * One Kilo v2 session as a thread: loads its history (newest page first,
 * older pages in the background), follows its events on the shared stream,
 * and sends prompts, interrupts, reverts and answers.
 *
 * - While no one listens the controller only watches whether the stream
 *   brought anything for its session (or reconnected); a listener returning
 *   then reloads only if it did.
 * - A running thread keeps applying its session's events after its last
 *   listener leaves, and lets go once the run ends: streamed text exists
 *   only as deltas until its part ends, so a reload mid-run would lose it.
 * - v2 publishes no session status: the controller reads `session.active`
 *   when it attaches and after every reconnect; a reply older than a newer
 *   execution event is ignored (`statusEpoch`).
 * - Subagent calls' child sessions get child controllers (read-only), keyed
 *   by `state.metadata.sessionID` on the call.
 */
export class OpenCodeThreadController implements OpenCodeThreadControllerLike {
	private state: OpenCodeThreadState;
	private readonly listeners = new Set<() => void>();
	private unsubscribeFromEvents: (() => void) | null = null;
	private stopStaleWatch: (() => void) | null = null;
	private stale = false;
	// Set by `dispose` until a listener returns: a disposed thread whose run
	// ends lets go of the event source entirely, as no one can read `stale`.
	private disposed = false;
	private loadPromise: Promise<void> | null = null;
	/** Bumped by each load, so older pages fetched for a superseded load are dropped. */
	private historyEpoch = 0;
	private reconnectSyncToken = 0;
	private statusEpoch = 0;
	private readonly childControllersById = new Map<string, ChildControllerEntry>();
	private ancestorSessionIds: ReadonlySet<string>;
	private isChildSession = false;
	private readonly stagedMessages = new Map<
		string,
		{ options: OpenCodeUserMessageOptions | undefined; pending: PendingUserMessage }
	>();
	private readonly sendPrompt: OpenCodePromptSender;

	constructor(
		private readonly client: OpenCodeClient,
		private readonly getEventSource: OpenCodeEventSourceProvider,
		private readonly sessionId: string,
		sendPrompt?: OpenCodePromptSender,
	) {
		this.state = createOpenCodeThreadState(sessionId);
		this.ancestorSessionIds = new Set([sessionId]);
		this.sendPrompt = sendPrompt ?? createDefaultPromptSender(client);
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

	// --- Child sessions ---

	private updateChildSnapshot(sessionId: string, childState: OpenCodeThreadState) {
		if (this.state.childSessionsById[sessionId] === childState) return;
		this.state = {
			...this.state,
			childSessionsById: { ...this.state.childSessionsById, [sessionId]: childState },
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
		this.listeners.clear();
	}

	private childSessionIds(): Set<string> {
		const ids = new Set<string>();
		for (const message of this.state.messages) {
			for (const id of childSessionIdsOf(message)) {
				if (!this.ancestorSessionIds.has(id)) ids.add(id);
			}
		}
		return ids;
	}

	private syncChildControllers() {
		const sessionIds = this.childSessionIds();
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
			const entry: ChildControllerEntry = { controller, unsubscribe: null };
			this.childControllersById.set(sessionId, entry);
			childSessionsById = { ...childSessionsById, [sessionId]: controller.getState() };
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

	// --- Events ---

	// `applied` is the event being handled when the watch starts: a source may
	// deliver it to a listener added during its delivery.
	private watchForStaleness(applied?: OpenCodeServerEvent) {
		if (this.stopStaleWatch) return;
		this.stopStaleWatch = this.getEventSource().subscribe((event) => {
			if (event === applied) return;
			if (event.type !== STREAM_RECONNECTED_EVENT_TYPE && event.sessionId !== this.sessionId)
				return;
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
		if (this.stale && this.state.loadState.type === "ready") this.refreshInBackground();
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
		// Running only shows in live events; anything missed while unsubscribed is read.
		this.syncRunning();
	}

	private syncRunning() {
		const epoch = this.statusEpoch;
		void Promise.resolve()
			.then(() => this.client.session.active())
			.catch(() => null)
			.then((active) => {
				if (!active || epoch !== this.statusEpoch) return;
				this.dispatch({ type: "status", running: this.sessionId in active });
			});
	}

	/** What the session waits on, read again (the stream replays nothing). */
	private syncInteractions(token: number) {
		if (this.isChildSession) return;
		void this.client.permission
			.list({ sessionID: this.sessionId })
			.catch(() => null)
			.then((requests) => {
				if (requests && token === this.reconnectSyncToken) {
					this.dispatch({ type: "permissions.loaded", requests });
				}
			});
		void this.client.session.form
			.list({ sessionID: this.sessionId })
			.catch(() => null)
			.then((forms) => {
				if (forms && token === this.reconnectSyncToken) {
					this.dispatch({ type: "questions.loaded", forms });
				}
			});
	}

	private handleStreamReconnect() {
		this.refreshInBackground();
		this.syncRunning();
		this.syncInteractions(++this.reconnectSyncToken);
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

	public getState = () => this.state;

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

	// --- History ---

	public async load(force = false) {
		if (this.loadPromise && !force) return this.loadPromise;
		this.dispatch({ type: "history.loading" });
		const epoch = ++this.historyEpoch;
		const token = ++this.reconnectSyncToken;
		const statusEpoch = this.statusEpoch;
		const request = Promise.all([
			this.client.session.get({ sessionID: this.sessionId }),
			this.client.message.list({ sessionID: this.sessionId, limit: OPEN_CODE_HISTORY_PAGE_SIZE }),
			this.client.session.active().catch(() => undefined),
		])
			.then(async ([session, page, active]) => {
				if (this.loadPromise !== request) return;
				let messages = ascending(page);
				let cursor =
					page.data.length === OPEN_CODE_HISTORY_PAGE_SIZE
						? (page.cursor.next ?? undefined)
						: undefined;
				// A staged revert hides everything from its boundary on, so a page that
				// starts at or after it would show nothing: load it all.
				const boundary = session.revert?.messageID;
				if (cursor && boundary && !messages.slice(1).some((message) => message.id === boundary)) {
					const older = await this.fetchOlderHistory(cursor, () => this.loadPromise === request);
					if (this.loadPromise !== request) return;
					messages = [...older, ...messages];
					cursor = undefined;
				}
				// A newer execution event than the `session.active` read wins.
				const running =
					active && statusEpoch === this.statusEpoch
						? this.sessionId in active
						: this.state.running;
				this.dispatch({
					type: "history.loaded",
					session,
					messages,
					running,
					olderHistory: cursor ? { type: "available", cursor } : { type: "complete" },
				});
				this.syncInteractions(token);
				if (cursor) void this.loadOlderHistory(epoch);
			})
			.catch((error: unknown) => {
				if (this.loadPromise !== request) throw error;
				this.dispatch({ type: "history.failed", error });
				throw error;
			})
			.finally(() => {
				if (this.loadPromise === request) this.loadPromise = null;
			});
		this.loadPromise = request;
		return request;
	}

	public refresh() {
		return this.load(true);
	}

	/** Every older message, after the first page has painted (a long history is a long task). */
	private async loadOlderHistory(epoch: number) {
		await whenIdle();
		const older = this.state.olderHistory;
		if (epoch !== this.historyEpoch || !older || older.type === "complete") return;
		this.dispatch({ type: "history.olderLoading" });
		try {
			const messages = await this.fetchOlderHistory(
				older.cursor,
				() => epoch === this.historyEpoch,
			);
			if (epoch !== this.historyEpoch) return;
			const complete: OpenCodeOlderHistory = { type: "complete" };
			this.dispatch({ type: "history.prepended", messages, olderHistory: complete });
		} catch (error) {
			if (epoch !== this.historyEpoch) return;
			this.dispatch({ type: "history.olderFailed", error });
		}
	}

	/** The messages older than `cursor`, oldest first, page by page while `current`. */
	private async fetchOlderHistory(cursor: string, current: () => boolean) {
		const pages: Transcript[] = [];
		let next: string | undefined = cursor;
		while (next && current()) {
			// Each page needs the previous page's cursor.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			const page = await this.client.message.list({
				sessionID: this.sessionId,
				cursor: next,
				limit: OLDER_HISTORY_PAGE_SIZE,
			});
			pages.unshift(ascending(page));
			next =
				page.data.length === OLDER_HISTORY_PAGE_SIZE ? (page.cursor.next ?? undefined) : undefined;
		}
		return pages.flat();
	}

	// --- Prompts ---

	private createPendingMessage(message: AppendMessage): PendingUserMessage {
		return {
			clientId: createMessageId(),
			sessionId: this.sessionId,
			createdAt: Date.now(),
			parts: flattenMessageParts(message) as readonly ThreadUserMessagePart[],
			status: "pending",
		};
	}

	private async promptMessage(pending: PendingUserMessage, options?: OpenCodeUserMessageOptions) {
		// Subscribe before starting the run: a first-subscription status read
		// issued after run.started could land before the server runs the turn
		// and flip it back to idle. Issued first, it is superseded.
		this.ensureEventSubscription();
		this.dispatch({ type: "run.started" });
		try {
			await this.sendPrompt({
				sessionId: this.sessionId,
				messageId: pending.clientId,
				parts: pending.parts,
				options: options ?? {},
			});
		} catch (error) {
			this.dispatch({ type: "local.message.failed", clientId: pending.clientId, error });
			throw error;
		}
	}

	public async sendMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions) {
		if (message.role !== "user") throw new Error("Kilo only supports sending user messages");
		const pending = this.createPendingMessage(message);
		this.dispatch({ type: "local.message.queued", pending });
		await this.promptMessage(pending, options);
	}

	/** Shows a prompt without sending it, for `sendStagedMessage` to send later. */
	public async stageMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions) {
		if (message.role !== "user") throw new Error("Kilo only supports sending user messages");
		const pending = this.createPendingMessage(message);
		this.stagedMessages.set(`local:${pending.clientId}`, { options, pending });
		this.dispatch({ type: "local.message.queued", pending });
	}

	public async sendStagedMessage(parentId: string, options?: OpenCodeUserMessageOptions) {
		const staged = this.stagedMessages.get(parentId);
		if (!staged) return false;
		if (this.state.pendingUserMessages[staged.pending.clientId]?.status === "failed") {
			this.dispatch({ type: "local.message.queued", pending: staged.pending });
		}
		await this.promptMessage(staged.pending, options ?? staged.options);
		this.stagedMessages.delete(parentId);
		return true;
	}

	public async cancel() {
		this.dispatch({ type: "run.cancelling" });
		try {
			const { interrupted } = await this.client.session.interrupt({ sessionID: this.sessionId });
			if (!interrupted) this.dispatch({ type: "status", running: false });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	/** Stages a revert to before `messageId`; the next prompt commits it, `unrevert` clears it. */
	public async revert(messageId: string) {
		this.dispatch({ type: "run.reverting" });
		try {
			const revert = await this.client.session.revert.stage({
				sessionID: this.sessionId,
				messageID: messageId,
			});
			if (this.state.session) {
				this.dispatch({ type: "session.info", session: { ...this.state.session, revert } });
			}
			this.dispatch({ type: "status", running: false });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async unrevert() {
		this.dispatch({ type: "run.reverting" });
		try {
			await this.client.session.revert.clear({ sessionID: this.sessionId });
			if (this.state.session) {
				const { revert: _revert, ...session } = this.state.session;
				this.dispatch({ type: "session.info", session });
			}
			this.dispatch({ type: "status", running: false });
		} catch (error) {
			this.dispatch({ type: "run.failed", error });
			throw error;
		}
	}

	public async fork(messageId: string) {
		const fork = await this.client.session.fork({ sessionID: this.sessionId, before: messageId });
		return fork.id;
	}

	public async replyToPermission(permissionId: string, response: OpenCodePermissionResponse) {
		await this.client.permission.reply({
			sessionID: this.sessionId,
			requestID: permissionId,
			decision: response,
		});
		this.dispatch({ type: "permission.replied", permissionId, reply: response });
	}

	public async replyToQuestion(questionId: string, answers: readonly QuestionAnswer[]) {
		const form =
			this.state.interactions.questions.pending[questionId] ??
			(await this.client.session.form.get({ sessionID: this.sessionId, formID: questionId }));
		await this.client.session.form.reply({
			sessionID: this.sessionId,
			formID: questionId,
			answer: toFormAnswer(form, answers),
		});
		this.dispatch({ type: "question.replied", questionId, answers });
	}

	public async rejectQuestion(questionId: string) {
		await this.client.session.form.cancel({ sessionID: this.sessionId, formID: questionId });
		this.dispatch({ type: "question.rejected", questionId });
	}

	private refreshInBackground() {
		void this.refresh().catch((error: unknown) => {
			this.dispatch({ type: "run.failed", error });
		});
	}

	private handleServerEvent(event: OpenCodeServerEvent) {
		// A step for a message the transcript doesn't hold means history was missed.
		const assistantMessageId = event.data.assistantMessageID;
		if (
			typeof assistantMessageId === "string" &&
			event.type !== "session.step.started" &&
			this.state.loadState.type === "ready" &&
			!this.state.messages.some((message) => message.id === assistantMessageId)
		) {
			this.refreshInBackground();
			return;
		}
		if (EXECUTION_EVENT.test(event.type) || event.type === "session.retry.scheduled") {
			this.statusEpoch += 1;
		}
		this.dispatch({ type: "server.event", event });
		if (event.type === "session.compaction.ended") this.refreshInBackground();
	}

	private dispatch(event: OpenCodeStateEvent) {
		if (STATUS_EVENT_TYPES.has(event.type)) this.statusEpoch += 1;
		const nextState = reduceOpenCodeThreadState(this.state, event);
		if (nextState === this.state) return;
		const messagesChanged = nextState.messages !== this.state.messages;
		this.state = nextState;
		if (messagesChanged) this.syncChildControllers();
		this.notifyListeners();
	}
}
