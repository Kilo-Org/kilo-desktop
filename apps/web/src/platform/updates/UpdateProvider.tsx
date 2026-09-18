import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type {
	DesktopUpdateActionResult,
	DesktopUpdateState,
	ReleaseTrack,
} from "@kilo-desktop/contracts";

import { useLocalApi } from "../LocalApiProvider";

interface UpdateContextValue {
	readonly state: DesktopUpdateState | null;
	readonly check: () => Promise<DesktopUpdateActionResult>;
	readonly setTrack: (track: ReleaseTrack) => Promise<DesktopUpdateActionResult>;
	readonly install: () => Promise<DesktopUpdateActionResult>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const UPDATE_PREVIEW_STATE: DesktopUpdateState | null =
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
						schemaVersion: 1,
						track: "preview",
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
						schemaVersion: 1,
						track: "preview",
						version: "0.1.5-preview-260917-12000",
						previousVersion: "0.1.2-preview-260916-12000",
						title: "Kilo Desktop Preview",
						publishedAt: new Date().toISOString(),
						bodyMarkdown: "- Notes from a skipped Preview build",
						items: ["Notes from a skipped Preview build"],
					},
					{
						schemaVersion: 1,
						track: "preview",
						version: "0.1.2-preview-260916-12000",
						previousVersion: "0.1.0",
						title: "Kilo Desktop Preview",
						publishedAt: new Date().toISOString(),
						bodyMarkdown: "- Improved update reliability\n- Refined the release notes presentation",
						items: ["Improved update reliability", "Refined the release notes presentation"],
					},
				],
			}
		: null;

export function UpdateProvider({ children }: { readonly children: ReactNode }) {
	const api = useLocalApi();
	const [state, setState] = useState<DesktopUpdateState | null>(UPDATE_PREVIEW_STATE);

	useEffect(() => {
		if (UPDATE_PREVIEW_STATE) return;
		let receivedEvent = false;
		let active = true;
		const unsubscribe = api.updates.onChanged((next) => {
			receivedEvent = true;
			if (active) setState(next);
		});
		void api.updates
			.getState()
			.then((initial) => {
				if (active && !receivedEvent) setState(initial);
			})
			.catch(() => {
				// A transient initial-read failure must not take down the app shell.
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [api]);

	const value = useMemo<UpdateContextValue>(
		() => ({
			state,
			check: async () => {
				if (UPDATE_PREVIEW_STATE) return { accepted: false, state: UPDATE_PREVIEW_STATE };
				const result = await api.updates.check();
				setState(result.state);
				return result;
			},
			setTrack: async (track) => {
				if (UPDATE_PREVIEW_STATE) return { accepted: false, state: UPDATE_PREVIEW_STATE };
				const result = await api.updates.setTrack(track);
				setState(result.state);
				return result;
			},
			install: async () => {
				if (UPDATE_PREVIEW_STATE) return { accepted: false, state: UPDATE_PREVIEW_STATE };
				const result = await api.updates.install();
				setState(result.state);
				return result;
			},
		}),
		[api, state],
	);

	return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useDesktopUpdates(): UpdateContextValue | null {
	return useContext(UpdateContext);
}
