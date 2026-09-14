import { FitAddon, Terminal, init } from "ghostty-web";

import { terminalFrameConnectSchema, type TerminalTheme } from "../contracts/frame.js";
import {
	TERMINAL_PROTOCOL_VERSION,
	terminalServerMessageSchema,
	type TerminalClientMessage,
	type TerminalServerMessage,
} from "../contracts/session.js";
import { dominantOpaqueColor } from "./edge-background.js";

export interface TerminalFrameElements {
	readonly container: HTMLElement;
	readonly scrollbar: HTMLElement;
	readonly scrollbarThumb: HTMLElement;
	readonly terminalState: HTMLElement;
	readonly status: HTMLElement;
	readonly error: HTMLElement;
	readonly accessibleOutput: HTMLElement;
	readonly restartButton: HTMLButtonElement;
}

/**
 * Owns the embedded terminal frame's Ghostty instance, transferred MessagePort,
 * DOM state, and browser listeners. The controller accepts exactly one trusted
 * parent connection and tears down every owned resource together on page exit.
 */
export class TerminalFrameController {
	readonly #window: Window;
	readonly #documentElement: HTMLElement;
	readonly #trustedParentOrigin: string;
	readonly #elements: TerminalFrameElements;
	readonly #pendingCommands = new Map<string, HTMLButtonElement>();
	#started = false;
	#connected = false;
	#disposed = false;
	#terminal: Terminal | null = null;
	#fitAddon: FitAddon | null = null;
	#port: MessagePort | null = null;
	#snapshotReceived = false;
	#disposeData: { dispose(): void } | null = null;
	#disposeResize: { dispose(): void } | null = null;
	#disposeScroll: { dispose(): void } | null = null;
	#resizeObserver: ResizeObserver | null = null;
	#gutterSyncFrame: number | null = null;
	#scrollbarSyncFrame: number | null = null;
	#scrollbarDrag: { readonly pointerId: number; readonly offset: number } | null = null;

