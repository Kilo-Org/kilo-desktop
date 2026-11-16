import type { IpcMainInvokeEvent, Session } from "electron";

import { HTML_RENDER_CONTENT_SECURITY_PROFILE, type EmbeddedWebHost } from "./embedded-web-host.js";

import {
	DESKTOP_HOST,
	DESKTOP_PRODUCTION_SCHEME,
	findEmbeddedHost,
	getDesktopScheme,
} from "./ElectronProtocol.js";

let activeTrustedScheme = DESKTOP_PRODUCTION_SCHEME;

export function configureTrustedSchemes(isDevelopment: boolean): void {
	activeTrustedScheme = getDesktopScheme(isDevelopment);
}

export function isTrustedRendererUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return url.protocol.slice(0, -1) === activeTrustedScheme && url.host === DESKTOP_HOST;
	} catch {
		return false;
	}
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
	return isTrustedRendererUrl(event.senderFrame?.url ?? "");
}

/**
 * Whether a document at `requesting` (an origin or URL) may use `permission`.
 * Denied unless an embedded host on a desktop scheme lists it for its exact
 * origin, and never for the app shell's reserved host. Sandboxed frames report
 * the opaque origin `null`, so they never match.
 */
export function isEmbeddedHostPermissionGranted(
	permission: string,
	requesting: string | undefined,
	embeddedHosts: readonly EmbeddedWebHost[],
): boolean {
	if (!requesting) return false;
	let url: URL;
	try {
		url = new URL(requesting);
	} catch {
		return false;
	}
	if (url.protocol.slice(0, -1) !== activeTrustedScheme) return false;
	// Never extend the trusted app shell, whatever an embedded host declares.
	if (url.host === DESKTOP_HOST) return false;
	return embeddedHosts.some(
		(embedded) =>
			embedded.host === url.host &&
			embedded.permissions?.some((granted) => granted === permission) === true,
	);
}

/**
 * Whether a subframe at `frameUrl` is showing an agent-authored page and must
 * stay on it. The page arrives by postMessage after the shell loads, so a page
 * that could navigate its own frame could land on a sibling shell — e.g. the
 * MCP App widget shell, whose policy allows loopback connections — and be
 * handed its HTML again there. A sandboxed frame keeps its URL after the shell
 * writes the page, so the URL names the document's policy.
 */
export function isPinnedEmbeddedFrame(
	frameUrl: string | undefined,
	embeddedHosts: readonly EmbeddedWebHost[],
): boolean {
	if (!frameUrl) return false;
	let url: URL;
	try {
		url = new URL(frameUrl);
	} catch {
		return false;
	}
	if (url.protocol.slice(0, -1) !== activeTrustedScheme || url.host === DESKTOP_HOST) return false;
	return (
		findEmbeddedHost(embeddedHosts, url.host)?.securityProfiles?.[url.pathname] ===
		HTML_RENDER_CONTENT_SECURITY_PROFILE
	);
}

export interface ElectronSecurityOptions {
	/** Read per request: features register their hosts after security is installed. */
	readonly embeddedHosts?: () => readonly EmbeddedWebHost[];
}

export class ElectronSecurity {
	install(session: Session, options: ElectronSecurityOptions = {}): () => void {
		const granted = (permission: string, requesting: string | undefined) =>
			isEmbeddedHostPermissionGranted(permission, requesting, options.embeddedHosts?.() ?? []);
		session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
			granted(permission, requestingOrigin),
		);
		session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
			callback(granted(permission, details.requestingUrl));
		});
		return () => {
			session.setPermissionCheckHandler(null);
			session.setPermissionRequestHandler(null);
		};
	}
}
