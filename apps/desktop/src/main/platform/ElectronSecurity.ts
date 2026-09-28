import type { IpcMainInvokeEvent, Session } from "electron";

import type { EmbeddedWebHost } from "@kilo-desktop/feature-sdk/main";

import {
	DESKTOP_DEVELOPMENT_SCHEME,
	DESKTOP_HOST,
	DESKTOP_PRODUCTION_SCHEME,
} from "./ElectronProtocol.js";

const DESKTOP_SCHEMES = new Set([DESKTOP_PRODUCTION_SCHEME, DESKTOP_DEVELOPMENT_SCHEME]);

export function isTrustedRendererUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return DESKTOP_SCHEMES.has(url.protocol.slice(0, -1)) && url.host === DESKTOP_HOST;
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
	if (!DESKTOP_SCHEMES.has(url.protocol.slice(0, -1))) return false;
	// Never extend the trusted app shell, whatever an embedded host declares.
	if (url.host === DESKTOP_HOST) return false;
	return embeddedHosts.some(
		(embedded) =>
			embedded.host === url.host &&
			embedded.permissions?.some((granted) => granted === permission) === true,
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
