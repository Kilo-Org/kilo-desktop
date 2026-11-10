import {
	definePlugin,
	KernelError,
	mainHost,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type ObjectRef,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Panes, WorkSessions, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

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

type PanesHandle = DomainObjectHandle<typeof Panes>;

function findPane(panes: PanesHandle, workSessionId: string, paneId: string): Pane | undefined {
	return panes
		.getState()
		.byWorkSession[workSessionId]?.panes.find(
			(pane) => pane.id === paneId && pane.kind === BROWSER_PANE_KIND,
		);
}

function sameMetadata(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameObject(a: ObjectRef | undefined, b: ObjectRef) {
	return a?.type === b.type && a.id === b.id;
}

/**
 * kilo.browser in main. The host's embedded browser owns the guests' session
 * and its guards; this entry prepares it, answers its local-file requests
 * from kilo.work-sessions' workspaces, and keeps `pages` — each Browser
 * pane's live guest (`BrowserViews`) and its published state. A pane follows
 * its page: title, favicon, URL and the object it is (its `object`, so
 * openers reuse it), written through `Panes.update`; a pane any opener
 * creates is titled with its host or file name. Closing a pane, or deleting
 * its work session, closes its page. The `open` agent tool shows a web page
 * in the calling chat's work session.
 */
export function createBrowserMainEntry(options: BrowserMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = options.host ? options.host(sdk) : mainHost(sdk).browser;
			const windows = options.windows ?? process.platform === "win32";
			let panes: PanesHandle | null = null;

			const followPage = (page: BrowserPage) => {
				const pane =
					panes && page.url ? findPane(panes, page.workSessionId, page.paneId) : undefined;
				if (!panes || !pane) return;
				const object = objectRefOfUrl(page.url, windows);
				const title = page.title.trim() || pane.title;
				const iconKey = page.faviconUrl || DEFAULT_BROWSER_ICON_KEY;
				const metadata = { ...pane.metadata, [BROWSER_PANE_METADATA.url]: page.url };
				const sameIcon = (pane.iconKey ?? DEFAULT_BROWSER_ICON_KEY) === iconKey;
				if (
					title === pane.title &&
					sameIcon &&
					sameObject(pane.object, object) &&
					sameMetadata(metadata, pane.metadata)
				) {
					return;
				}
				void panes.methods
					.update({
						workSessionId: page.workSessionId,
						paneId: page.paneId,
						title,
						...(sameIcon ? {} : { iconKey }),
						object,
						metadata,
					})
					.catch((error: unknown) => sdk.logger.warn("Could not update a browser pane", error));
			};

			if (host) host.serveLocalFiles(createLocalFileAuthorizer(sdk));
			const pages: DomainObjectProvider<typeof BrowserPages> = sdk.domainObjects.provide(
				BrowserPages,
				{
					initialState: { pages: {} },
					methods: {
						prepare: () => {
							const { host: browser } = required();
							browser.initialize();
							return { partition: browser.partition };
						},
						attach: ({ workSessionId, paneId, webContentsId }) =>
							required().views.attach(workSessionId, paneId, webContentsId),
						detach: ({ workSessionId, paneId, webContentsId }) => {
							required().views.detach(workSessionId, paneId, webContentsId);
						},
						navigate: async ({ workSessionId, paneId, url }) => {
							let normalized: string;
							try {
								normalized = normalizeBrowserUrl(url);
							} catch (error) {
								throw new KernelError("VALIDATION", (error as Error).message);
							}
							await required().views.navigate(workSessionId, paneId, normalized);
						},
						command: ({ workSessionId, paneId, command }) => {
							required().views.run(workSessionId, paneId, command);
						},
					},
				},
			);
			const views = host
				? new BrowserViews(host, {
						changed: (page) => {
							pages.setState({
								pages: {
									...pages.state.pages,
									[pageKey(page.workSessionId, page.paneId)]: page,
								},
							});
							followPage(page);
						},
						removed: (workSessionId, paneId) => {
							const { [pageKey(workSessionId, paneId)]: _removed, ...rest } = pages.state.pages;
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
				sdk.domainObjects.track(Panes, {
					added: (handle) => {
						panes = handle;
						const stopOpened = handle.on("opened", ({ workSessionId, pane }) => {
							if (pane.kind !== BROWSER_PANE_KIND || pane.metadata[BROWSER_PANE_METADATA.url]) {
								return;
							}
							const title = pane.object ? titleOfObject(pane.object) : undefined;
							if (!title) return;
							void handle.methods
								.update({ workSessionId, paneId: pane.id, title })
								.catch((error: unknown) =>
									sdk.logger.warn("Could not title a browser pane", error),
								);
						});
						const stopClosed = handle.on("closed", ({ workSessionId, pane }) => {
							if (pane.kind === BROWSER_PANE_KIND) views?.close(workSessionId, pane.id);
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
				sdk.domainObjects.track(WorkSessions, {
					added: (handle) => {
						sdk.onDispose(
							handle.on("deleted", ({ workSession }) => views?.closeWorkSession(workSession.id)),
						);
					},
					removed: () => {},
				}),
			);

			implementOpenTool(sdk);
		},
	});
}
