import { readFile, rm } from "node:fs/promises";

import { writeFile as atomicWriteFile } from "atomically";

import type { HostMessagePort, MainSdkLogger } from "@kilo-desktop/feature-sdk/main";

import {
	MAX_TERMINAL_LABEL_LENGTH,
	terminalClientMessageSchema,
	type TerminalConnectionArgs,
	type TerminalIdentity,
	type TerminalServerMessage,
	type TerminalStatus,
} from "../../contracts/session.js";
import { capHistory, historyPath, sanitizeHistoryChunk } from "./history.js";
import type { PtyAdapter, PtyProcess } from "./pty.js";
import { inspectForegroundProcess } from "./process-activity.js";
import {
	resolveShellCandidates,
	spawnFirstAvailableShell,
	terminalEnvironment,
} from "./shell-launch.js";

interface Subscriber {
	readonly port: HostMessagePort;
	ready: boolean;
	queued: TerminalServerMessage[];
}

interface Session {
	readonly key: string;
	readonly sessionId: string;
	readonly terminalId: string;
	defaultLabel: string;
	foregroundProcessLabel: string | null;
	cwd: string;
	cols: number;
	rows: number;
	status: TerminalStatus;
	history: string;
	acceptedInputCount: number;
	pendingControlSequence: string;
	exitCode: number | null;
	exitSignal: number | null;
	process: PtyProcess | null;
	disposeData: (() => void) | null;
	disposeExit: (() => void) | null;
	subscribers: Set<Subscriber>;
	persistTimer: ReturnType<typeof setTimeout> | null;
}

export interface TerminalSessionManagerOptions {
	readonly adapter: PtyAdapter;
	readonly storageDir: string;
	readonly resolveCwd: (cwd?: string) => Promise<string>;
	readonly platform?: NodeJS.Platform;
	readonly env?: NodeJS.ProcessEnv;
	readonly persistDebounceMs?: number;
	readonly killGraceMs?: number;
	readonly inspectForegroundProcess?: (terminalPid: number) => Promise<string | null>;
	readonly processPollIntervalMs?: number;
	readonly onSessionExited?: (identity: TerminalIdentity) => void;
	readonly logger?: Pick<MainSdkLogger, "error">;
}

/**
 * Owns every chat terminal process, its ordered output stream, bounded durable
 * transcript, foreground-process label, and all renderer attachments. Sessions
 * outlive MessagePorts so a renderer reload reconnects without replacing the
 * shell. An omitted cwd preserves an existing session's workspace; only an
 * explicit cwd can replace it. The manager is the only layer allowed to spawn,
 * inspect, or signal PTYs; explicit close and app teardown share the same lifecycle.
 * Accepted input is sequenced by the session so renderer reconnects retain a
 * monotonic acknowledgement boundary. Pending session creation is coordinated
 * with close and teardown so a delayed attachment cannot resurrect a terminal
 * after its owner has gone away. History writes are serialized per file and
 * atomically replaced so debounced output, explicit close, and teardown cannot
 * commit stale snapshots out of order.
 */
export class TerminalSessionManager {
	readonly #sessions = new Map<string, Session>();
	readonly #sessionCreations = new Map<string, Promise<Session>>();
	readonly #closedSessionKeys = new Set<string>();
	readonly #adapter: PtyAdapter;
	readonly #storageDir: string;
	readonly #resolveCwd: (cwd?: string) => Promise<string>;
	readonly #platform: NodeJS.Platform;
	readonly #env: NodeJS.ProcessEnv;
	readonly #persistDebounceMs: number;
	readonly #killGraceMs: number;
	readonly #inspectForegroundProcess: (terminalPid: number) => Promise<string | null>;
	readonly #processPollIntervalMs: number;
	readonly #onSessionExited: (identity: TerminalIdentity) => void;
	readonly #logger: Pick<MainSdkLogger, "error">;
	#processPollTimer: ReturnType<typeof setTimeout> | null = null;
	#processPollRunning = false;
	#disposed = false;

	constructor(options: TerminalSessionManagerOptions) {
		this.#adapter = options.adapter;
		this.#storageDir = options.storageDir;
		this.#resolveCwd = options.resolveCwd;
		this.#platform = options.platform ?? process.platform;
		this.#env = options.env ?? process.env;
		this.#persistDebounceMs = options.persistDebounceMs ?? 40;
		this.#killGraceMs = options.killGraceMs ?? 1_000;
		this.#inspectForegroundProcess = options.inspectForegroundProcess ?? inspectForegroundProcess;
		this.#processPollIntervalMs = options.processPollIntervalMs ?? 1_000;
		this.#onSessionExited = options.onSessionExited ?? (() => undefined);
		this.#logger = options.logger ?? { error: () => undefined };
	}

