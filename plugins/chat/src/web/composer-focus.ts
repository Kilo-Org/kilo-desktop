import type { DomainProvider, PluginSdk } from "@kilo-desktop/kernel";
import { Panes, WorkSessions, type Pane } from "@kilo-desktop/plugin-sessions/contracts";
import { Workbench } from "@kilo-desktop/plugin-workbench/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { AGENT_PANE_KIND, Composer, ComposerDrafts, type ComposerState } from "../contracts";

const COMPOSER_INPUT = '[data-slot="aui_composer-shell"] [contenteditable="true"]';
const COMPOSER_SHELL = '[data-slot="aui_composer-shell"]';
/** On each agent pane's root: the Work Session it belongs to. */
export const SESSION_ATTRIBUTE = "data-kilo-agent-session";
const FOCUSED_KEY = "composerFocused";

export interface MountedComposer {
	readonly sessionId: string;
	readonly paneId: string;
	readonly focus: () => void;
	readonly getText: () => string;
	readonly setText: (text: string) => void;
}

/** Focuses the composer inside `root`, if it shows one. */
export function focusComposerIn(root: HTMLElement | null): boolean {
	const input = root?.querySelector<HTMLElement>(COMPOSER_INPUT);
	if (!input) return false;
	input.focus({ preventScroll: true });
	return true;
}

/** `text` after `current`, separated by a space or line break when it needs one. */
export function appendText(current: string, text: string): string {
	if (!current) return text;
	return /\s$/u.test(current) ? `${current}${text}` : `${current} ${text}`;
}

/**
 * This window's composers: the `kilo.chat/composer` domain object and the
 * `focus-composer` command over the agent panes mounted here.
 *
 * - Panes register while mounted. A focus or insert asked of a session whose
 *   agent pane isn't mounted opens (or adds) it and waits for it to mount.
 * - Unsent text is kept per agent pane in main's `kilo.chat/drafts` (panes
 *   report it as it changes), so a pane mounted again, in this window or
 *   another (a pop-out, a reload), starts with it. A session's own text
 *   (a new chat prefilled before its pane exists) goes to the first of its
 *   agent panes to mount. A draft is dropped once its text is sent. What
 *   this window wrote is read back at once (`#written`), before main's copy
 *   arrives.
 * - `startNewChat` is the launcher's flow (create the session in a
 *   workspace, open it, add an Agent pane) with the text left unsent.
 */
export class ComposerFocus {
	readonly #mounted = new Set<MountedComposer>();
	/** Drafts this window wrote that main may not have mirrored back yet, by `draftKey`. */
	readonly #written = new Map<string, WrittenDraft>();
	/** Text given back to a mounted composer that it doesn't show yet, by `draftKey`. */
	readonly #restoring = new Map<string, string>();
	#pending: { sessionId: string; paneId: string } | undefined;
	#provider: DomainProvider<typeof Composer> | undefined;
	#sdk: PluginSdk | undefined;

