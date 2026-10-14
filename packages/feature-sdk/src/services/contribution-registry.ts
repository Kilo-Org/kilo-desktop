import type { Contribution, ContributionOptions } from "../types/sdk.js";

/**
 * In-memory contribution registry backing `sdk.contribute`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.contribute(zone, options)`, which delegates here. The shell's zone
 * components consume getForZone() and re-render via onChange().
 *
 * Contributions in a zone are ordered by priority (higher first).
 */
export class ContributionRegistry {
	private contributions: Contribution[] = [];
	private changeListeners = new Set<() => void>();

	/** Register a contribution. Returns an unregister function. */
	register(featureId: string, zone: string, options: ContributionOptions): () => void {
		if (options.id.trim().length === 0) {
			throw new Error(`Feature "${featureId}" contributed an empty id to zone "${zone}".`);
		}
		const duplicate = this.contributions.some(
			(contribution) =>
				contribution.featureId === featureId &&
				contribution.zone === zone &&
				contribution.id === options.id,
		);
		if (duplicate) {
			throw new Error(
				`Feature "${featureId}" already contributed "${options.id}" to zone "${zone}".`,
			);
		}
		const contribution: Contribution = {
			id: options.id,
			featureId,
			zone,
			component: options.component,
			label: options.label,
			priority: options.priority ?? 0,
		};
		if (options.description !== undefined) {
			contribution.description = options.description;
		}
		if (options.icon !== undefined) {
			contribution.icon = options.icon;
		}
		if (options.mountPolicy !== undefined) {
			contribution.mountPolicy = options.mountPolicy;
		}
		if (options.size !== undefined) {
			contribution.size = options.size;
		}
		if (options.requiresSignIn !== undefined) {
			contribution.requiresSignIn = options.requiresSignIn;
		}
		if (options.signInHint !== undefined) {
			contribution.signInHint = options.signInHint;
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