	async attach(port: HostMessagePort, args: TerminalConnectionArgs): Promise<void> {
		const key = sessionKey(args.sessionId, args.terminalId);
		this.#assertAttachable(key);
		const cwd = await this.#resolveCwd(args.cwd);
		this.#assertAttachable(key);
		let session = this.#sessions.get(key);
		if (!session) session = await this.#getOrCreateSession(key, args, cwd);
		this.#assertAttachable(key);
		session.defaultLabel = truncateLabel(args.initialLabel);
		if (args.cwd !== undefined && session.cwd !== cwd) {
			await this.#replaceForWorkspace(session, cwd, args.cols, args.rows);
		}
		this.#assertAttachable(key);
		const subscriber = this.#attachSubscriber(session, port);
		port.postMessage(this.#snapshot(session));
		subscriber.ready = true;
		for (const message of subscriber.queued.splice(0)) port.postMessage(message);
		port.start();
		if (!session.process && session.status === "starting") await this.#start(session);
	}

	async close(
		identity: { readonly sessionId: string; readonly terminalId: string },
		deleteHistory: boolean,
	): Promise<void> {
		const key = sessionKey(identity.sessionId, identity.terminalId);
		this.#closedSessionKeys.add(key);
		let session = this.#sessions.get(key);
		if (!session) {
			try {
				session = await this.#sessionCreations.get(key);
			} catch {
				// The attaching caller observes creation failures; close still removes history below.
			}
		}
		if (!session) {
			if (deleteHistory)
				await rm(historyPath(this.#storageDir, identity.sessionId, identity.terminalId), {
					force: true,
				});
			return;
		}
		this.#sessions.delete(key);
		await this.#terminate(session);
		if (deleteHistory) {
			await rm(historyPath(this.#storageDir, session.sessionId, session.terminalId), {
				force: true,
			});
		} else {
			await this.#persist(session);
		}
		this.#broadcast(session, { type: "status", status: "closed" });
		for (const subscriber of session.subscribers) subscriber.port.close();
		session.subscribers.clear();
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#processPollTimer) clearTimeout(this.#processPollTimer);
		this.#processPollTimer = null;
		await Promise.allSettled(this.#sessionCreations.values());
		const sessions = [...this.#sessions.values()];
		this.#sessions.clear();
		await Promise.allSettled(
			sessions.map(async (session) => {
				await this.#terminate(session);
				await this.#persist(session);
				for (const subscriber of session.subscribers) subscriber.port.close();
				session.subscribers.clear();
			}),
		);
	}

	#assertAttachable(key: string) {
		if (this.#disposed) throw new Error("Terminal manager is disposed.");
		if (this.#closedSessionKeys.has(key)) throw new Error("Terminal session is closed.");
	}

	async #createSession(key: string, args: TerminalConnectionArgs, cwd: string): Promise<Session> {
		let history = "";
		try {
			history = capHistory(
				await readFile(historyPath(this.#storageDir, args.sessionId, args.terminalId), "utf8"),
			);
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
		return {
			key,
			sessionId: args.sessionId,
			terminalId: args.terminalId,
			defaultLabel: truncateLabel(args.initialLabel),
			foregroundProcessLabel: null,
			cwd,
			cols: args.cols,
			rows: args.rows,
			status: "starting",
			history,
			acceptedInputCount: 0,
			pendingControlSequence: "",
			exitCode: null,
			exitSignal: null,
			process: null,
			disposeData: null,
			disposeExit: null,
			subscribers: new Set(),
			persistTimer: null,
		};
	}

	async #getOrCreateSession(
		key: string,
		args: TerminalConnectionArgs,
		cwd: string,
	): Promise<Session> {
		const existing = this.#sessions.get(key);
		if (existing) return existing;
		let pending = this.#sessionCreations.get(key);
		if (!pending) {
			pending = this.#createSession(key, args, cwd).then((session) => {
				this.#sessions.set(key, session);
				return session;
			});
			this.#sessionCreations.set(key, pending);
		}
		try {
			return await pending;
		} finally {
			if (this.#sessionCreations.get(key) === pending) this.#sessionCreations.delete(key);
		}
	}

	#attachSubscriber(session: Session, port: HostMessagePort): Subscriber {
		const subscriber: Subscriber = { port, ready: false, queued: [] };
		session.subscribers.add(subscriber);
		const onMessage = ({ data }: { data: unknown }) => {
			void this.#handleClientMessage(session, subscriber, data);
		};
		const onClose = () => {
			session.subscribers.delete(subscriber);
			port.off("message", onMessage);
			port.off("close", onClose);
		};
		port.on("message", onMessage);
		port.on("close", onClose);
		return subscriber;
	}

	async #handleClientMessage(session: Session, subscriber: Subscriber, data: unknown) {
		const parsed = terminalClientMessageSchema.safeParse(data);
		if (!parsed.success) {
			subscriber.port.postMessage({ type: "error", message: "Invalid terminal message." });
			return;
		}
		const message = parsed.data;
		try {
			switch (message.type) {
				case "input":
					if (!session.process || session.status !== "running")
						throw new Error("The shell is not running.");
					session.process.write(message.data);
					session.acceptedInputCount += 1;
					this.#ack(subscriber, message.requestId);
					this.#broadcast(session, {
						type: "input-accepted",
						count: session.acceptedInputCount,
					});
					break;
				case "resize":
					session.cols = message.cols;
					session.rows = message.rows;
					session.process?.resize(message.cols, message.rows);
					break;
				case "clear":
					session.history = "";
					session.pendingControlSequence = "";
					await this.#persist(session);
					this.#broadcast(session, { type: "cleared" });
					this.#ack(subscriber, message.requestId);
					break;
				case "restart":
					session.history = "";
					session.pendingControlSequence = "";
					await this.#persist(session);
					this.#broadcast(session, { type: "cleared" });
					await this.#terminate(session);
					session.status = "starting";
					session.exitCode = null;
					session.exitSignal = null;
					this.#broadcast(session, { type: "status", status: "starting" });
					if (!(await this.#start(session)))
						throw new Error("The replacement shell could not be started.");
					this.#ack(subscriber, message.requestId);
					break;
			}
		} catch (error) {
			const reason = errorMessage(error);
			if ("requestId" in message) this.#ack(subscriber, message.requestId, reason);
			else subscriber.port.postMessage({ type: "error", message: reason });
		}
	}

	#ack(subscriber: Subscriber, requestId: string, error?: string) {
		subscriber.port.postMessage(
			error ? { type: "ack", requestId, ok: false, error } : { type: "ack", requestId, ok: true },
		);
	}

	async #replaceForWorkspace(session: Session, cwd: string, cols: number, rows: number) {
		await this.#terminate(session);
		session.cwd = cwd;
		session.cols = cols;
		session.rows = rows;
		session.history = "";
		session.pendingControlSequence = "";
		session.status = "starting";
		session.exitCode = null;
		session.exitSignal = null;
		await this.#persist(session);
	}

