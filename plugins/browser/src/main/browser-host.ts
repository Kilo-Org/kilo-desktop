/**
 * The desktop host's embedded browser (`sdk.host.browser`, granted by the
 * `browser-host` permission), typed here by its consumer as the kernel asks.
 * The host owns the guests' persistent session and its guards: permission
 * requests denied, loopback sub-resources of remote pages cancelled, web
 * pages kept out of local files and local pages off the web, popups loaded
 * in place, and guests accepted only when a trusted app window embeds them.
 */
export interface GuestState {
	readonly webContentsId: number;
	readonly url: string;
	readonly title: string;
	readonly faviconUrl: string;
	readonly loading: boolean;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
	readonly zoomFactor: number;
	readonly failure?: { readonly code: number; readonly description: string };
}

/** A verified guest; disposing it removes every listener the host installed. */
export interface GuestController {
	readonly webContentsId: number;
	navigate(url: string): Promise<void>;
	goBack(): void;
	goForward(): void;
	reload(): void;
	hardReload(): void;
	zoomIn(): void;
	zoomOut(): void;
	resetZoom(): void;
	openDevTools(): void;
	dispose(): void;
}

export type LocalFileAuthorizer = (canonicalPath: string) => Promise<boolean>;

export interface BrowserHost {
	/** The guests' session partition. */
	readonly partition: string;
	/** Prepares the partition (guards, user agent, the local-file scheme); idempotent. */
	initialize(): void;
	/** Answers whether a `kilo-file:` request's canonical path may be served. */
	serveLocalFiles(authorize: LocalFileAuthorizer): void;
	/** Throws unless the guest is alive, in the partition and embedded by a trusted window. */
	attach(webContentsId: number, onState: (state: GuestState) => void): GuestController;
}
