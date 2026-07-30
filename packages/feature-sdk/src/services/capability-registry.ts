/**
 * In-memory capability registry backing `sdk.plugins`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.plugins.expose/get`, which delegate here.
 *
 * Capabilities are named API objects a feature exposes for others to call —
 * the request/response counterpart to events and the only sanctioned
 * cross-feature call path. get() merges all of a feature's capabilities
 * into one object, or returns null when the feature exposed nothing
 * (consumers must handle null: the feature may not be loaded).
 */
export class CapabilityRegistry {
	private capabilities = new Map<string, Map<string, Record<string, unknown>>>();

	expose(featureId: string, capabilityName: string, implementation: Record<string, unknown>): void {
		if (!this.capabilities.has(featureId)) {
			this.capabilities.set(featureId, new Map());
		}
		this.capabilities.get(featureId)!.set(capabilityName, implementation);
	}

	get(featureId: string): Record<string, unknown> | null {
		const caps = this.capabilities.get(featureId);
		if (!caps || caps.size === 0) return null;
		// Merge all capabilities for the feature into one object
		const merged: Record<string, unknown> = {};
		for (const [name, impl] of caps) {
			merged[name] = impl;
		}
		return merged;
	}

	/** Remove a single named capability of a feature. */
	remove(featureId: string, capabilityName: string): void {
		const caps = this.capabilities.get(featureId);
		if (!caps) return;
		caps.delete(capabilityName);
		if (caps.size === 0) this.capabilities.delete(featureId);
	}

	removeFeature(featureId: string): void {
		this.capabilities.delete(featureId);
	}
}
