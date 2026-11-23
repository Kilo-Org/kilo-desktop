import { create } from "zustand";

const KEY = "kilo.chat/swarm-preferences";

/** When a chat's Swarm Board opens by itself beside the chat. */
export const SWARM_AUTO_OPEN = ["never", "three", "always"] as const;
export type SwarmAutoOpen = (typeof SWARM_AUTO_OPEN)[number];

export interface SwarmPreferences {
	/** `three`: once a chat has delegated to three or more subagents. */
	readonly autoOpen: SwarmAutoOpen;
	/** The swarm shelf above the composer: live roster and latest post. */
	readonly shelf: boolean;
}

export const DEFAULT_SWARM_PREFERENCES: SwarmPreferences = { autoOpen: "three", shelf: true };

/** How many subagents a chat must have delegated to before its board opens by itself. */
export function autoOpenThreshold(autoOpen: SwarmAutoOpen): number | null {
	if (autoOpen === "never") return null;
	return autoOpen === "three" ? 3 : 1;
}

function load(storage: Storage | undefined): SwarmPreferences {
	try {
		const parsed = JSON.parse(storage?.getItem(KEY) ?? "{}") as Partial<SwarmPreferences>;
		return {
			autoOpen: SWARM_AUTO_OPEN.includes(parsed.autoOpen as SwarmAutoOpen)
				? (parsed.autoOpen as SwarmAutoOpen)
				: DEFAULT_SWARM_PREFERENCES.autoOpen,
			shelf: typeof parsed.shelf === "boolean" ? parsed.shelf : DEFAULT_SWARM_PREFERENCES.shelf,
		};
	} catch {
		return DEFAULT_SWARM_PREFERENCES;
	}
}

interface SwarmPreferencesState extends SwarmPreferences {
	set(next: Partial<SwarmPreferences>): void;
}

/**
 * The person's Swarm Board choices on this device (Settings → Swarm Board):
 * when the board opens by itself and whether the composer shows the swarm
 * shelf. Whether agents get a board at all is Kilo's own config, kept by
 * kilo.core/swarm.
 */
export function createSwarmPreferencesStore(
	storage: Storage | undefined = globalThis.localStorage,
) {
	return create<SwarmPreferencesState>((set, get) => ({
		...load(storage),
		set: (next) => {
			const { autoOpen, shelf } = { ...get(), ...next };
			try {
				storage?.setItem(KEY, JSON.stringify({ autoOpen, shelf }));
			} catch {
				// Kept for this window when storage is unavailable.
			}
			set({ autoOpen, shelf });
		},
	}));
}

export const useSwarmPreferences = createSwarmPreferencesStore();
