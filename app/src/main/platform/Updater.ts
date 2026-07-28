import { app } from "electron";
import electronLog from "electron-log";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";

import { getUpdateFeedUrl } from "$config/release.js";

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "win32"]);

export function configureUpdater(): () => void {
	if (!app.isPackaged || !SUPPORTED_PLATFORMS.has(process.platform)) {
		return () => undefined;
	}

	const feedUrl = getUpdateFeedUrl({
		publishUrl: UPDATE_PUBLISH_URL,
		channel: RELEASE_CHANNEL,
		platform: process.platform,
		arch: process.arch,
	});
	if (!feedUrl) {
		electronLog.info("Automatic updates are disabled because no update URL was configured.");
		return () => undefined;
	}

	electronLog.transports.file.level = "info";
	const updater = updateElectronApp({
		updateSource: {
			type: UpdateSourceType.StaticStorage,
			baseUrl: feedUrl,
		},
		logger: electronLog,
		notifyUser: true,
	});

	return () => updater.stopUpdates();
}