	async #start(session: Session): Promise<boolean> {
		try {
			const process = spawnFirstAvailableShell(
				this.#adapter,
				{
					cwd: session.cwd,
					cols: session.cols,
					rows: session.rows,
					env: terminalEnvironment(this.#env),
				},
				resolveShellCandidates(this.#platform, this.#env),
			);
			session.process = process;
			session.status = "running";
			session.disposeData = process.onData((data) => this.#handleOutput(session, process, data));
			session.disposeExit = process.onExit((event) => this.#handleExit(session, process, event));
			this.#broadcast(session, { type: "status", status: "running" });
			this.#scheduleProcessPoll(0);
			return true;
		} catch (error) {
			session.status = "error";
			const message = `Could not start a shell: ${errorMessage(error)}`;
			this.#broadcast(session, { type: "status", status: "error" });
			this.#broadcast(session, { type: "error", message });
			return false;
		}
	}

	#handleOutput(session: Session, process: PtyProcess, data: string) {
		if (session.process !== process) return;
		const sanitized = sanitizeHistoryChunk(session.pendingControlSequence, data);
		session.pendingControlSequence = sanitized.pendingControlSequence;
		if (sanitized.visibleText) {
			session.history = capHistory(session.history + sanitized.visibleText);
			this.#schedulePersist(session);
		}
		this.#broadcast(session, { type: "output", data });
	}

	#handleExit(
		session: Session,
		process: PtyProcess,
		event: { readonly exitCode: number; readonly signal: number | null },
	) {
		if (session.process !== process) return;
		this.#detachProcess(session);
		session.status = "exited";
		session.exitCode = event.exitCode;
		session.exitSignal = event.signal;
		this.#persistInBackground(session);
		this.#broadcast(session, {
			type: "status",
			status: "exited",
			exitCode: event.exitCode,
			exitSignal: event.signal,
		});
		this.#onSessionExited({ sessionId: session.sessionId, terminalId: session.terminalId });
	}

	#detachProcess(session: Session) {
		session.disposeData?.();
		session.disposeExit?.();
		session.disposeData = null;
		session.disposeExit = null;
		session.process = null;
		this.#setForegroundProcessLabel(session, null);
	}

	async #terminate(session: Session): Promise<void> {
		const process = session.process;
		if (!process) return;
		try {
			process.kill(this.#platform === "win32" ? undefined : "SIGTERM");
		} catch {
			this.#detachProcess(session);
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, this.#killGraceMs));
		if (session.process !== process) return;
		try {
			process.kill(this.#platform === "win32" ? undefined : "SIGKILL");
		} catch {
			// The process may exit between the identity check and forced termination.
		} finally {
			this.#detachProcess(session);
		}
	}

	#snapshot(session: Session): TerminalServerMessage {
		return {
			type: "snapshot",
			status: session.status,
			cwd: session.cwd,
			history: session.history,
			acceptedInputCount: session.acceptedInputCount,
			exitCode: session.exitCode,
			exitSignal: session.exitSignal,
			label: sessionLabel(session),
		};
	}

	#setForegroundProcessLabel(session: Session, label: string | null) {
		const normalized = label ? truncateLabel(label.trim()) : null;
		if (session.foregroundProcessLabel === normalized) return;
		session.foregroundProcessLabel = normalized;
		this.#broadcast(session, { type: "label", label: sessionLabel(session) });
	}

	#scheduleProcessPoll(delay: number) {
		if (this.#disposed || this.#processPollTimer || !this.#hasRunningProcesses()) return;
		this.#processPollTimer = setTimeout(() => {
			this.#processPollTimer = null;
			void this.#pollProcessActivity();
		}, delay);
		this.#processPollTimer.unref?.();
	}

	async #pollProcessActivity() {
		if (this.#processPollRunning || this.#disposed) return;
		this.#processPollRunning = true;
		try {
			await Promise.all(
				[...this.#sessions.values()].map(async (session) => {
					const process = session.process;
					if (!process || session.status !== "running") return;
					try {
						const label = await this.#inspectForegroundProcess(process.pid);
						if (session.process === process && session.status === "running") {
							this.#setForegroundProcessLabel(session, label);
						}
					} catch {
						// Process inspection is best effort; keep the last known label on failure.
					}
				}),
			);
		} finally {
			this.#processPollRunning = false;
			this.#scheduleProcessPoll(this.#processPollIntervalMs);
		}
	}

	#hasRunningProcesses() {
		return [...this.#sessions.values()].some(
			(session) => session.status === "running" && session.process !== null,
		);
	}

	#broadcast(session: Session, message: TerminalServerMessage) {
		for (const subscriber of session.subscribers) {
			if (subscriber.ready) subscriber.port.postMessage(message);
			else subscriber.queued.push(message);
		}
	}

	#schedulePersist(session: Session) {
		if (session.persistTimer) clearTimeout(session.persistTimer);
		session.persistTimer = setTimeout(() => {
			session.persistTimer = null;
			this.#persistInBackground(session);
		}, this.#persistDebounceMs);
	}

	#persistInBackground(session: Session) {
		void this.#persist(session).catch((error: unknown) => {
			this.#logger.error("Could not persist terminal history.", {
				sessionId: session.sessionId,
				terminalId: session.terminalId,
				error,
			});
		});
	}

	async #persist(session: Session) {
		if (session.persistTimer) {
			clearTimeout(session.persistTimer);
			session.persistTimer = null;
		}
		const target = historyPath(this.#storageDir, session.sessionId, session.terminalId);
		await atomicWriteFile(target, session.history, {
			encoding: "utf8",
			fsync: false,
			mode: 0o600,
		});
	}
}

export function sessionKey(sessionId: string, terminalId: string): string {
	return `${sessionId}\0${terminalId}`;
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sessionLabel(session: Session): string {
	return session.foregroundProcessLabel ?? session.defaultLabel;
}

function truncateLabel(label: string): string {
	return label.slice(0, MAX_TERMINAL_LABEL_LENGTH);
}
