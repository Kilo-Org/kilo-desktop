/** What a Focus target needs: which kind of content, and the block to start on. */
export interface FocusTargetBase {
	readonly kind: string;
	readonly block: number;
}

/** How Focus was entered; "shortcut" is the toggle-focus command, from its keybinding or the palette. */
export type FocusEntrySource = "rail" | "shortcut" | "reading-control";

export type FocusExitReason =
	| "escape"
	| "exit-button"
	| "shortcut"
	| "reading-control"
	| "session-switched"
	| "pane-closed"
	| "window-closed"
	| "other";

export interface ReadingFocusSession<TTarget extends FocusTargetBase = FocusTargetBase> {
	readonly id: number;
	readonly workSessionId: string;
	readonly paneId: string;
	readonly target: TTarget;
	readonly source: FocusEntrySource;
	readonly startedAt: number;
}

/** A pane that can be read in Focus (a reply, a plan, a Markdown file). */
export interface FocusSource<TTarget extends FocusTargetBase = FocusTargetBase> {
	readonly workSessionId: string;
	readonly paneId: string;
	readonly kind: TTarget["kind"];
	/** Whether there is anything to read. */
	available(): boolean;
	/** Where ⌘⇧F and the Focus switch enter: the block nearest the middle of what the pane shows. */
	targetNearMiddle(): TTarget | null;
	/** Scrolls the pane to a block, on the way out of Focus. */
	reveal(target: TTarget): void;
	/** What entering at `target` reads, for telemetry: its block count and whether it is still streaming. */
	entryContext(target: TTarget): FocusEntryContext;
}

export interface FocusEntryContext {
	readonly blockCount: number;
	readonly streaming: boolean;
}

type Listener = () => void;

/**
 * Focus in one window, for one plugin. Panes register as sources while
 * mounted; entering records the session here and asks kilo.shell to show
 * the plugin's Focus take-over, whose component publishes the container
 * the source pane portals its content into (so the content keeps the pane's
 * runtime and providers and keeps streaming). Exiting closes the take-over;
 * the take-over's unmount ends the session, however it closed, and the pane
 * is scrolled to the last focused block. The take-over `hold`s its session
 * while mounted and the session ends only once no hold is taken back within
 * the same task: React StrictMode unmounts and remounts effects at once, and
 * that must not end the session the remounted take-over is about to show.
 */
export class ReadingFocusController<TTarget extends FocusTargetBase = FocusTargetBase> {
	readonly #sources = new Map<string, FocusSource<TTarget>>();
	readonly #listeners = new Set<Listener>();
	#session: ReadingFocusSession<TTarget> | null = null;
	#container: HTMLElement | null = null;
	#nextId = 1;
	/** Set by the window: shows / closes the take-over. */
	openTakeover: (session: ReadingFocusSession<TTarget>) => Promise<void> = async () => {};
	closeTakeover: () => Promise<void> = async () => {};
	/** Called when a session ends, for telemetry and remembering the exit. */
	onEnded: (session: ReadingFocusSession<TTarget>, reason: FocusExitReason, block: number) => void =
		() => {};
	#exitReason: FocusExitReason | null = null;
	#focusedBlock = 0;
	#focusedTarget: TTarget | null = null;
	readonly #holds = new Map<number, number>();

	subscribe = (listener: Listener): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	#notify(): void {
		for (const listener of [...this.#listeners]) listener();
	}

	session = (): ReadingFocusSession<TTarget> | null => this.#session;
	container = (): HTMLElement | null => this.#container;

	register(source: FocusSource<TTarget>): () => void {
		this.#sources.set(source.paneId, source);
		this.#notify();
		return () => {
			if (this.#sources.get(source.paneId) !== source) return;
			this.#sources.delete(source.paneId);
			if (this.#session?.paneId === source.paneId) void this.exit("pane-closed");
			this.#notify();
		};
	}

	/** Sources changed what they offer (a first reply arrived): re-evaluate availability. */
	changed(): void {
		this.#notify();
	}

	source(paneId: string): FocusSource<TTarget> | undefined {
		return this.#sources.get(paneId);
	}

	async enter(
		pane: { workSessionId: string; paneId: string },
		target: TTarget,
		source: FocusEntrySource,
	): Promise<void> {
		const session: ReadingFocusSession<TTarget> = {
			id: this.#nextId++,
			workSessionId: pane.workSessionId,
			paneId: pane.paneId,
			target,
			source,
			startedAt: Date.now(),
		};
		this.#session = session;
		this.#exitReason = null;
		this.#focusedBlock = target.block;
		this.#focusedTarget = null;
		this.#notify();
		await this.openTakeover(session);
	}

	/** Asks the take-over to close; the session ends when it unmounts. */
	async exit(reason: FocusExitReason): Promise<void> {
		if (!this.#session) return;
		this.#exitReason ??= reason;
		await this.closeTakeover();
	}

	/** The take-over's container for the source pane's content (null on unmount). */
	setContainer(container: HTMLElement | null): void {
		if (this.#container === container) return;
		this.#container = container;
		this.#notify();
	}

	/**
	 * The block now focused, by its index in what Focus shows; with `target`
	 * when that spans more than the entered target (a whole chat), so leaving
	 * takes the pane back to it.
	 */
	focusedBlock(index: number, target?: TTarget): void {
		this.#focusedBlock = index;
		this.#focusedTarget = target ?? null;
	}

	/**
	 * The take-over showing `sessionId` holds it while mounted; the returned
	 * release ends the session unless it is held again before the next microtask.
	 */
	hold(sessionId: number): () => void {
		this.#holds.set(sessionId, (this.#holds.get(sessionId) ?? 0) + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#holds.set(sessionId, this.#holds.get(sessionId)! - 1);
			queueMicrotask(() => {
				if (this.#holds.get(sessionId) !== 0) return;
				this.#holds.delete(sessionId);
				this.ended(sessionId);
			});
		};
	}

	/** The take-over unmounted: end the session and take the pane back to where reading stopped. */
	ended(sessionId: number): void {
		const session = this.#session;
		if (!session || session.id !== sessionId) return;
		this.#session = null;
		this.#container = null;
		const reason = this.#exitReason ?? "other";
		this.#exitReason = null;
		const target = this.#focusedTarget ?? { ...session.target, block: this.#focusedBlock };
		this.#focusedTarget = null;
		this.#notify();
		this.onEnded(session, reason, this.#focusedBlock);
		if (reason !== "pane-closed" && reason !== "session-switched") {
			requestAnimationFrame(() => this.#sources.get(session.paneId)?.reveal(target));
		}
	}
}
