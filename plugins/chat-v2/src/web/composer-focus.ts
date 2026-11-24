import { KernelCommand, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import {
	Panes,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type Pane,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AGENT_PANE_KIND,
	chatPaneObject,
	Composer,
	Drafts,
	type ComposerState,
} from "../contracts";

const COMPOSER_INPUT = '[data-slot="aui_composer-shell"] [contenteditable="true"]';
const COMPOSER_SHELL = '[data-slot="aui_composer-shell"]';
/** On each agent pane's root: the work session it belongs to. */
export const SESSION_ATTRIBUTE = "data-kilo-agent-session";
const FOCUSED_KEY = "composerFocused";

export interface MountedComposer {
	readonly workSessionId: string;
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
 * - Panes register while mounted. A focus or insert asked of a work session whose
 *   agent pane isn't mounted opens (or adds) it and waits for it to mount.
 * - Unsent text is kept per agent pane in main's `kilo.chat/drafts` (panes
 *   report it as it changes), so a pane mounted again, in this window or
 *   another (a pop-out, a reload), starts with it. A work session's own text
 *   (a new chat prefilled before its pane exists) goes to the first of its
 *   agent panes to mount. A draft is dropped once its text is sent. What
 *   this window wrote is read back at once (`#written`), before main's copy
 *   arrives.
 * - `startChat` starts a chat as the New Session page does (a work session
 *   in a workspace with its chat, opened in an agent pane) with the text
 *   left unsent.
 */
export class ComposerFocus {
	readonly #mounted = new Set<MountedComposer>();
	/** Drafts this window wrote that main may not have mirrored back yet, by `draftKey`. */
	readonly #written = new Map<string, WrittenDraft>();
	/** Text given back to a mounted composer that it doesn't show yet, by `draftKey`. */
	readonly #restoring = new Map<string, string>();
	#pending: { workSessionId: string; paneId: string } | undefined;
	#provider: DomainObjectProvider<typeof Composer> | undefined;
	#sdk: PluginSdk | undefined;

	/** Provides the window's `composer` domain object. */
	provide(sdk: PluginSdk): void {
		this.#sdk = sdk;
		let stopSettling = () => {};
		sdk.domainObjects.track(Drafts, {
			added: (drafts) => {
				stopSettling = drafts.subscribe(() => this.#settleWritten());
			},
			removed: () => stopSettling(),
		});
		this.#provider = sdk.domainObjects.provide(Composer, {
			initialState: { focusedWorkSessionId: null },
			methods: {
				focus: ({ workSessionId }) => this.focusSession(sdk, workSessionId),
				insert: async ({ workSessionId, text }) => {
					const target = workSessionId ?? activeWorkSession(sdk);
					if (!target) return;
					const pane = await this.#showAgentPane(sdk, target);
					const mounted = pane ? this.#find(target, pane.id) : undefined;
					if (mounted) mounted.setText(appendText(mounted.getText(), text));
					else this.setDraft(target, appendText(this.draft(target, pane?.id), text), pane?.id);
					if (pane) this.#focusPane(target, pane.id);
				},
				startChat: async ({ text, workspaceId }) => {
					const workSessions = sdk.domainObjects.get(WorkSessions);
					if (!workSessions) throw new Error("Work sessions aren't available.");
					const workspace =
						workspaceId === undefined
							? (sdk.domainObjects.get(Workspaces)?.getState().activeId ?? null)
							: workspaceId;
					const workSession = await workSessions.methods.create({ workspaceId: workspace });
					const chat = await workSessions.methods.createChat({ id: workSession.id });
					await sdk.domainObjects.get(Panes)?.methods.open({
						workSessionId: workSession.id,
						kind: AGENT_PANE_KIND,
						object: chatPaneObject(chat.id),
					});
					this.setDraft(workSession.id, text);
					await sdk.domainObjects
						.get(WorkSessionsWindow)
						?.methods.openWorkSession({ workSessionId: workSession.id });
					await this.focusSession(sdk, workSession.id);
					return { workSessionId: workSession.id };
				},
			},
		});
	}

	get state(): ComposerState {
		return this.#provider?.state ?? { focusedWorkSessionId: null };
	}

	/** The pane's unsent text, or without a pane the work session's own. */
	draft(workSessionId: string, paneId?: string): string {
		return (
			this.#written.get(draftKey(workSessionId, paneId))?.text ??
			this.#mainDraft(workSessionId, paneId)
		);
	}

	setDraft(workSessionId: string, text: string, paneId?: string): void {
		const drafts = this.#drafts();
		if (!drafts || this.draft(workSessionId, paneId) === text) return;
		const key = draftKey(workSessionId, paneId);
		const written: WrittenDraft = { workSessionId, paneId, text, settled: false };
		this.#written.set(key, written);
		void drafts.methods
			.setText({ workSessionId, ...(paneId ? { paneId } : {}), text })
			.catch((error: unknown) => console.warn("[kilo.chat] Could not keep the draft", error))
			.finally(() => {
				written.settled = true;
				const current = this.#written.get(key) === written;
				if (current && this.#mainDraft(workSessionId, paneId) === text) this.#written.delete(key);
			});
	}

	#drafts() {
		return this.#sdk?.domainObjects.get(Drafts) ?? null;
	}

	#mainDraft(workSessionId: string, paneId?: string): string {
		const drafts = this.#drafts()?.getState().drafts[workSessionId];
		return (paneId ? drafts?.panes?.[paneId] : drafts?.text) ?? "";
	}

	/**
	 * On main's update, forgets the writes it now has, and those it answered
	 * before (its copy holds them, or a later write from another window).
	 */
	#settleWritten(): void {
		for (const [key, written] of this.#written) {
			if (
				written.text === this.#mainDraft(written.workSessionId, written.paneId) ||
				written.settled
			) {
				this.#written.delete(key);
			}
		}
	}

	/**
	 * A mounted pane's unsent text, as it changes. Until a composer shows the
	 * text it was given back, it reports its empty text from before: that is
	 * not the person clearing it.
	 */
	reportDraft(workSessionId: string, paneId: string, text: string): void {
		const key = draftKey(workSessionId, paneId);
		const restoring = this.#restoring.get(key);
		if (restoring !== undefined) {
			if (!text) return;
			this.#restoring.delete(key);
			if (text === restoring) return;
		}
		this.setDraft(workSessionId, text, paneId);
	}

	setFocused(workSessionId: string | null): void {
		const provider = this.#provider;
		if (!provider || provider.state.focusedWorkSessionId === workSessionId) return;
		provider.setState({ ...provider.state, focusedWorkSessionId: workSessionId });
	}

	register(composer: MountedComposer): () => void {
		const { workSessionId, paneId } = composer;
		this.#mounted.add(composer);
		if (!composer.getText()) {
			const own = this.draft(workSessionId, paneId);
			const unclaimed = own ? "" : this.draft(workSessionId);
			const restored = own || unclaimed;
			if (restored) {
				this.#restoring.set(draftKey(workSessionId, paneId), restored);
				composer.setText(restored);
			}
			if (unclaimed) {
				this.setDraft(workSessionId, unclaimed, paneId);
				this.setDraft(workSessionId, "");
			}
		}
		const pending = this.#pending;
		if (pending?.workSessionId === composer.workSessionId && pending.paneId === composer.paneId) {
			this.#pending = undefined;
			requestAnimationFrame(composer.focus);
		}
		return () => {
			this.#mounted.delete(composer);
			this.#restoring.delete(draftKey(workSessionId, paneId));
		};
	}

	/** The command: the open work session's agent pane, made active (or added), then its composer. */
	focusActive(sdk: PluginSdk): Promise<void> {
		return this.focusSession(sdk, undefined);
	}

	async focusSession(sdk: PluginSdk, workSessionId: string | undefined): Promise<void> {
		const target = workSessionId ?? activeWorkSession(sdk);
		if (!target) return;
		const pane = await this.#showAgentPane(sdk, target);
		if (pane) this.#focusPane(target, pane.id);
	}

	/** The work session's active agent pane, else its first brought forward, else a new one. */
	async #showAgentPane(sdk: PluginSdk, workSessionId: string): Promise<Pane | null> {
		const panes = sdk.domainObjects.get(Panes);
		if (!panes) return null;
		const state = panes.getState().byWorkSession[workSessionId];
		const active = state?.panes.find((pane) => pane.id === state.activePaneId);
		if (active?.kind === AGENT_PANE_KIND) return active;
		const firstAgent = state?.panes.find((pane) => pane.kind === AGENT_PANE_KIND);
		if (!firstAgent) return panes.methods.open({ workSessionId, kind: AGENT_PANE_KIND });
		await panes.methods.activate({ workSessionId, paneId: firstAgent.id });
		return firstAgent;
	}

	/** Focuses the pane's composer now, or once it mounts. */
	#focusPane(workSessionId: string, paneId: string): void {
		const mounted = this.#find(workSessionId, paneId);
		if (mounted) requestAnimationFrame(mounted.focus);
		else this.#pending = { workSessionId, paneId };
	}

	#find(workSessionId: string, paneId: string): MountedComposer | undefined {
		return [...this.#mounted].find(
			(composer) => composer.workSessionId === workSessionId && composer.paneId === paneId,
		);
	}
}

