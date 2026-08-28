import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type {
	DesktopUpdateActionResult,
	DesktopUpdateState,
} from "@anaconda-agentic-desktop/contracts";

import { useLocalApi } from "../LocalApiProvider";

interface UpdateContextValue {
	readonly state: DesktopUpdateState | null;
	readonly check: () => Promise<DesktopUpdateActionResult>;
	readonly install: () => Promise<DesktopUpdateActionResult>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const UPDATE_PREVIEW_STATE: DesktopUpdateState | null =
	import.meta.env.DEV && import.meta.env.VITE_UPDATE_PREVIEW === "downloaded"
		? {
				enabled: true,
				status: "downloaded",
				channel: "canary",
				currentVersion: "0.1.0",
				availableVersion: "0.2.0-canary.preview",
				downloadedVersion: "0.2.0-canary.preview",
				checkedAt: new Date().toISOString(),
				message: null,
				releaseNotes: [
					{
						schemaVersion: 1,
						channel: "canary",
						version: "0.2.0-canary.preview",
						previousVersion: "0.1.5-canary.preview",
						title: "Anaconda Agentic Desktop Canary preview",
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
						channel: "canary",
						version: "0.1.5-canary.preview",
						previousVersion: "0.1.2-canary.preview",
						title: "Anaconda Agentic Desktop Canary preview",
						publishedAt: new Date().toISOString(),
						bodyMarkdown: "- Notes from a skipped Canary build",
						items: ["Notes from a skipped Canary build"],
					},
					{
						schemaVersion: 1,
						channel: "canary",
						version: "0.1.2-canary.preview",
						previousVersion: "0.1.0",
						title: "Anaconda Agentic Desktop Canary preview",
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
