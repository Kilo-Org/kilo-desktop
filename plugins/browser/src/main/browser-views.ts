import { KernelError } from "@kilo-desktop/kernel";

import { pageKey, type BrowserPage, type PageCommand } from "../contracts/index.js";
import type { BrowserHost, GuestController } from "./browser-host.js";

export interface BrowserViewsListener {
	/** A pane's page changed (attached, navigated, loaded, zoomed…). */
	changed(page: BrowserPage): void;
	/** A pane's page went away (closed, or its guest detached). */
	removed(workSessionId: string, paneId: string): void;
}

const COMMANDS: Readonly<Record<PageCommand, keyof GuestController>> = {
	back: "goBack",
	forward: "goForward",
	reload: "reload",
	hardReload: "hardReload",
	zoomIn: "zoomIn",
	zoomOut: "zoomOut",
	resetZoom: "resetZoom",
	openDevTools: "openDevTools",
};

interface Attachment {
	readonly workSessionId: string;
	readonly paneId: string;
	readonly controller: GuestController;
}

/**
 * The live guest behind each Browser pane, keyed by pane. A pane's window
 * embeds the `<webview>` and attaches its WebContents here; the host verifies
 * it and hands back a controller. One guest per pane: attaching again (a
 * reload, a pop-out window taking the pane over) disposes the earlier one,
 * and a detach that names a guest the pane no longer holds is ignored, so a
 * window letting its old guest go never closes the newer one. State from a
 * superseded guest is dropped. Page commands and agent tools reach a page
 * only through this registry, so they always act on the pane's current guest.
 */
export class BrowserViews {
	readonly #attachments = new Map<string, Attachment>();

	constructor(
		private readonly host: BrowserHost,
		private readonly listener: BrowserViewsListener,
	) {}

	attach(workSessionId: string, paneId: string, webContentsId: number): BrowserPage {
		const key = pageKey(workSessionId, paneId);
		this.close(workSessionId, paneId);
		let latest: BrowserPage | undefined;
		let attaching = true;
		let controller: GuestController;
		try {
			controller = this.host.attach(webContentsId, (state) => {
				latest = { workSessionId, paneId, ...state };
				if (attaching || this.#attachments.get(key)?.controller !== controller) return;
				this.listener.changed(latest);
			});
		} catch (error) {
			throw new KernelError(
				"UNAVAILABLE",
				error instanceof Error ? error.message : "Unable to attach browser tab.",
			);
		}
		attaching = false;
		this.#attachments.set(key, { workSessionId, paneId, controller });
		const page = latest ?? emptyPage(workSessionId, paneId, webContentsId);
		this.listener.changed(page);
		return page;
	}

	detach(workSessionId: string, paneId: string, webContentsId: number): void {
		const key = pageKey(workSessionId, paneId);
		if (this.#attachments.get(key)?.controller.webContentsId !== webContentsId) return;
		this.close(workSessionId, paneId);
	}

	async navigate(workSessionId: string, paneId: string, url: string): Promise<void> {
		await this.#required(workSessionId, paneId).navigate(url);
	}

	run(workSessionId: string, paneId: string, command: PageCommand): void {
		const controller = this.#required(workSessionId, paneId);
		(controller[COMMANDS[command]] as () => void)();
	}

	has(workSessionId: string, paneId: string): boolean {
		return this.#attachments.has(pageKey(workSessionId, paneId));
	}

	close(workSessionId: string, paneId: string): void {
		if (this.#dispose(pageKey(workSessionId, paneId))) this.listener.removed(workSessionId, paneId);
	}

	closeWorkSession(workSessionId: string): void {
		for (const attachment of [...this.#attachments.values()]) {
			if (attachment.workSessionId === workSessionId) this.close(workSessionId, attachment.paneId);
		}
	}

	dispose(): void {
		for (const attachment of this.#attachments.values()) attachment.controller.dispose();
		this.#attachments.clear();
	}

	#required(workSessionId: string, paneId: string): GuestController {
		const attachment = this.#attachments.get(pageKey(workSessionId, paneId));
		if (!attachment) throw new KernelError("NOT_FOUND", "Browser tab is not ready.");
		return attachment.controller;
	}

	#dispose(key: string): boolean {
		const attachment = this.#attachments.get(key);
		if (!attachment) return false;
		attachment.controller.dispose();
		this.#attachments.delete(key);
		return true;
	}
}

function emptyPage(workSessionId: string, paneId: string, webContentsId: number): BrowserPage {
	return {
		workSessionId,
		paneId,
		webContentsId,
		url: "",
		title: "",
		faviconUrl: "",
		loading: false,
		canGoBack: false,
		canGoForward: false,
		zoomFactor: 1,
	};
}
