import {
	FeatureError,
	type HostBrowserController,
	type MainSdk,
} from "@kilo-desktop/feature-sdk/main";

import {
	browserContract,
	BROWSER_STATE_CHANGED,
	type BrowserService,
	type BrowserState,
} from "../contracts/browser.js";
import { normalizeBrowserUrl } from "./browser-url.js";
import { createWorkspaceFileAuthorization } from "./workspace-file-authorization.js";

type Attachment = { controller: HostBrowserController; state: BrowserState };

export function mainRegister(mainSdk: MainSdk): void {
	const browser = mainSdk.host?.browser;
	if (!browser) throw new Error("Browser host is unavailable.");
	browser.serveLocalFiles(createWorkspaceFileAuthorization(mainSdk));
	const attachments = new Map<string, Attachment>();
	const required = (instanceId: string) => {
		const attachment = attachments.get(instanceId);
		if (!attachment) throw new FeatureError("Browser tab is not ready.", "BUSINESS");
		return attachment.controller;
	};
	const close = (instanceId: string) => {
		attachments.get(instanceId)?.controller.dispose();
		attachments.delete(instanceId);
	};
	const command =
		(
			method: keyof Pick<
				HostBrowserController,
				| "goBack"
				| "goForward"
				| "reload"
				| "hardReload"
				| "zoomIn"
				| "zoomOut"
				| "resetZoom"
				| "openDevTools"
			>,
		) =>
		async ({ instanceId }: { instanceId: string }) => {
			required(instanceId)[method]();
			return undefined;
		};

	const api: BrowserService = {
		config: async () => {
			browser.initialize();
			return { partition: browser.partition };
		},
		attach: async ({ instanceId, webContentsId }) => {
			close(instanceId);
			let latest: BrowserState | undefined;
			const controller = browser.attach(webContentsId, (hostState) => {
				latest = { instanceId, ...hostState };
				const attachment = attachments.get(instanceId);
				if (attachment?.controller.webContentsId === webContentsId) attachment.state = latest;
				mainSdk.events.emit(BROWSER_STATE_CHANGED, latest);
			});
			const initial = latest ?? {
				instanceId,
				webContentsId,
				url: "",
				title: "",
				faviconUrl: "",
				loading: false,
				canGoBack: false,
				canGoForward: false,
				zoomFactor: 1,
			};
			attachments.set(instanceId, { controller, state: initial });
			return initial;
		},
		detach: async ({ instanceId, webContentsId }) => {
			if (attachments.get(instanceId)?.controller.webContentsId === webContentsId)
				close(instanceId);
		},
		navigate: async ({ instanceId, url }) => {
			await required(instanceId).navigate(normalizeBrowserUrl(url));
			return undefined;
		},
		back: command("goBack"),
		forward: command("goForward"),
		reload: command("reload"),
		hardReload: command("hardReload"),
		zoomIn: command("zoomIn"),
		zoomOut: command("zoomOut"),
		resetZoom: command("resetZoom"),
		openDevTools: command("openDevTools"),
		close: async ({ instanceId }) => {
			close(instanceId);
			return undefined;
		},
	};
	mainSdk.channels(browserContract).handleAll(api);
	mainSdk.onDispose(() => {
		for (const attachment of attachments.values()) attachment.controller.dispose();
		attachments.clear();
	});
}
