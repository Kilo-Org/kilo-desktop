import type { Account, IdentityState } from "@kilo-desktop/kernel";

import type { FeatureFlagContext, FeatureFlagLinkedAccountContext } from "./types";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

/**
 * The LaunchDarkly context for the kernel identity.
 *
 * The primary account becomes the `user` context, keyed on its id (the Kilo
 * account's id is its email, so per-user targeting keeps working), with its
 * email, `isEmployee` attribute and organisation; display names are never
 * sent. Each linked account becomes a context of its own kind, named after
 * the plugin that provides it (`kilo.anaconda/anaconda` → kind
 * `kilo.anaconda`; a second account from the same plugin uses the full
 * `<plugin>.<id>`), so a rule can target e.g. people signed in to Anaconda.
 * See `LaunchDarklyProvider` for how these become a multi-context.
 */
export function contextFor(identity: IdentityState): FeatureFlagContext {
	const linkedAccounts = linkedContexts(identity.linked);
	const linked = linkedAccounts.length > 0 ? { linkedAccounts } : {};
	const primary = identity.primary;
	if (!primary) return { ...ANONYMOUS_CONTEXT, ...linked };
	return {
		isEmployee: primary.attributes["isEmployee"] === true,
		userId: primary.id,
		...(primary.email !== undefined ? { email: primary.email } : {}),
		...(primary.organization ? { organization: organizationOf(primary.organization) } : {}),
		...linked,
	};
}

function linkedContexts(accounts: readonly Account[]): FeatureFlagLinkedAccountContext[] {
	const kinds = new Set<string>();
	return accounts.map((account) => {
		const [plugin = account.source] = account.source.split("/");
		const kind = kinds.has(plugin) ? account.source.replace("/", ".") : plugin;
		kinds.add(kind);
		return {
			kind,
			key: account.id,
			...(account.email !== undefined ? { email: account.email } : {}),
			...(account.organization ? { organization: organizationOf(account.organization) } : {}),
			attributes: account.attributes,
		};
	});
}

function organizationOf(organization: NonNullable<Account["organization"]>) {
	return {
		id: organization.id,
		...(organization.name !== undefined ? { name: organization.name } : {}),
	};
}
