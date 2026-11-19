import { createContext, use, useSyncExternalStore, type ReactNode } from "react";

import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Appearance,
	Navigation,
	Notifications,
	Reading,
	ReadingPresets,
	ReadingUsage,
	Theme,
	type ReadingPatch,
} from "@kilo-desktop/plugin-shell/contracts";
import { Panes, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	countBucket,
	daysSince,
	durationBucket,
	roundToTen,
} from "@kilo-desktop/ui/lib/reading/buckets";
import { resolveReadingTheme } from "@kilo-desktop/ui/lib/reading/reading-theme";
import {
	DEFAULT_READING_SETTINGS,
	type ReadingSettings,
	type ReadingSettingsPatch,
} from "@kilo-desktop/ui/lib/reading/settings";
import type { FocusVisitSummary } from "@kilo-desktop/ui/components/reading/focus-reader";
import type { ReadingSettingName } from "@kilo-desktop/ui/components/reading/reading-control";
import {
	readingPresetSavedTitle,
	readingPresetsControl,
	resetsToPreset,
	type ReadingPresetsControl,
} from "@kilo-desktop/ui/components/reading/reading-presets";
import type { ReadingPresetsState } from "@kilo-desktop/ui/lib/reading/presets";
import { DEFAULT_TEXT_SIZES, type ResolvedColorScheme } from "@kilo-desktop/ui/themes/theme-tokens";

import { ChatFocus, type ChatFocusSession, type FocusEntrySource } from "./chat-focus";
import type { ChatSaved } from "../saved/chat-saved";
import { readingTelemetry, type ControlSurface, type TrackReading } from "./reading-telemetry";

export const FOCUS_TAKEOVER = "kilo.chat/focus";
export const FOCUS_AVAILABLE_KEY = "focusAvailable";
const ROUND_TRIP_MS = 10 * 60_000;

/** Counters for the open Focus visit, beyond what the reader itself counts. */
interface VisitExtras {
	settingsChanged: number;
	savesCreated: number;
	replyFinishedWhileReading: boolean;
	summary: FocusVisitSummary | null;
}

/**
 * Reading Mode in one window of kilo.chat: Focus (its controller, the
 * `toggle-focus` command and `focusAvailable` key, ending Focus when the
 * open work session changes) and the telemetry around it.
 */
export class ChatReading {
	readonly focus = new ChatFocus();
	readonly track: TrackReading;
	/** Saving reply text and bookmarks (set once Saved is activated in this window). */
	saved: ChatSaved | undefined;
	#extras: VisitExtras = this.#newExtras();
	#lastExit: { at: number; workSessionId: string; copied: boolean; prompts: number } | null = null;

	#focusToast: ReactNode | null = null;
	readonly #toastListeners = new Set<(node: ReactNode | null) => void>();

	constructor(readonly sdk: PluginSdk) {
		this.track = readingTelemetry(sdk);
	}

