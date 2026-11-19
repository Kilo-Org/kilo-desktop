import {
	createContext,
	use,
	useEffect,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
	type FC,
	type ReactNode,
} from "react";

import {
	formatChord,
	KernelCommand,
	KernelTelemetry,
	parseChord,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import {
	Appearance,
	Navigation,
	Notifications,
	Reading,
	ReadingPresets,
	ReadingUsage,
	Theme,
	type ReadingPatch,
	type TakeoverProps,
} from "@kilo-desktop/plugin-shell/contracts";
import { Panes, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";
import { FocusReader } from "@kilo-desktop/ui/components/reading/focus-reader";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import {
	ReadingControl,
	type ReadingSettingName,
} from "@kilo-desktop/ui/components/reading/reading-control";
import {
	readingPresetSavedTitle,
	readingPresetsControl,
	resetsToPreset,
} from "@kilo-desktop/ui/components/reading/reading-presets";
import type { ReadingPresetsState } from "@kilo-desktop/ui/lib/reading/presets";
import {
	countBucket,
	daysSince,
	durationBucket,
	roundToTen,
} from "@kilo-desktop/ui/lib/reading/buckets";
import {
	ReadingFocusController,
	type FocusEntrySource,
	type ReadingFocusSession,
} from "@kilo-desktop/ui/lib/reading/focus-controller";
import { rememberExcerpt } from "@kilo-desktop/ui/lib/reading/excerpts";
import { readingThemeStyle, resolveReadingTheme } from "@kilo-desktop/ui/lib/reading/reading-theme";
import {
	DEFAULT_READING_SETTINGS,
	type ReadingSettings,
	type ReadingSettingsPatch,
} from "@kilo-desktop/ui/lib/reading/settings";
import { readingTypography } from "@kilo-desktop/ui/lib/reading/typography";
import { useDimmingPreview } from "@kilo-desktop/ui/lib/reading/use-dimming-preview";
import type { FocusVisitSummary } from "@kilo-desktop/ui/components/reading/focus-reader";
import { DEFAULT_TEXT_SIZES, type ResolvedColorScheme } from "@kilo-desktop/ui/themes/theme-tokens";

export type FileFocusTarget = { readonly kind: "file"; readonly block: number };
export type FilesFocusSession = ReadingFocusSession<FileFocusTarget>;

export const FILES_FOCUS_TAKEOVER = "kilo.files/focus";
const FILES_TOGGLE_FOCUS = "kilo.files/toggle-focus";
export const FOCUS_FOOTNOTE = "Works in the chat, plans and Markdown files. Esc turns it off.";

/** kilo.files' Reading Mode events (declared in plugin.json); content-free, see docs/telemetry/reading-mode.md. */
type FilesReadingEvent =
	| "focus-entered"
	| "focus-exited"
	| "focus-entry-failed"
	| "reading-control-opened"
	| "reading-setting-changed";

/**
 * Reading Mode for kilo.files in one window: Focus over a rendered Markdown
 * preview (the `kilo.files/focus` take-over, the `toggle-focus` command and
 * `focusAvailable` key) and its telemetry. The preview portals its rendered
 * Markdown into the take-over, as kilo.chat's panes do.
 */
export class FilesReading {
	readonly focus = new ReadingFocusController<FileFocusTarget>();
	#summary: FocusVisitSummary | null = null;
	#settingsChanged = 0;

	constructor(readonly sdk: PluginSdk) {}

	track(event: FilesReadingEvent, data: Record<string, unknown>): void {
		void this.sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => {});
	}

	settings(): ReadingSettings {
		return this.sdk.domainObjects.get(Reading)?.getState() ?? DEFAULT_READING_SETTINGS;
	}

	async enter(
		pane: { workSessionId: string; paneId: string },
		target: FileFocusTarget,
		source: FocusEntrySource,
		blockCount: number,
	): Promise<void> {
		this.#summary = null;
		this.#settingsChanged = 0;
		const usage = await this.sdk.domainObjects
			.get(ReadingUsage)
			?.methods.recordFocusEntered(undefined)
			.catch(() => null);
		const settings = this.settings();
		const theme = this.sdk.domainObjects.get(Theme)?.getState();
		const now = Date.now();
		this.track("focus-entered", {
			surface: "file",
			source,
			isFirstTime: (usage?.focusVisits ?? 0) === 0,
			lifetimeVisits: countBucket((usage?.focusVisits ?? 0) + 1),
			daysSinceLastVisit: daysSince(usage?.lastFocusEnteredAt ?? null, now),
			secondsSinceLastExit: usage?.lastFocusExit
				? Math.min(86_400, Math.round((now - usage.lastFocusExit.at) / 1000))
				: null,
			blockCount: countBucket(blockCount),
			startBlockPct: blockCount === 0 ? 0 : roundToTen(((target.block + 1) / blockCount) * 100),
			streaming: false,
			readingThemeApplied: resolveReadingTheme(settings, {
				themeId: theme?.themeId ?? "kilo",
				mode: theme?.mode ?? "dark",
			}).applied,
			movesWith: settings.focus.movesWith,
			dimming: roundToTen(settings.focus.dimming),
		});
		await this.focus.enter(pane, target, source);
	}

	visitEnded(summary: FocusVisitSummary): void {
		this.#summary = summary;
	}

	noteSettingChanged(): void {
		if (this.focus.session()) this.#settingsChanged += 1;
	}

	ended(session: FilesFocusSession, reason: string): void {
		const summary = this.#summary;
		const durationSeconds =
			summary?.durationSeconds ?? Math.round((Date.now() - session.startedAt) / 1000);
		this.track("focus-exited", {
			surface: "file",
			exitReason: reason,
			duration: durationBucket(durationSeconds),
			durationSeconds: Math.min(durationSeconds, 4 * 3600),
			activeSeconds: Math.min(summary?.activeSeconds ?? 0, 4 * 3600),
			blocksVisited: countBucket(summary?.blocksVisited ?? 0),
			maxBlockPct: roundToTen(summary?.maxBlockPct ?? 0),
			movesByKeys: countBucket(summary?.movesByKeys ?? 0),
			movesByScroll: countBucket(summary?.movesByScroll ?? 0),
			movesByPointer: countBucket(summary?.movesByPointer ?? 0),
			settingsChanged: countBucket(this.#settingsChanged),
			savesCreated: countBucket(0),
			copies: countBucket(summary?.copies ?? 0),
			typingAttempts: countBucket(summary?.typingAttempts ?? 0),
			findAttempts: countBucket(summary?.findAttempts ?? 0),
			replyFinishedWhileReading: false,
		});
		void this.sdk.domainObjects
			.get(ReadingUsage)
			?.methods.recordFocusExited({ workSessionId: session.workSessionId })
			.catch(() => {});
	}

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

/** Starts Reading Mode for kilo.files in a window. */
export function activateFilesReading(sdk: PluginSdk): FilesReading {
	const reading = new FilesReading(sdk);
	const { focus } = reading;
	focus.openTakeover = async (session) => {
		await sdk.domainObjects
			.get(Navigation)
			?.methods.openTakeover({ takeover: FILES_FOCUS_TAKEOVER, input: { sessionId: session.id } });
	};
	focus.closeTakeover = async () => {
		await sdk.domainObjects.get(Navigation)?.methods.closeTakeover({});
	};
	focus.onEnded = (session, reason) => reading.ended(session, reason);

	sdk.extensions.implement(KernelCommand, "toggle-focus", async () => {
		if (focus.session()) return focus.exit("shortcut");
		const source = reading.activeSource();
		const target = source?.available() ? source.targetNearMiddle() : null;
		if (!source || !target) {
			reading.track("focus-entry-failed", { reason: source ? "no-content" : "unavailable" });
			return;
		}
		await reading.enter(source, target, "shortcut", source.entryContext(target).blockCount);
	});

	let available = false;
	const publish = () => {
		const next = focus.session() !== null || Boolean(reading.activeSource()?.available());
		if (next === available) return;
		available = next;
		sdk.context.set("focusAvailable", next);
	};
	sdk.onDispose(focus.subscribe(publish));
	for (const domain of [WorkSessionsWindow, Panes] as const) {
		let stop: (() => void) | undefined;
		sdk.domainObjects.track(domain, {
			added: (handle) => {
				stop = handle.subscribe(() => {
					const session = focus.session();
					const window = sdk.domainObjects.get(WorkSessionsWindow)?.getState();
					if (
						session &&
						window &&
						(window.activeWorkSessionId !== session.workSessionId || window.view !== null)
					) {
						void focus.exit("session-switched");
					}
					publish();
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

interface FilesReadingContextValue {
	readonly reading: FilesReading;
	readonly workSessionId: string;
	readonly paneId: string;
}

const FilesReadingContext = createContext<FilesReadingContextValue | null>(null);

export function FilesReadingProvider({
	reading,
	workSessionId,
	paneId,
	children,
}: {
	reading: FilesReading | undefined;
	workSessionId: string;
	paneId: string;
	children: ReactNode;
}) {
	const value = reading ? { reading, workSessionId, paneId } : null;
	return <FilesReadingContext value={value}>{children}</FilesReadingContext>;
}

export function useFilesReading(): FilesReadingContextValue | null {
	return use(FilesReadingContext);
}

const noSubscribe = () => () => {};
const noValue = () => null;

export function useFilesFocusSession(reading: FilesReading | undefined) {
	return useSyncExternalStore(
		reading?.focus.subscribe ?? noSubscribe,
		reading?.focus.session ?? noValue,
	);
}

export function useFilesFocusContainer(reading: FilesReading | undefined) {
	return useSyncExternalStore(
		reading?.focus.subscribe ?? noSubscribe,
		reading?.focus.container ?? noValue,
	);
}

/** The toggle-focus shortcut as one label ("⇧⌘F"). */
export function useFocusShortcut(): string | undefined {
	const { keyboard } = useKernel();
	const chord = useSyncExternalStore(
		keyboard.subscribe,
		() => keyboard.resolution().byCommand[FILES_TOGGLE_FOCUS]?.[0] ?? null,
	);
	const parsed = chord ? parseChord(chord) : null;
	return parsed ? formatChord(parsed, keyboard.platform).join("") : undefined;
}

const selectReading = (state: ReadingSettings) => state;
const selectTheme = (state: { themeId: string; mode: ResolvedColorScheme }) => state;
const selectTextSizes = (state: { textSizes: { ui: number; chat: number } }) => state.textSizes;
const selectPresets = (state: ReadingPresetsState) => state;

export function useFilesReadingPreferences(reading: FilesReading | undefined) {
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
		surface: "file" | "focus",
	) => {
		void handle?.methods.update(patch as ReadingPatch).catch(() => {});
		reading?.noteSettingChanged();
		reading?.track("reading-setting-changed", {
			setting,
			value: settingValue(patch, setting),
			surface,
		});
	};
	const reset = (surface: "file" | "focus") => {
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

/**
 * The `kilo.files/focus` take-over: the Focus reader holding the container
 * the preview portals into. It holds the open session while mounted and
 * closes itself whenever there is none, so the window is never left covered
 * by an empty take-over.
 */
export function createFilesFocusTakeover(reading: FilesReading): FC<TakeoverProps> {
	return (props) => <FilesFocusTakeover {...props} reading={reading} />;
}

function FilesFocusTakeover({ close, reading }: TakeoverProps & { reading: FilesReading }) {
	const session = useFilesFocusSession(reading);
	const preferences = useFilesReadingPreferences(reading);
	const shortcut = useFocusShortcut();
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const sessionId = session?.id ?? null;
	const closeRef = useLatestRef(close);
	useLayoutEffect(() => {
		reading.focus.setContainer(container);
	}, [container, reading]);
	useEffect(() => {
		if (sessionId === null) {
			closeRef.current();
			return;
		}
		return reading.focus.hold(sessionId);
	}, [closeRef, reading, sessionId]);
	const { dimming, onDimmingInput } = useDimmingPreview(preferences.settings.focus.dimming);
	if (!session) return null;
	const resolved = resolveReadingTheme(preferences.settings, preferences.appTheme);
	return (
		<FocusReader
			key={session.id}
			theme={readingThemeStyle(resolved.themeId, resolved.mode)}
			scheme={resolved.mode}
			typography={readingTypography("focus", preferences.settings)}
			dimming={dimming}
			movesWith={preferences.settings.focus.movesWith}
			initialBlock={session.target.block}
			onExit={(request) => void reading.focus.exit(request)}
			onFocusChange={(index) => reading.focus.focusedBlock(index)}
			onCopy={(text) => rememberExcerpt(text, "file")}
			onVisitEnd={(summary) => reading.visitEnded(summary)}
			control={
				<ReadingControl
					settings={preferences.settings}
					onChange={(patch, setting) => preferences.update(patch, setting, "focus")}
					onDimmingInput={onDimmingInput}
					onReset={() => preferences.reset("focus")}
					appTheme={preferences.appTheme}
					baseSize={16}
					{...(preferences.presets ? { presets: preferences.presets } : {})}
					inFocus
					focusOn
					onFocusChange={(on) => {
						if (!on) void reading.focus.exit("reading-control");
					}}
					{...(shortcut ? { focusShortcut: shortcut } : {})}
					footnote={FOCUS_FOOTNOTE}
					onOpenChange={(open) => {
						if (open) reading.track("reading-control-opened", { surface: "focus" });
					}}
					qaId="files-reading-focus"
				/>
			}
		>
			<div ref={setContainer} data-qa-id="files-focus-content" />
		</FocusReader>
	);
}
