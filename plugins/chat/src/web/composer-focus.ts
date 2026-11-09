import type { DomainProvider, PluginSdk } from "@kilo-desktop/kernel";
import { Panes, WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";
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
 * - Unsent text is kept per Work Session in main's `kilo.chat/drafts` (panes
 *   report it as it changes), so a pane mounted again, in this window or
 *   another (a pop-out, a reload), starts with it, and a new chat can be
 *   prefilled before its pane exists. A draft is dropped once its text is
 *   sent. What this window wrote is read back at once (`#written`), before
 *   main's copy arrives.
 * - `startNewChat` is the launcher's flow (create the session in a
 *   workspace, open it, add an Agent pane) with the text left unsent.
 */
export class ComposerFocus {
	readonly #mounted = new Set<MountedComposer>();
	/** Drafts this window wrote that main may not have mirrored back yet. */
	readonly #written = new Map<string, { text: string; settled: boolean }>();
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
					const mounted = this.#find(target);
					if (mounted) mounted.setText(appendText(mounted.getText(), text));
					else this.setDraft(target, appendText(this.draft(target), text));
					await this.focusSession(sdk, target);
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

	draft(sessionId: string): string {
		return this.#written.get(sessionId)?.text ?? this.#mainDraft(sessionId);
	}

	setDraft(sessionId: string, text: string): void {
		const drafts = this.#drafts();
		if (!drafts || this.draft(sessionId) === text) return;
		const written = { text, settled: false };
		this.#written.set(sessionId, written);
		void drafts.methods
			.set({ sessionId, text })
			.catch((error: unknown) => console.warn("[kilo.chat] Could not keep the draft", error))
			.finally(() => {
				written.settled = true;
				const current = this.#written.get(sessionId) === written;
				if (current && this.#mainDraft(sessionId) === text) this.#written.delete(sessionId);
			});
	}

	#drafts() {
		return this.#sdk?.domains.get(ComposerDrafts) ?? null;
	}

	#mainDraft(sessionId: string): string {
		return this.#drafts()?.getState().drafts[sessionId]?.text ?? "";
	}

	/**
	 * On main's update, forgets the writes it now has, and those it answered
	 * before (its copy holds them, or a later write from another window).
	 */
	#settleWritten(): void {
		for (const [sessionId, written] of this.#written) {
			if (written.text === this.#mainDraft(sessionId) || written.settled) {
				this.#written.delete(sessionId);
			}
		}
	}

	setFocused(sessionId: string | null): void {
		const provider = this.#provider;
		if (!provider || provider.state.focusedSessionId === sessionId) return;
		provider.setState({ ...provider.state, focusedSessionId: sessionId });
	}

	register(composer: MountedComposer): () => void {
		this.#mounted.add(composer);
		const draft = this.draft(composer.sessionId);
		if (draft && !composer.getText()) composer.setText(draft);
		const pending = this.#pending;
		if (pending?.sessionId === composer.sessionId && pending.paneId === composer.paneId) {
			this.#pending = undefined;
			requestAnimationFrame(composer.focus);
		}
		return () => this.#mounted.delete(composer);
	}

	/** The command: the open session's agent pane, made active (or added), then its composer. */
	focusActive(sdk: PluginSdk): Promise<void> {
		return this.focusSession(sdk, undefined);
	}

	async focusSession(sdk: PluginSdk, sessionId: string | undefined): Promise<void> {
		const target = sessionId ?? activeSession(sdk);
		const panes = sdk.domains.get(Panes);
		if (!target || !panes) return;
		const state = panes.getState().bySession[target];
		const active = state?.panes.find((pane) => pane.id === state.activePaneId);
		// Opening the singleton kind activates the session's agent pane, or adds one.
		const pane =
			active?.kind === AGENT_PANE_KIND
				? active
				: await panes.methods.open({ sessionId: target, kind: AGENT_PANE_KIND });
		const mounted = [...this.#mounted].find(
			(composer) => composer.sessionId === target && composer.paneId === pane.id,
		);
		if (mounted) requestAnimationFrame(mounted.focus);
		else this.#pending = { sessionId: target, paneId: pane.id };
	}

	#find(sessionId: string): MountedComposer | undefined {
		return [...this.#mounted].find((composer) => composer.sessionId === sessionId);
	}
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
