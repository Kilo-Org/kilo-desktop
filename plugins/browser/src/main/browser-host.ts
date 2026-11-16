import type { HostBrowser, HostBrowserController, HostBrowserState } from "@kilo-desktop/kernel";

/**
 * The desktop host's embedded browser (`mainHost(sdk).browser`, granted by
 * the `browser-host` permission), under the names kilo.browser uses. The
 * host owns the guests' persistent session and its guards: permission
 * requests denied, loopback sub-resources of remote pages cancelled, web
 * pages kept out of local files and local pages off the web, popups loaded
 * in place, and guests accepted only when a trusted app window embeds them.
 */
export type GuestState = HostBrowserState;

/** A verified guest; disposing it removes every listener the host installed. */
export type GuestController = HostBrowserController;

/** Answers whether a `kilo-file:` request's canonical path may be served. */
export type LocalFileAuthorizer = (canonicalPath: string) => Promise<boolean>;

/**
 * `partition` is the guests' session; `initialize` prepares it (guards, user
 * agent, the local-file scheme) and is idempotent; `attach` throws unless the
 * guest is alive, in the partition and embedded by a trusted window.
 */
export type BrowserHost = HostBrowser;
