import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";
import type {
	AgeBucket,
	CountBucket,
	DurationBucket,
	LengthBucket,
} from "@kilo-desktop/ui/lib/reading/buckets";

import type { FocusEntrySource, FocusExitReason } from "./chat-focus";

/** Where reading happened in kilo.chat. */
export type ReadingSurfaceName = "reply" | "plan";
export type ControlSurface = "chat" | "plan" | "focus";

/**
 * kilo.chat's Reading Mode events (declared in plugin.json). Every value is
 * a boolean, a rounded number, a bucket or one of a fixed set of names: no
 * text, titles, paths or queries. See docs/telemetry/reading-mode.md.
 */
export interface ReadingEvents {
	"focus-entered": {
		surface: ReadingSurfaceName;
		source: FocusEntrySource;
		isFirstTime: boolean;
		lifetimeVisits: CountBucket;
		daysSinceLastVisit: number | null;
		secondsSinceLastExit: number | null;
		blockCount: CountBucket;
		startBlockPct: number;
		streaming: boolean;
		readingThemeApplied: boolean;
		movesWith: "scroll" | "pointer" | "keys";
		dimming: number;
	};
	"focus-exited": {
		surface: ReadingSurfaceName;
		exitReason: FocusExitReason;
		duration: DurationBucket;
		durationSeconds: number;
		activeSeconds: number;
		blocksVisited: CountBucket;
		maxBlockPct: number;
		movesByKeys: CountBucket;
		movesByScroll: CountBucket;
		movesByPointer: CountBucket;
		settingsChanged: CountBucket;
		savesCreated: CountBucket;
		copies: CountBucket;
		typingAttempts: CountBucket;
		findAttempts: CountBucket;
		replyFinishedWhileReading: boolean;
	};
	"focus-entry-failed": { reason: "no-content" | "unavailable" | "secondary-window" };
	"reading-control-opened": { surface: ControlSurface };
	"reading-setting-changed": {
		setting: "theme" | "mode" | "text-size" | "line-spacing" | "moves-with" | "dimming" | "reset";
		value: string | number | null;
		surface: ControlSurface;
	};
	"focus-round-trip": {
		secondsInChat: number;
		promptsSent: CountBucket;
		copiedInFocus: boolean;
	};
	"focus-excerpt-used-in-prompt": {
		secondsSinceCopy: number;
		length: LengthBucket;
		surface: string;
	};
	"saved-item-added": {
		kind: "text" | "chat";
		surface: "chat" | "focus";
		origin: "selection-menu" | "bookmark-button";
		selectionLength: LengthBucket;
		countInChat: CountBucket;
		isFirstTime: boolean;
		lifetimeCount: CountBucket;
	};
	"saved-item-removed": {
		kind: "text" | "chat";
		via: "highlight-menu" | "bookmark-button" | "undo";
		ageBucket: AgeBucket;
	};
	"saved-toast-action": { action: "view" | "undo"; kind: "text" | "chat" };
	"selection-menu-used": { action: "save" | "copy" | "remove"; surface: "chat" | "focus" };
	"saved-action-failed": { action: "add" | "remove" | "restore" | "open"; kind: "text" | "chat" };
}

export type TrackReading = <E extends keyof ReadingEvents>(
	event: E,
	data: ReadingEvents[E],
) => void;

/** Sends one of kilo.chat's declared Reading Mode events; never fails the caller. */
export function readingTelemetry(sdk: PluginSdk): TrackReading {
	return (event, data) => {
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data: data as Record<string, unknown> })
			.catch(() => {});
	};
}

/** Every event id, for the manifest check. */
export const READING_EVENT_IDS: readonly (keyof ReadingEvents)[] = [
	"focus-entered",
	"focus-exited",
	"focus-entry-failed",
	"reading-control-opened",
	"reading-setting-changed",
	"focus-round-trip",
	"focus-excerpt-used-in-prompt",
	"saved-item-added",
	"saved-item-removed",
	"saved-toast-action",
	"selection-menu-used",
	"saved-action-failed",
];