	/** Provides the window's `composer` domain object. */
	provide(sdk: PluginSdk): void {
		this.#sdk = sdk;
		let stopSettling = () => {};
		sdk.domains.track(ComposerDrafts, {
			added: (drafts) => {
				stopSettling = drafts.subscribe(() => this.#settleWritten());
			},
			removed: () => stopSettling(),
		});
		this.#provider = sdk.domains.provide(Composer, {
			initialState: { focusedSessionId: null },
			methods: {
				focus: ({ sessionId }) => this.focusSession(sdk, sessionId),
				insert: async ({ sessionId, text }) => {
					const target = sessionId ?? activeSession(sdk);
					if (!target) return;
					const pane = await this.#showAgentPane(sdk, target);
					const mounted = pane ? this.#find(target, pane.id) : undefined;
					if (mounted) mounted.setText(appendText(mounted.getText(), text));
					else this.setDraft(target, appendText(this.draft(target, pane?.id), text), pane?.id);
					if (pane) this.#focusPane(target, pane.id);
				},
				startNewChat: async ({ text, workspaceId }) => {
					const sessions = sdk.domains.get(WorkSessions);
					if (!sessions) throw new Error("Sessions aren't available.");
					const workspace =
						workspaceId === undefined
							? (sdk.domains.get(Workspaces)?.getState().activeId ?? null)
							: workspaceId;
					const session = await sessions.methods.create({ workspaceId: workspace });
					this.setDraft(session.id, text);
					await sdk.domains.get(Workbench)?.methods.openSession({ sessionId: session.id });
					await this.focusSession(sdk, session.id);
					return { sessionId: session.id };
				},
			},
		});
	}

	get state(): ComposerState {
		return this.#provider?.state ?? { focusedSessionId: null };
	}

	/** The pane's unsent text, or without a pane the session's own. */
	draft(sessionId: string, paneId?: string): string {
		return (
			this.#written.get(draftKey(sessionId, paneId))?.text ?? this.#mainDraft(sessionId, paneId)
		);
	}

	setDraft(sessionId: string, text: string, paneId?: string): void {
		const drafts = this.#drafts();
		if (!drafts || this.draft(sessionId, paneId) === text) return;
		const key = draftKey(sessionId, paneId);
		const written: WrittenDraft = { sessionId, paneId, text, settled: false };
		this.#written.set(key, written);
		void drafts.methods
			.set({ sessionId, ...(paneId ? { paneId } : {}), text })
			.catch((error: unknown) => console.warn("[kilo.chat] Could not keep the draft", error))
			.finally(() => {
				written.settled = true;
				const current = this.#written.get(key) === written;
				if (current && this.#mainDraft(sessionId, paneId) === text) this.#written.delete(key);
			});
	}

	#drafts() {
		return this.#sdk?.domains.get(ComposerDrafts) ?? null;
	}

	#mainDraft(sessionId: string, paneId?: string): string {
		const session = this.#drafts()?.getState().drafts[sessionId];
		return (paneId ? session?.panes?.[paneId] : session?.text) ?? "";
	}

	/**
	 * On main's update, forgets the writes it now has, and those it answered
	 * before (its copy holds them, or a later write from another window).
	 */
	#settleWritten(): void {
		for (const [key, written] of this.#written) {
			if (written.text === this.#mainDraft(written.sessionId, written.paneId) || written.settled) {
				this.#written.delete(key);
			}
		}
	}

	/**
	 * A mounted pane's unsent text, as it changes. Until a composer shows the
	 * text it was given back, it reports its empty text from before: that is
	 * not the person clearing it.
	 */
	reportDraft(sessionId: string, paneId: string, text: string): void {
		const key = draftKey(sessionId, paneId);
		const restoring = this.#restoring.get(key);
		if (restoring !== undefined) {
			if (!text) return;
			this.#restoring.delete(key);
			if (text === restoring) return;
		}
		this.setDraft(sessionId, text, paneId);
	}

	setFocused(sessionId: string | null): void {
		const provider = this.#provider;
		if (!provider || provider.state.focusedSessionId === sessionId) return;
		provider.setState({ ...provider.state, focusedSessionId: sessionId });
	}

	register(composer: MountedComposer): () => void {
		const { sessionId, paneId } = composer;
		this.#mounted.add(composer);
		if (!composer.getText()) {
			const own = this.draft(sessionId, paneId);
			const unclaimed = own ? "" : this.draft(sessionId);
			const restored = own || unclaimed;
			if (restored) {
				this.#restoring.set(draftKey(sessionId, paneId), restored);
				composer.setText(restored);
			}
			if (unclaimed) {
				this.setDraft(sessionId, unclaimed, paneId);
				this.setDraft(sessionId, "");
			}
		}
		const pending = this.#pending;
		if (pending?.sessionId === composer.sessionId && pending.paneId === composer.paneId) {
			this.#pending = undefined;
			requestAnimationFrame(composer.focus);
		}
		return () => {
			this.#mounted.delete(composer);
			this.#restoring.delete(draftKey(sessionId, paneId));
		};
	}

	/** The command: the open session's agent pane, made active (or added), then its composer. */
	focusActive(sdk: PluginSdk): Promise<void> {
		return this.focusSession(sdk, undefined);
	}

	async focusSession(sdk: PluginSdk, sessionId: string | undefined): Promise<void> {
		const target = sessionId ?? activeSession(sdk);
		if (!target) return;
		const pane = await this.#showAgentPane(sdk, target);
		if (pane) this.#focusPane(target, pane.id);
	}

	/** The session's active agent pane, else its first brought forward, else a new one. */
	async #showAgentPane(sdk: PluginSdk, sessionId: string): Promise<Pane | null> {
		const panes = sdk.domains.get(Panes);
		if (!panes) return null;
		const state = panes.getState().bySession[sessionId];
		const active = state?.panes.find((pane) => pane.id === state.activePaneId);
		if (active?.kind === AGENT_PANE_KIND) return active;
		const firstAgent = state?.panes.find((pane) => pane.kind === AGENT_PANE_KIND);
		if (!firstAgent) return panes.methods.open({ sessionId, kind: AGENT_PANE_KIND });
		await panes.methods.activate({ sessionId, paneId: firstAgent.id });
		return firstAgent;
	}

	/** Focuses the pane's composer now, or once it mounts. */
	#focusPane(sessionId: string, paneId: string): void {
		const mounted = this.#find(sessionId, paneId);
		if (mounted) requestAnimationFrame(mounted.focus);
		else this.#pending = { sessionId, paneId };
	}

	#find(sessionId: string, paneId: string): MountedComposer | undefined {
		return [...this.#mounted].find(
			(composer) => composer.sessionId === sessionId && composer.paneId === paneId,
		);
	}
}

interface WrittenDraft {
	readonly sessionId: string;
	readonly paneId: string | undefined;
	readonly text: string;
	settled: boolean;
}

/** `#written`'s key: the pane's draft, or the session's own. */
function draftKey(sessionId: string, paneId: string | undefined): string {
	return paneId ? `${sessionId}\n${paneId}` : sessionId;
}

function activeSession(sdk: PluginSdk): string | null {
	return sdk.domains.get(Workbench)?.getState().activeSessionId ?? null;
}

/**
 * Keeps `composerFocused` true while a composer in this window has keyboard
 * focus, and the composer domain's `focusedSessionId` on its session.
 */
export function followComposerFocus(sdk: PluginSdk, focus: ComposerFocus): () => void {
	const update = () => {
		const shell = document.activeElement?.closest(COMPOSER_SHELL);
		const sessionId =
			shell?.closest(`[${SESSION_ATTRIBUTE}]`)?.getAttribute(SESSION_ATTRIBUTE) ?? null;
		try {
			sdk.context.set(FOCUSED_KEY, shell != null);
			focus.setFocused(shell ? sessionId : null);
		} catch {
			// The plugin is deactivating; its keys go with it.
		}
	};
	document.addEventListener("focusin", update);
	document.addEventListener("focusout", update);
	update();
	return () => {
		document.removeEventListener("focusin", update);
		document.removeEventListener("focusout", update);
	};
}
