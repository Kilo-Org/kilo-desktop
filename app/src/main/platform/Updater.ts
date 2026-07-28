import { app } from "electron";
import electronLog from "electron-log";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const channel = process.env.RELEASE_CHANNEL ?? "canary";
const publishUrl =
	process.env.UPDATE_PUBLISH_URL ?? "https://updates.example.invalid/anaconda-agentic-desktop";

export function configureUpdater(): () => void {
	if (!app.isPackaged) {
		return () => undefined;
	}

	electronLog.transports.file.level = "info";
	autoUpdater.logger = electronLog;
	autoUpdater.channel = channel;
	autoUpdater.autoDownload = false;
	autoUpdater.setFeedURL({
		provider: "generic",
		url: publishUrl,
		channel,
	});

	void autoUpdater.checkForUpdates().catch((error: unknown) => {
		electronLog.warn("Update check failed", error);
	});

	return () => {
		autoUpdater.removeAllListeners();
	};
}
