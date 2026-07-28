import type { IpcMainInvokeEvent, Session } from "electron";

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

export class ElectronSecurity {
	install(session: Session): () => void {
		session.setPermissionCheckHandler(() => false);
		session.setPermissionRequestHandler((_webContents, _permission, callback) => {
			callback(false);
		});
		return () => {
			session.setPermissionCheckHandler(null);
			session.setPermissionRequestHandler(null);
		};
	}
}
