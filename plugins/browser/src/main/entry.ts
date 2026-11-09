import {
	definePlugin,
	KernelError,
	mainHost,
	type DomainHandle,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Panes, WorkSessions, type Pane } from "@kilo-desktop/plugin-sessions/contracts";

import {
	BROWSER_PANE_KIND,
	BROWSER_PANE_METADATA,
	BrowserPages,
	DEFAULT_BROWSER_ICON_KEY,
	normalizeBrowserUrl,
	objectRefOfUrl,
	pageKey,
	titleOfObject,
	type BrowserPage,
} from "../contracts/index.js";
import type { BrowserHost } from "./browser-host.js";
import { BrowserViews } from "./browser-views.js";
import { createLocalFileAuthorizer } from "./local-files.js";
import { implementOpenTool } from "./open-tool.js";

export interface BrowserMainOptions {
	/** Overrides the host's embedded browser (tests); absent where there is none. */
	readonly host?: (sdk: PluginSdk) => BrowserHost | undefined;
	/** Whether `kilo-file:` paths are Windows paths; defaults to the platform. */
	readonly windows?: boolean;
}

const UNAVAILABLE = "The browser isn't available here.";

type PanesHandle = DomainHandle<typeof Panes>;

function findPane(panes: PanesHandle, sessionId: string, paneId: string): Pane | undefined {
	return panes
		.getState()
		.bySession[sessionId]?.panes.find(
			(pane) => pane.id === paneId && pane.kind === BROWSER_PANE_KIND,
		);
}

function sameMetadata(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * kilo.browser in main. The host's embedded browser owns the guests' session
 * and its guards; this entry prepares it, answers its local-file requests
 * from kilo.workspaces, and keeps `pages` — each Browser pane's live guest
 * (`BrowserViews`) and its published state. A pane follows its page: title,
 * favicon, URL and the object it is (so openers reuse it), written through
 * `Panes.update`; a pane any opener creates is titled with its host or file
 * name. Closing a pane, or deleting its session, closes its page. The `open`
 * agent tool shows a web page in the calling chat's session.
 */
export function createBrowserMainEntry(options: BrowserMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = options.host
				? options.host(sdk)
				: (mainHost(sdk).browser as BrowserHost | undefined);
			const windows = options.windows ?? process.platform === "win32";
			let panes: PanesHandle | null = null;

			const followPage = (page: BrowserPage) => {
				const pane = panes && page.url ? findPane(panes, page.sessionId, page.paneId) : undefined;
				if (!panes || !pane) return;
				const ref = objectRefOfUrl(page.url, windows);
				const title = page.title.trim() || pane.title;
				const iconKey = page.faviconUrl || DEFAULT_BROWSER_ICON_KEY;
				const metadata = {
					...pane.metadata,
					[BROWSER_PANE_METADATA.url]: page.url,
					[BROWSER_PANE_METADATA.objectType]: ref.type,
					[BROWSER_PANE_METADATA.objectId]: ref.id,
				};
				const sameIcon = (pane.iconKey ?? DEFAULT_BROWSER_ICON_KEY) === iconKey;
				if (title === pane.title && sameIcon && sameMetadata(metadata, pane.metadata)) return;
				void panes.methods
					.update({
						sessionId: page.sessionId,
						paneId: page.paneId,
						title,
						...(sameIcon ? {} : { iconKey }),
						metadata,
					})
					.catch((error: unknown) => sdk.logger.warn("Could not update a browser pane", error));
			};

			if (host) host.serveLocalFiles(createLocalFileAuthorizer(sdk));
			const pages: DomainProvider<typeof BrowserPages> = sdk.domains.provide(BrowserPages, {
				initialState: { pages: {} },
				methods: {
					prepare: () => {
						const { host: browser } = required();
						browser.initialize();
						return { partition: browser.partition };
					},
					attach: ({ sessionId, paneId, webContentsId }) =>
						required().views.attach(sessionId, paneId, webContentsId),
					detach: ({ sessionId, paneId, webContentsId }) => {
						required().views.detach(sessionId, paneId, webContentsId);
					},
					navigate: async ({ sessionId, paneId, url }) => {
						let normalized: string;
						try {
							normalized = normalizeBrowserUrl(url);
						} catch (error) {
							throw new KernelError("VALIDATION", (error as Error).message);
						}
						await required().views.navigate(sessionId, paneId, normalized);
					},
					command: ({ sessionId, paneId, command }) => {
						required().views.run(sessionId, paneId, command);
					},
				},
			});
			const views = host
				? new BrowserViews(host, {
						changed: (page) => {
							pages.setState({
								pages: { ...pages.state.pages, [pageKey(page.sessionId, page.paneId)]: page },
							});
							followPage(page);
						},
						removed: (sessionId, paneId) => {
							const { [pageKey(sessionId, paneId)]: _removed, ...rest } = pages.state.pages;
							pages.setState({ pages: rest });
						},
					})
				: undefined;
			const required = () => {
				if (!views || !host) throw new KernelError("UNAVAILABLE", UNAVAILABLE);
				return { views, host };
			};

			sdk.onDispose(() => views?.dispose());

			sdk.onDispose(
				sdk.domains.track(Panes, {
					added: (handle) => {
						panes = handle;
						const stopOpened = handle.on("opened", ({ sessionId, pane }) => {
							if (pane.kind !== BROWSER_PANE_KIND || pane.metadata[BROWSER_PANE_METADATA.url]) {
								return;
							}
							const type = pane.metadata[BROWSER_PANE_METADATA.objectType];
							const id = pane.metadata[BROWSER_PANE_METADATA.objectId];
							const title = type && id ? titleOfObject({ type, id }) : undefined;
							if (!title) return;
							void handle.methods
								.update({ sessionId, paneId: pane.id, title })
								.catch((error: unknown) =>
									sdk.logger.warn("Could not title a browser pane", error),
								);
						});
						const stopClosed = handle.on("closed", ({ sessionId, pane }) => {
							if (pane.kind === BROWSER_PANE_KIND) views?.close(sessionId, pane.id);
						});
						sdk.onDispose(() => {
							stopOpened();
							stopClosed();
						});
					},
					removed: () => {
						panes = null;
					},
				}),
			);
			sdk.onDispose(
				sdk.domains.track(WorkSessions, {
					added: (handle) => {
						sdk.onDispose(handle.on("deleted", ({ session }) => views?.closeSession(session.id)));
					},
					removed: () => {},
				}),
			);

			implementOpenTool(sdk);
		},
	});
}