	constructor(options: {
		readonly hostWindow: Window;
		readonly documentElement: HTMLElement;
		readonly trustedParentOrigin: string;
		readonly elements: TerminalFrameElements;
	}) {
		this.#window = options.hostWindow;
		this.#documentElement = options.documentElement;
		this.#trustedParentOrigin = options.trustedParentOrigin;
		this.#elements = options.elements;
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.#elements.restartButton.addEventListener("click", this.#restartTerminal);
		this.#elements.scrollbar.addEventListener("pointerdown", this.#onScrollbarPointerDown);
		this.#elements.scrollbar.addEventListener("pointermove", this.#onScrollbarPointerMove);
		this.#elements.scrollbar.addEventListener("pointerup", this.#onScrollbarPointerUp);
		this.#elements.scrollbar.addEventListener("lostpointercapture", this.#onScrollbarPointerUp);
		this.#elements.scrollbar.addEventListener("keydown", this.#onScrollbarKeyDown);
		this.#window.addEventListener("message", this.#onParentMessage);
		this.#window.addEventListener("pagehide", this.#onPageHide, { once: true });
		this.#window.parent.postMessage(
			{ type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
			this.#trustedParentOrigin,
		);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#window.removeEventListener("message", this.#onParentMessage);
		this.#window.removeEventListener("pagehide", this.#onPageHide);
		this.#elements.restartButton.removeEventListener("click", this.#restartTerminal);
		this.#elements.scrollbar.removeEventListener("pointerdown", this.#onScrollbarPointerDown);
		this.#elements.scrollbar.removeEventListener("pointermove", this.#onScrollbarPointerMove);
		this.#elements.scrollbar.removeEventListener("pointerup", this.#onScrollbarPointerUp);
		this.#elements.scrollbar.removeEventListener("lostpointercapture", this.#onScrollbarPointerUp);
		this.#elements.scrollbar.removeEventListener("keydown", this.#onScrollbarKeyDown);
		this.#resizeObserver?.disconnect();
		if (this.#gutterSyncFrame !== null) cancelAnimationFrame(this.#gutterSyncFrame);
		if (this.#scrollbarSyncFrame !== null) cancelAnimationFrame(this.#scrollbarSyncFrame);
		this.#disposeData?.dispose();
		this.#disposeResize?.dispose();
		this.#disposeScroll?.dispose();
		this.#fitAddon?.dispose();
		this.#terminal?.dispose();
		this.#port?.close();
	}

	readonly #onPageHide = () => this.dispose();

	readonly #onParentMessage = (event: MessageEvent<unknown>) => {
		if (event.source !== this.#window.parent || event.origin !== this.#trustedParentOrigin) return;
		const connectMessage = terminalFrameConnectSchema.safeParse(event.data);
		if (!connectMessage.success || this.#connected || event.ports.length !== 1) return;
		this.#connected = true;
		void this.#connect(event.ports[0]!, connectMessage.data.theme).catch((error: unknown) => {
			this.#showError(error instanceof Error ? error.message : "Could not initialize ghostty-web.");
			this.#setStatus("error", null, null);
		});
	};

	readonly #restartTerminal = () => {
		const button = this.#elements.restartButton;
		if (!this.#snapshotReceived || button.disabled) return;
		const requestId = this.#window.crypto.randomUUID();
		button.disabled = true;
		this.#pendingCommands.set(requestId, button);
		this.#send({ type: "restart", requestId });
	};

	async #connect(messagePort: MessagePort, theme: TerminalTheme): Promise<void> {
		this.#port = messagePort;
		this.#applyTheme(theme);
		await init();
		if (this.#disposed) return;
		this.#terminal = new Terminal({
			cursorBlink: true,
			cursorStyle: "bar",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 13,
			theme: Object.fromEntries(Object.entries(theme).filter(([, value]) => value !== undefined)),
			scrollback: 5_000,
		});
		// ghostty-web 0.4 paints its indicator over the last terminal cells and has
		// no public visibility option. Keep its scrolling model, but render the
		// indicator as an app-owned DOM scrollbar in the reserved gutter instead.
		Reflect.set(this.#terminal, "showScrollbar", () => undefined);
		this.#fitAddon = new FitAddon();
		this.#terminal.loadAddon(this.#fitAddon);
		this.#terminal.open(this.#elements.container);
		// Replay must use the visible geometry. Replaying into Ghostty's default
		// 80-column buffer and fitting afterward corrupts restored alternate screens.
		this.#fitAddon.fit();
		this.#scheduleGutterBackgroundSync();
		this.#disposeScroll = this.#terminal.onScroll(() => this.#scheduleScrollbarSync());
		this.#scheduleScrollbarSync();
		this.#port.onmessage = ({ data }: MessageEvent<unknown>) => {
			const parsed = terminalServerMessageSchema.safeParse(data);
			if (!parsed.success) {
				this.#showError("The terminal host sent an invalid message.");
				return;
			}
			this.#handleServerMessage(parsed.data);
		};
		this.#port.start();
	}

	#applyTheme(theme: TerminalTheme): void {
		this.#documentElement.style.setProperty("--terminal-background", theme.background);
		this.#documentElement.style.setProperty("--terminal-foreground", theme.foreground);
		this.#documentElement.style.setProperty("--terminal-gutter-background", theme.background);
		this.#documentElement.style.setProperty("--terminal-scrollbar-thumb", theme.scrollbarThumb);
		this.#documentElement.style.setProperty(
			"--terminal-scrollbar-thumb-hover",
			theme.scrollbarThumbHover,
		);
	}

	#syncGutterBackground(): void {
		const canvas = this.#elements.container.querySelector("canvas");
		if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) return;
		try {
			const context = canvas.getContext("2d");
			const sampleWidth = Math.min(4, canvas.width);
			const color = context
				? dominantOpaqueColor(
						context.getImageData(canvas.width - sampleWidth, 0, sampleWidth, canvas.height).data,
					)
				: null;
			if (color) this.#documentElement.style.setProperty("--terminal-gutter-background", color);
		} catch {
			// Theme background remains the safe fallback when the canvas cannot be sampled.
		}
	}

	#scheduleGutterBackgroundSync(): void {
		if (this.#gutterSyncFrame !== null) return;
		this.#gutterSyncFrame = requestAnimationFrame(() => {
			this.#gutterSyncFrame = null;
			this.#syncGutterBackground();
		});
	}

	readonly #onScrollbarPointerDown = (event: PointerEvent) => {
		if (!this.#terminal || event.button !== 0) return;
		event.preventDefault();
		const { scrollbar, scrollbarThumb } = this.#elements;
		const track = scrollbar.getBoundingClientRect();
		const thumb = scrollbarThumb.getBoundingClientRect();
		const offset =
			event.target === scrollbarThumb
				? event.clientY - thumb.top
				: Math.min(thumb.height / 2, Math.max(0, event.clientY - track.top));
		this.#scrollbarDrag = { pointerId: event.pointerId, offset };
		scrollbar.setPointerCapture(event.pointerId);
		this.#scrollTerminalToPointer(event.clientY);
	};

	readonly #onScrollbarPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== this.#scrollbarDrag?.pointerId) return;
		this.#scrollTerminalToPointer(event.clientY);
	};

	readonly #onScrollbarPointerUp = (event: PointerEvent) => {
		if (event.pointerId !== this.#scrollbarDrag?.pointerId) return;
		this.#scrollbarDrag = null;
	};

	readonly #onScrollbarKeyDown = (event: KeyboardEvent) => {
		if (!this.#terminal) return;
		switch (event.key) {
			case "ArrowUp":
				this.#terminal.scrollLines(-1);
				break;
			case "ArrowDown":
				this.#terminal.scrollLines(1);
				break;
			case "PageUp":
				this.#terminal.scrollPages(-1);
				break;
			case "PageDown":
				this.#terminal.scrollPages(1);
				break;
			case "Home":
				this.#terminal.scrollToTop();
				break;
			case "End":
				this.#terminal.scrollToBottom();
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	#scrollTerminalToPointer(clientY: number): void {
		if (!this.#terminal || !this.#scrollbarDrag) return;
		const { scrollbar, scrollbarThumb } = this.#elements;
		const scrollbackLength = this.#terminal.getScrollbackLength();
		const availableHeight = scrollbar.clientHeight - scrollbarThumb.offsetHeight;
		if (scrollbackLength === 0 || availableHeight <= 0) return;
		const top = Math.min(
			availableHeight,
			Math.max(0, clientY - scrollbar.getBoundingClientRect().top - this.#scrollbarDrag.offset),
		);
		const lineFromTop = Math.round((top / availableHeight) * scrollbackLength);
		this.#terminal.scrollToLine(scrollbackLength - lineFromTop);
	}

	#scheduleScrollbarSync(): void {
		if (this.#scrollbarSyncFrame !== null) return;
		this.#scrollbarSyncFrame = requestAnimationFrame(() => {
			this.#scrollbarSyncFrame = null;
			this.#syncScrollbar();
		});
	}

	#syncScrollbar(): void {
		if (!this.#terminal) return;
		const { scrollbar, scrollbarThumb } = this.#elements;
		const scrollbackLength = this.#terminal.getScrollbackLength();
		scrollbar.hidden = scrollbackLength === 0;
		if (scrollbackLength === 0) return;

		const visibleRows = Math.max(1, this.#terminal.rows);
		const thumbHeight = Math.min(
			scrollbar.clientHeight,
			Math.max(20, (scrollbar.clientHeight * visibleRows) / (scrollbackLength + visibleRows)),
		);
		scrollbarThumb.style.height = `${String(thumbHeight)}px`;
		const availableHeight = scrollbar.clientHeight - thumbHeight;
		const lineFromTop = scrollbackLength - this.#terminal.viewportY;
		const top = (lineFromTop / scrollbackLength) * availableHeight;
		scrollbarThumb.style.transform = `translateY(${String(top)}px)`;
		scrollbar.setAttribute("aria-valuemin", "0");
		scrollbar.setAttribute("aria-valuemax", String(scrollbackLength));
		scrollbar.setAttribute("aria-valuenow", String(lineFromTop));
	}

	#send(message: TerminalClientMessage): void {
		this.#port?.postMessage(message);
	}

	#enableLiveInput(): void {
		if (!this.#terminal || !this.#fitAddon || this.#snapshotReceived) return;
		this.#snapshotReceived = true;
		this.#disposeData = this.#terminal.onData((data) => this.#send({ type: "input", data }));
		this.#disposeResize = this.#terminal.onResize(({ cols, rows }) => {
			this.#send({ type: "resize", cols, rows });
			this.#scheduleScrollbarSync();
		});
		this.#resizeObserver = new ResizeObserver(() => {
			this.#fitAddon?.fit();
			this.#scheduleScrollbarSync();
		});
		this.#resizeObserver.observe(this.#elements.container);
		this.#fitAddon.fit();
		this.#send({ type: "resize", cols: this.#terminal.cols, rows: this.#terminal.rows });
		this.#elements.container.setAttribute("aria-busy", "false");
	}

	#handleServerMessage(message: TerminalServerMessage): void {
		if (!this.#terminal) return;
		switch (message.type) {
			case "snapshot":
				this.#publishLabel(message.label);
				this.#setStatus(message.status, message.exitCode, message.exitSignal);
				if (message.history) {
					this.#fitAddon?.fit();
					this.#terminal.write(message.history);
					this.#scheduleGutterBackgroundSync();
					this.#scheduleScrollbarSync();
					this.#appendAccessibleOutput(message.history);
				}
				if (message.status !== "exited" && message.status !== "closed") this.#enableLiveInput();
				break;
			case "output":
				if (!this.#snapshotReceived) return;
				this.#terminal.write(message.data);
				this.#scheduleGutterBackgroundSync();
				this.#scheduleScrollbarSync();
				this.#appendAccessibleOutput(message.data);
				break;
			case "cleared":
				this.#terminal.clear();
				this.#scheduleGutterBackgroundSync();
				this.#scheduleScrollbarSync();
				this.#elements.accessibleOutput.textContent = "";
				break;
			case "label":
				this.#publishLabel(message.label);
				break;
			case "status":
				this.#setStatus(message.status, message.exitCode ?? null, message.exitSignal ?? null);
				break;
			case "error":
				this.#showError(message.message);
				break;
			case "ack": {
				const button = this.#pendingCommands.get(message.requestId);
				if (button) button.disabled = false;
				this.#pendingCommands.delete(message.requestId);
				if (!message.ok) this.#showError(message.error ?? "The terminal command failed.");
				break;
			}
		}
	}

	#publishLabel(label: string): void {
		this.#window.parent.postMessage(
			{ type: "terminal:label", protocolVersion: TERMINAL_PROTOCOL_VERSION, label },
			this.#trustedParentOrigin,
		);
	}

	#appendAccessibleOutput(data: string): void {
		const escape = String.fromCharCode(0x1b);
		const bell = String.fromCharCode(0x07);
		const osc = new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, "g");
		const csi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "g");
		const plain = [...data.replace(osc, "").replace(csi, "")]
			.filter((character) => {
				const code = character.charCodeAt(0);
				return (
					(code > 0x1f && code !== 0x7f) ||
					character === "\n" ||
					character === "\r" ||
					character === "\t"
				);
			})
			.join("");
		this.#elements.accessibleOutput.textContent =
			`${this.#elements.accessibleOutput.textContent ?? ""}${plain}`.slice(-8_192);
	}

	#setStatus(status: string, exitCode: number | null, exitSignal: number | null): void {
		this.#elements.terminalState.hidden = status !== "exited" && status !== "error";
		this.#elements.status.textContent =
			status === "running"
				? "Running"
				: status === "starting"
					? "Starting…"
					: status === "exited"
						? `Exited${exitSignal !== null ? ` (signal ${exitSignal})` : exitCode !== null ? ` (${exitCode})` : ""}`
						: status === "error"
							? "Error"
							: "Closed";
	}

	#showError(message: string): void {
		this.#elements.error.textContent = message;
		this.#elements.error.hidden = false;
	}
}
