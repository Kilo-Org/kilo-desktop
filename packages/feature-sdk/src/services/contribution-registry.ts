import type { Contribution, ContributionOptions } from "../types/sdk.js";

/**
 * In-memory contribution registry.
 * Features register UI contributions in named zones.
 */
export class ContributionRegistry {
	private contributions: Contribution[] = [];
	private changeListeners = new Set<() => void>();

	/** Register a contribution. Returns an unregister function. */
	register(featureId: string, zone: string, options: ContributionOptions): () => void {
		const contribution: Contribution = {
			featureId,
			zone,
			component: options.component,
			label: options.label,
			priority: options.priority ?? 0,
		};
		if (options.size !== undefined) {
			contribution.size = options.size;
		}
		this.contributions.push(contribution);
		this.notifyChange();
		return () => {
			const index = this.contributions.indexOf(contribution);
			if (index === -1) return;
			this.contributions.splice(index, 1);
			this.notifyChange();
		};
	}

	getForZone(zone: string): Contribution[] {
		return this.contributions
			.filter((c) => c.zone === zone)
			.sort((a, b) => b.priority - a.priority);
	}

	removeFeature(featureId: string): void {
		this.contributions = this.contributions.filter((c) => c.featureId !== featureId);
		this.notifyChange();
	}

	onChange(handler: () => void): () => void {
		this.changeListeners.add(handler);
		return () => this.changeListeners.delete(handler);
	}

	private notifyChange(): void {
		for (const fn of [...this.changeListeners]) {
			try {
				fn();
			} catch (error) {
				console.warn("[ContributionRegistry] onChange handler threw:", error);
			}
		}
	}
}
