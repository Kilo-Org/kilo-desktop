import type { EmbeddedWebHost } from "../../platform/ElectronProtocol.js";
import { featureRouter } from "./feature-registry.js";
import { FEATURES } from "./features.js";

const CAPABILITY_NAME = "embeddedWebHost";

function isEmbeddedWebHost(value: unknown): value is EmbeddedWebHost {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<EmbeddedWebHost>;
	if (typeof candidate.host !== "string" || candidate.host.length === 0) return false;
	if (candidate.root !== undefined && typeof candidate.root !== "string") return false;
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
export function collectEmbeddedHosts(): readonly EmbeddedWebHost[] {
	const hosts: EmbeddedWebHost[] = [];
	for (const feature of FEATURES) {
		const capability = featureRouter.capabilityRegistry.get(feature.id)?.[CAPABILITY_NAME];
		if (capability === undefined) continue;
		// Skip rather than throw: one malformed contribution must not take down the
		// protocol handler, which serves the whole app.
		if (!isEmbeddedWebHost(capability)) {
			console.warn(
				`[EmbeddedHosts] Feature "${feature.id}" exposed a malformed ${CAPABILITY_NAME} — ignoring.`,
			);
			continue;
		}
		hosts.push(capability);
	}
	return hosts;
}
