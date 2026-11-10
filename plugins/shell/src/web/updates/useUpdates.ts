import { useMemo } from "react";

import { KernelUpdater, type UpdaterState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";

export interface UpdateActionResult {
	readonly accepted: boolean;
	readonly state: UpdaterState;
}

export interface Updates {
	/** Null while the updater's state is unknown. */
	readonly state: UpdaterState | null;
	check(): Promise<UpdateActionResult>;
	setTrack(track: string): Promise<UpdateActionResult>;
	install(): Promise<UpdateActionResult>;
}

const PREVIEW_STATE: UpdaterState | null =
	import.meta.env.DEV && import.meta.env.VITE_UPDATE_PREVIEW === "downloaded"
		? {
				enabled: true,
				status: "downloaded",
				track: "preview",
				currentVersion: "0.1.0",
				availableVersion: "0.2.0-preview-260918-12000",
				downloadedVersion: "0.2.0-preview-260918-12000",
				checkedAt: new Date().toISOString(),
				message: null,
				releaseNotes: [
					{
						version: "0.2.0-preview-260918-12000",
						previousVersion: "0.1.5-preview-260917-12000",
						title: "Kilo Desktop Preview",
						publishedAt: new Date().toISOString(),
						bodyMarkdown:
							"- A compact update card in About settings\n- Release notes for the downloaded version\n- A restart-to-update action",
						items: [
							"A compact update card in About settings",
							"Release notes for the downloaded version",
							"A restart-to-update action",
						],
					},
					{
						version: "0.1.5-preview-260917-12000",
						previousVersion: "0.1.2-preview-260916-12000",
						title: "Kilo Desktop Preview",
						publishedAt: new Date().toISOString(),
						bodyMarkdown: "- Notes from a skipped Preview build",
						items: ["Notes from a skipped Preview build"],
					},
				],
			}
		: null;

const PREVIEW_UPDATES: Updates | null = PREVIEW_STATE
	? {
			state: PREVIEW_STATE,
			check: async () => ({ accepted: false, state: PREVIEW_STATE }),
			setTrack: async () => ({ accepted: false, state: PREVIEW_STATE }),
			install: async () => ({ accepted: false, state: PREVIEW_STATE }),
		}
	: null;

const selectState = (state: UpdaterState) => state;

/**
 * The desktop updater (`kernel/updater`); null where there is no updater
 * (browser mode). `VITE_UPDATE_PREVIEW=downloaded` fakes a ready
 * update in development.
 */
export function useUpdates(): Updates | null {
	const updater = useDomainObject(KernelUpdater);
	const state = useDomainObjectState(KernelUpdater, selectState);
	return useMemo(() => {
		if (PREVIEW_UPDATES) return PREVIEW_UPDATES;
		if (!updater) return null;
		return {
			state: state ?? null,
			check: () => updater.methods.check(undefined),
			setTrack: (track) => updater.methods.setTrack({ track }),
			install: () => updater.methods.install(undefined),
		};
	}, [updater, state]);
}