interface WrittenDraft {
	readonly workSessionId: string;
	readonly paneId: string | undefined;
	readonly text: string;
	settled: boolean;
}

/** `#written`'s key: the pane's draft, or the work session's own. */
function draftKey(workSessionId: string, paneId: string | undefined): string {
	return paneId ? `${workSessionId}\n${paneId}` : workSessionId;
}

function activeWorkSession(sdk: PluginSdk): string | null {
	return sdk.domainObjects.get(WorkSessionsWindow)?.getState().activeWorkSessionId ?? null;
}

/**
 * Keeps `composerFocused` true while a composer in this window has keyboard
 * focus, and the composer domain's `focusedWorkSessionId` on its work session.
 */
export function followComposerFocus(sdk: PluginSdk, focus: ComposerFocus): () => void {
	const update = () => {
		const shell = document.activeElement?.closest(COMPOSER_SHELL);
		const workSessionId =
			shell?.closest(`[${SESSION_ATTRIBUTE}]`)?.getAttribute(SESSION_ATTRIBUTE) ?? null;
		try {
			sdk.context.set(FOCUSED_KEY, shell != null);
			focus.setFocused(shell ? workSessionId : null);
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

/**
 * The window's composers: the `kilo.chat/composer` domain object, the
 * `composerFocused` key and the `focus-composer` command.
 */
export function activateComposerFocus(sdk: PluginSdk, focus: ComposerFocus): void {
	focus.provide(sdk);
	sdk.onDispose(followComposerFocus(sdk, focus));
	sdk.extensions.implement(KernelCommand, "focus-composer", () => focus.focusActive(sdk));
}
