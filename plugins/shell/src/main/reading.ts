import {
	KernelDataCollection,
	mainHost,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import {
	DEFAULT_READING_SETTINGS,
	isDefaultReadingSettings,
	normalizeReadingSettings,
	type ReadingSettings,
} from "@kilo-desktop/ui/lib/reading/settings";
import {
	EMPTY_READING_PRESETS,
	normalizeReadingPresets,
	type ReadingPresetsState,
} from "@kilo-desktop/ui/lib/reading/presets";

import { Reading, ReadingUsage, type ReadingPatch, type ReadingUsageState } from "../contracts";
import { provideReadingPresets } from "./reading-presets";
import type { TrackShellEvent } from "./telemetry";

export interface ReadingOptions {
	readonly now?: () => number;
	readonly createPresetId?: () => string;
}

const DAY_MS = 24 * 60 * 60_000;
const SNAPSHOT_CHECK_MS = 60 * 60_000;

type ReadingStore = {
	preferences: ReadingSettings;
	presets: ReadingPresetsState;
	usage: ReadingUsageState;
	/** When the last daily preferences snapshot was sent. */
	lastSnapshotAt: number | null;
};

const NO_USAGE: ReadingUsageState = {
	focusVisits: 0,
	lastFocusEnteredAt: null,
	lastFocusExit: null,
};

/**
 * Owns the reading preferences, the reading presets and the local Focus
 * visit counts in main, saved in kilo.shell's kv store (`reading`). At
 * launch the default preset, if any, replaces the saved preferences before
 * Reading is provided, so no window ever paints the previous session's
 * settings first. Also sends the daily
 * "Reading Preferences Snapshot": once per 24 hours, only once data
 * collection allows it (checked on start, when consent changes and hourly),
 * so a day is never marked as reported when the event was dropped.
 */
export function provideReading(
	sdk: PluginSdk,
	track: TrackShellEvent,
	options: ReadingOptions = {},
): void {
	const now = options.now ?? Date.now;
	const store = mainHost(sdk).storage.kv<ReadingStore>({
		defaults: {
			preferences: DEFAULT_READING_SETTINGS,
			presets: EMPTY_READING_PRESETS,
			usage: NO_USAGE,
			lastSnapshotAt: null,
		},
		namespace: "reading",
	});

	// Read only: the default preset applies in memory for this launch, and a
	// stored value it can't use stays on disk untouched, so starting never
	// writes (nor fails on a full or read-only disk).
	const launch = launchState(store.get("preferences"), store.get("presets"));

	const reading: DomainObjectProvider<typeof Reading> = sdk.domainObjects.provide(Reading, {
		initialState: launch.preferences,
		methods: {
			update: (patch) => save(merge(reading.state, patch)),
			reset: () => save(DEFAULT_READING_SETTINGS),
		},
	});
	const save = (next: ReadingSettings) => {
		store.set({ preferences: next });
		reading.setState(next);
		return next;
	};

	provideReadingPresets(sdk, {
		initialState: launch.presets,
		current: () => reading.state,
		replace: save,
		persist: (presets) => store.set({ presets }),
		...(options.createPresetId ? { createId: options.createPresetId } : {}),
	});

	const usage: DomainObjectProvider<typeof ReadingUsage> = sdk.domainObjects.provide(ReadingUsage, {
		initialState: normalizeUsage(store.get("usage")),
		methods: {
			recordFocusEntered: () => {
				const before = usage.state;
				saveUsage({ ...before, focusVisits: before.focusVisits + 1, lastFocusEnteredAt: now() });
				return before;
			},
			recordFocusExited: () => {
				saveUsage({ ...usage.state, lastFocusExit: { at: now() } });
			},
		},
	});
	const saveUsage = (next: ReadingUsageState) => {
		store.set({ usage: next });
		usage.setState(next);
	};

	const snapshot = () => {
		if (!sdk.domainObjects.get(KernelDataCollection)?.getState().allowed) return;
		const last = store.get("lastSnapshotAt");
		if (last !== null && now() - last < DAY_MS) return;
		// Best-effort reporting: a failed write (a full or read-only disk) must
		// not surface from a consent subscription or the timer.
		try {
			store.set({ lastSnapshotAt: now() });
		} catch {
			return;
		}
		const settings = reading.state;
		track("reading-preferences-snapshot", {
			themeId: settings.themeId ?? "app",
			mode: settings.mode,
			textSizeStep: settings.textSizeStep,
			lineSpacing: settings.lineSpacing,
			movesWith: settings.focus.movesWith,
			dimming: Math.round(settings.focus.dimming / 10) * 10,
			isDefault: isDefaultReadingSettings(settings),
		});
	};
	let stopConsent: (() => void) | undefined;
	sdk.domainObjects.track(KernelDataCollection, {
		added: (collection) => {
			stopConsent = collection.subscribe(snapshot);
			snapshot();
		},
		removed: () => {
			stopConsent?.();
			stopConsent = undefined;
		},
	});
	snapshot();
	const timer = setInterval(snapshot, SNAPSHOT_CHECK_MS);
	sdk.onDispose(() => {
		clearInterval(timer);
		stopConsent?.();
	});
}

/**
 * What Kilo opens with: the default preset's settings, marked active, when
 * there is one; otherwise the last settings used and the preset that was
 * active then.
 */
function launchState(
	storedPreferences: unknown,
	storedPresets: unknown,
): { preferences: ReadingSettings; presets: ReadingPresetsState } {
	const presets = normalizeReadingPresets(storedPresets);
	const preferred = presets.presets.find((preset) => preset.id === presets.defaultId);
	if (!preferred) return { preferences: normalizeReadingSettings(storedPreferences), presets };
	return { preferences: preferred.settings, presets: { ...presets, activeId: preferred.id } };
}

/** Stored usage, field by field: a bad field falls back rather than failing activation. */
function normalizeUsage(value: unknown): ReadingUsageState {
	const stored =
		value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const visits = stored.focusVisits;
	const entered = stored.lastFocusEnteredAt;
	const exit = stored.lastFocusExit as Record<string, unknown> | null | undefined;
	return {
		focusVisits: Number.isInteger(visits) && (visits as number) >= 0 ? (visits as number) : 0,
		lastFocusEnteredAt: Number.isFinite(entered) ? (entered as number) : null,
		lastFocusExit: exit && Number.isFinite(exit.at) ? { at: exit.at as number } : null,
	};
}

function merge(current: ReadingSettings, patch: ReadingPatch): ReadingSettings {
	const defined = <T extends object>(value: T) =>
		Object.fromEntries(
			Object.entries(value).filter(([, field]) => field !== undefined),
		) as Partial<T>;
	const { focus, ...rest } = patch;
	return normalizeReadingSettings({
		...current,
		...defined(rest),
		focus: { ...current.focus, ...(focus ? defined(focus) : {}) },
	});
}