	/** Shows a toast in the Focus reader (in place of its hint), or clears it. */
	showFocusToast(node: ReactNode | null): void {
		this.#focusToast = node;
		for (const listener of [...this.#toastListeners]) listener(node);
	}

	onFocusToast(listener: (node: ReactNode | null) => void): () => void {
		this.#toastListeners.add(listener);
		listener(this.#focusToast);
		return () => this.#toastListeners.delete(listener);
	}

	#newExtras(): VisitExtras {
		return { settingsChanged: 0, savesCreated: 0, replyFinishedWhileReading: false, summary: null };
	}

	/** Enters Focus on a source pane, with telemetry. */
	async enter(
		pane: { workSessionId: string; paneId: string },
		target: ChatFocusSession["target"],
		source: FocusEntrySource,
		context: { blockCount: number; streaming: boolean },
	): Promise<void> {
		this.#extras = this.#newExtras();
		const settings = this.settings();
		const app = this.appTheme();
		const usage = await this.sdk.domainObjects
			.get(ReadingUsage)
			?.methods.recordFocusEntered(undefined)
			.catch(() => null);
		const now = Date.now();
		const lastExit = this.#lastExit;
		if (
			lastExit &&
			lastExit.workSessionId === pane.workSessionId &&
			now - lastExit.at < ROUND_TRIP_MS &&
			lastExit.prompts > 0
		) {
			this.track("focus-round-trip", {
				secondsInChat: Math.round((now - lastExit.at) / 1000),
				promptsSent: countBucket(lastExit.prompts),
				copiedInFocus: lastExit.copied,
			});
		}
		this.track("focus-entered", {
			surface: target.kind,
			source,
			isFirstTime: (usage?.focusVisits ?? 0) === 0,
			lifetimeVisits: countBucket((usage?.focusVisits ?? 0) + 1),
			daysSinceLastVisit: daysSince(usage?.lastFocusEnteredAt ?? null, now),
			secondsSinceLastExit: usage?.lastFocusExit
				? Math.min(86_400, Math.round((now - usage.lastFocusExit.at) / 1000))
				: null,
			blockCount: countBucket(context.blockCount),
			startBlockPct:
				context.blockCount === 0 ? 0 : roundToTen(((target.block + 1) / context.blockCount) * 100),
			streaming: context.streaming,
			readingThemeApplied: resolveReadingTheme(settings, app).applied,
			movesWith: settings.focus.movesWith,
			dimming: roundToTen(settings.focus.dimming),
		});
		await this.focus.enter(pane, target, source);
	}

	/** The reader reported its visit as it unmounted. */
	visitEnded(summary: FocusVisitSummary): void {
		this.#extras.summary = summary;
	}

	noteSettingChanged(): void {
		if (this.focus.session()) this.#extras.settingsChanged += 1;
	}

	noteSaved(): void {
		if (this.focus.session()) this.#extras.savesCreated += 1;
	}

	noteReplyFinished(): void {
		if (this.focus.session()) this.#extras.replyFinishedWhileReading = true;
	}

	/** A prompt was sent: counts towards a round trip back into Focus. */
	notePromptSent(workSessionId: string): void {
		if (this.#lastExit?.workSessionId === workSessionId) this.#lastExit.prompts += 1;
	}

	ended(session: ChatFocusSession, reason: Parameters<ChatFocus["onEnded"]>[1]): void {
		const summary = this.#extras.summary;
		const extras = this.#extras;
		const durationSeconds =
			summary?.durationSeconds ?? Math.round((Date.now() - session.startedAt) / 1000);
		this.track("focus-exited", {
			surface: session.target.kind,
			exitReason: reason,
			duration: durationBucket(durationSeconds),
			durationSeconds: Math.min(durationSeconds, 4 * 3600),
			activeSeconds: Math.min(summary?.activeSeconds ?? 0, 4 * 3600),
			blocksVisited: countBucket(summary?.blocksVisited ?? 0),
			maxBlockPct: roundToTen(summary?.maxBlockPct ?? 0),
			movesByKeys: countBucket(summary?.movesByKeys ?? 0),
			movesByScroll: countBucket(summary?.movesByScroll ?? 0),
			movesByPointer: countBucket(summary?.movesByPointer ?? 0),
			settingsChanged: countBucket(extras.settingsChanged),
			savesCreated: countBucket(extras.savesCreated),
			copies: countBucket(summary?.copies ?? 0),
			typingAttempts: countBucket(summary?.typingAttempts ?? 0),
			findAttempts: countBucket(summary?.findAttempts ?? 0),
			replyFinishedWhileReading: extras.replyFinishedWhileReading,
		});
		this.#lastExit = {
			at: Date.now(),
			workSessionId: session.workSessionId,
			copied: (summary?.copies ?? 0) > 0,
			prompts: 0,
		};
		void this.sdk.domainObjects
			.get(ReadingUsage)
			?.methods.recordFocusExited({ workSessionId: session.workSessionId })
			.catch(() => {});
		this.#extras = this.#newExtras();
	}

	settings(): ReadingSettings {
		return this.sdk.domainObjects.get(Reading)?.getState() ?? DEFAULT_READING_SETTINGS;
	}

	appTheme(): { themeId: string; mode: ResolvedColorScheme } {
		const theme = this.sdk.domainObjects.get(Theme)?.getState();
		return { themeId: theme?.themeId ?? "kilo", mode: theme?.mode ?? "dark" };
	}

	/** The pane ⌘⇧F means in this window: the open work session's active pane, when it is a source. */
	activeSource() {
		const window = this.sdk.domainObjects.get(WorkSessionsWindow)?.getState();
		const workSessionId = window?.activeWorkSessionId;
		if (!workSessionId || window?.view) return undefined;
		const paneId = this.sdk.domainObjects.get(Panes)?.getState().byWorkSession[
			workSessionId
		]?.activePaneId;
		const source = paneId ? this.focus.source(paneId) : undefined;
		return source?.workSessionId === workSessionId ? source : undefined;
	}
}

/**
 * Starts Reading Mode in a window: the take-over link, the command, the
 * context key, and ending Focus when the open work session changes.
 */
export function activateChatReading(sdk: PluginSdk): ChatReading {
	const reading = new ChatReading(sdk);
	const { focus } = reading;
	focus.openTakeover = async (session) => {
		await sdk.domainObjects
			.get(Navigation)
			?.methods.openTakeover({ takeover: FOCUS_TAKEOVER, input: { sessionId: session.id } });
	};
	focus.closeTakeover = async () => {
		await sdk.domainObjects.get(Navigation)?.methods.closeTakeover({});
	};
	focus.onEnded = (session, reason) => reading.ended(session, reason);

	sdk.extensions.implement(KernelCommand, "toggle-focus", async () => {
		if (focus.session()) return focus.exit("shortcut");
		if (sdk.context.get("kernel/secondaryWindow")) {
			reading.track("focus-entry-failed", { reason: "secondary-window" });
			return;
		}
		const source = reading.activeSource();
		const target = source?.available() ? source.targetNearMiddle() : null;
		if (!source || !target) {
			reading.track("focus-entry-failed", { reason: source ? "no-content" : "unavailable" });
			return;
		}
		await reading.enter(source, target, "shortcut", { blockCount: 0, streaming: false });
	});
	for (const id of ["exit-focus", "focus-move"] as const) {
		sdk.extensions.implement(KernelCommand, id, () => undefined);
	}

	let available = false;
	const publish = () => {
		const next = focus.session() !== null || Boolean(reading.activeSource()?.available());
		if (next === available) return;
		available = next;
		sdk.context.set(FOCUS_AVAILABLE_KEY, next);
	};
	sdk.onDispose(focus.subscribe(publish));
	const followWindow = (state: { activeWorkSessionId: string | null; view: string | null }) => {
		const session = focus.session();
		if (session && (state.activeWorkSessionId !== session.workSessionId || state.view !== null)) {
			void focus.exit("session-switched");
		}
		publish();
	};
	for (const domain of [WorkSessionsWindow, Panes] as const) {
		let stop: (() => void) | undefined;
		sdk.domainObjects.track(domain, {
			added: (handle) => {
				stop = handle.subscribe(() => {
					const window = sdk.domainObjects.get(WorkSessionsWindow)?.getState();
					if (window) followWindow(window);
					else publish();
				});
				publish();
			},
			removed: () => {
				stop?.();
				publish();
			},
		});
		sdk.onDispose(() => stop?.());
	}
	sdk.onDispose(() => void focus.exit("window-closed"));
	return reading;
}

interface ChatReadingContextValue {
	readonly reading: ChatReading;
	readonly workSessionId: string;
	readonly paneId: string;
	/** The chat the pane shows, null while a draft. */
	readonly chatId: string | null;
}

const ChatReadingContext = createContext<ChatReadingContextValue | null>(null);

/** Gives a pane's transcript or plan its window's Reading Mode and its own identity. */
export function ChatReadingProvider({
	reading,
	workSessionId,
	paneId,
	chatId = null,
	children,
}: {
	reading: ChatReading | undefined;
	workSessionId: string;
	paneId: string;
	chatId?: string | null;
	children: ReactNode;
}) {
	const value = reading ? { reading, workSessionId, paneId, chatId } : null;
	return <ChatReadingContext value={value}>{children}</ChatReadingContext>;
}

export function useChatReading(): ChatReadingContextValue | null {
	return use(ChatReadingContext);
}

/** The open Focus session, re-rendering as it starts and ends. */
export function useFocusSession(reading: ChatReading | undefined): ChatFocusSession | null {
	return useSyncExternalStore(
		reading?.focus.subscribe ?? noSubscribe,
		reading?.focus.session ?? noSession,
	);
}

export function useFocusContainer(reading: ChatReading | undefined): HTMLElement | null {
	return useSyncExternalStore(
		reading?.focus.subscribe ?? noSubscribe,
		reading?.focus.container ?? noContainer,
	);
}

const noSubscribe = () => () => {};
const noSession = () => null;
const noContainer = () => null;

const selectReading = (state: ReadingSettings) => state;
const selectTheme = (state: { themeId: string; mode: ResolvedColorScheme; shiki: string }) => state;
const selectTextSizes = (state: { textSizes: { ui: number; chat: number } }) => state.textSizes;

export interface ReadingPreferences {
	readonly settings: ReadingSettings;
	readonly appTheme: { themeId: string; mode: ResolvedColorScheme };
	readonly textSizes: { ui: number; chat: number };
	readonly update: (
		patch: ReadingSettingsPatch,
		setting: ReadingSettingName,
		surface: ControlSurface,
	) => void;
	readonly reset: (surface: ControlSurface) => void;
	/** Saved reading presets; undefined without the presets domain object. */
	readonly presets: ReadingPresetsControl | undefined;
}

/** The reading preferences, the app's theme and text sizes, and changing the preferences (with telemetry). */
export function useReadingPreferences(reading: ChatReading | undefined): ReadingPreferences {
	const handle = useDomainObject(Reading);
	const settings = useDomainObjectState(Reading, selectReading) ?? DEFAULT_READING_SETTINGS;
	const theme = useDomainObjectState(Theme, selectTheme);
	const textSizes = useDomainObjectState(Appearance, selectTextSizes) ?? DEFAULT_TEXT_SIZES;
	const presetsHandle = useDomainObject(ReadingPresets);
	const presetsState = useDomainObjectState(ReadingPresets, selectPresets);
	const notifications = useDomainObject(Notifications);
	const update = (
		patch: ReadingSettingsPatch,
		setting: ReadingSettingName,
		surface: ControlSurface,
	) => {
		void handle?.methods.update(patch as ReadingPatch).catch(() => {});
		reading?.noteSettingChanged();
		reading?.track("reading-setting-changed", {
			setting,
			value: settingValue(patch, setting),
			surface,
		});
	};
	const reset = (surface: ControlSurface) => {
		const preset = resetsToPreset(presetsState);
		const done =
			preset && presetsHandle
				? presetsHandle.methods.apply({ id: preset })
				: handle?.methods.reset(undefined);
		void done?.catch(() => {});
		reading?.noteSettingChanged();
		reading?.track("reading-setting-changed", { setting: "reset", value: null, surface });
	};
	const presets =
		presetsHandle && presetsState
			? readingPresetsControl({
					state: presetsState,
					methods: presetsHandle.methods,
					live: settings,
					onSaved: (preset, isDefault) =>
						void notifications?.methods
							.toast({ level: "success", title: readingPresetSavedTitle(preset, isDefault) })
							.catch(() => {}),
				})
			: undefined;
	return {
		settings,
		appTheme: { themeId: theme?.themeId ?? "kilo", mode: theme?.mode ?? "dark" },
		textSizes,
		update,
		reset,
		presets,
	};
}

const selectPresets = (state: ReadingPresetsState) => state;

function settingValue(
	patch: ReadingSettingsPatch,
	setting: ReadingSettingName,
): string | number | null {
	switch (setting) {
		case "theme":
			return patch.themeId ?? "app";
		case "mode":
			return patch.mode ?? null;
		case "text-size":
			return patch.textSizeStep ?? null;
		case "line-spacing":
			return patch.lineSpacing ?? null;
		case "moves-with":
			return patch.focus?.movesWith ?? null;
		case "dimming":
			return patch.focus?.dimming === undefined ? null : roundToTen(patch.focus.dimming);
		default:
			return null;
	}
}
