import {
	CLIPBOARD_WRITE_EMBEDDED_PERMISSION,
	EMBEDDED_WEB_HOST_CAPABILITY,
	EMBEDDED_WEB_HOST_SECURITY_PROFILES,
	type EmbeddedWebHost,
} from "@kilo-desktop/feature-sdk/main";

import { DESKTOP_HOST } from "../../platform/ElectronProtocol.js";
import { createLogger } from "../../platform/logger.js";
import { featureRouter } from "./feature-registry.js";
import { FEATURES } from "./features.js";

/** Structural so tests can pass a no-op instead of initializing `electron-log`. */
export interface EmbeddedHostsLogger {
	warn(message: string): void;
}

function isEmbeddedWebHost(value: unknown): value is EmbeddedWebHost {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<EmbeddedWebHost>;
	if (typeof candidate.host !== "string" || candidate.host.length === 0) return false;
	// The app shell's host is reserved: an embedded host there would share its trusted origin.
	if (candidate.host === DESKTOP_HOST) return false;
	if (candidate.root !== undefined && typeof candidate.root !== "string") return false;
	if (candidate.securityProfiles !== undefined) {
		if (typeof candidate.securityProfiles !== "object" || candidate.securityProfiles === null) {
			return false;
		}
		if (
			!Object.entries(candidate.securityProfiles).every(
				([route, profile]) =>
					route.startsWith("/") && EMBEDDED_WEB_HOST_SECURITY_PROFILES.includes(profile),
			)
		) {
			return false;
		}
	}
	if (candidate.permissions !== undefined) {
		if (
			!Array.isArray(candidate.permissions) ||
			!candidate.permissions.every(
				(permission) => permission === CLIPBOARD_WRITE_EMBEDDED_PERMISSION,
			)
		) {
			return false;
		}
	}
	if (candidate.documents !== undefined) {
		if (typeof candidate.documents !== "object" || candidate.documents === null) return false;
		if (
			!Object.entries(candidate.documents).every(
				([route, html]) => route.startsWith("/") && typeof html === "string",
			)
		) {
			return false;
		}
	}
	if (candidate.routes === undefined) return true;
	if (typeof candidate.routes !== "object" || candidate.routes === null) return false;
	return Object.values(candidate.routes).every((route) => typeof route === "function");
}

/**
 * Reads back every feature's `embeddedWebHost` contribution so the protocol
 * handler can serve them without importing any feature (D3).
 *
 * Must be called per request rather than once at registration: features boot
 * after `protocol.register`, so an early call sees nothing.
 */
export function collectEmbeddedHosts(
	logger: EmbeddedHostsLogger = createLogger("embedded-hosts"),
): readonly EmbeddedWebHost[] {
	const hosts: EmbeddedWebHost[] = [];
	for (const feature of FEATURES) {
		const capability = featureRouter.capabilityRegistry.get(feature.id)?.[
			EMBEDDED_WEB_HOST_CAPABILITY
		];
		if (capability === undefined) continue;
		// Skip rather than throw: one malformed contribution must not take down the
		// protocol handler, which serves the whole app.
		if (!isEmbeddedWebHost(capability)) {
			logger.warn(
				`Feature "${feature.id}" exposed a malformed ${EMBEDDED_WEB_HOST_CAPABILITY} — ignoring.`,
			);
			continue;
		}
		hosts.push(capability);
	}
	return hosts;
}
