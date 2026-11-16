import {
	accountInputSchema,
	KernelIdentity,
	KernelIdentityProvider,
	KernelLinkedAccount,
	type Account,
	type AccountSource,
	type IdentityState,
} from "../builtins";
import type { DomainObjectProvider } from "../domain-object-registry";
import type { Kernel } from "../kernel";

type IdentityProvider = DomainObjectProvider<typeof KernelIdentity>;

/**
 * Provides `kernel/identity` from the `identity-provider` winner and every
 * `linked-account` contribution. The kernel subscribes to each source while
 * its contribution is bound, and rebuilds the whole identity whenever a
 * source reports a change or the contributions change, so the state is
 * always a pure function of what is bound now. An account that fails its
 * schema counts as no account (logged), so one plugin's bad data can't
 * break flags or telemetry for everyone.
 */
export function provideIdentity(core: Kernel): IdentityProvider {
	const logger = core.kernelSdk.logger;
	const subscriptions = new Map<string, { source: AccountSource; stop: () => void }>();

	const read = (key: string, source: AccountSource): Account | null => {
		try {
			const raw = source.current();
			if (raw === null) return null;
			return { ...accountInputSchema.parse(raw), source: key };
		} catch (error) {
			logger.error(`Account from "${key}" is invalid; treating it as signed out`, error);
			return null;
		}
	};

	const bound = () => {
		const primary = core.extensions.exclusive(KernelIdentityProvider).winner;
		const linked = core.extensions.list(KernelLinkedAccount);
		return {
			primary: primary?.implementation
				? { key: primary.key, source: primary.implementation }
				: null,
			linked: linked.flatMap((contribution) =>
				contribution.implementation
					? [{ key: contribution.key, source: contribution.implementation }]
					: [],
			),
		};
	};

	const subscribeSafely = (key: string, source: AccountSource): (() => void) => {
		try {
			return source.subscribe(publish);
		} catch (error) {
			logger.error(`Could not follow the account from "${key}"`, error);
			return () => {};
		}
	};

	const snapshot = (): IdentityState => {
		const { primary, linked } = bound();
		return {
			primary: primary ? read(primary.key, primary.source) : null,
			linked: linked.flatMap(({ key, source }) => read(key, source) ?? []),
		};
	};

	const provider: IdentityProvider = core.kernelSdk.domainObjects.provide(KernelIdentity, {
		initialState: { primary: null, linked: [] },
		methods: {},
	});

	const publish = () => {
		const next = snapshot();
		if (JSON.stringify(next) === JSON.stringify(provider.state)) return;
		provider.setState(next);
		provider.emit("changed", {});
	};

	const resubscribe = () => {
		const { primary, linked } = bound();
		const wanted = new Map<string, { key: string; source: AccountSource }>(
			[...(primary ? [primary] : []), ...linked].map((entry) => [entry.key, entry]),
		);
		for (const [key, subscription] of subscriptions) {
			if (wanted.get(key)?.source === subscription.source) continue;
			subscription.stop();
			subscriptions.delete(key);
		}
		for (const [key, { source }] of wanted) {
			if (subscriptions.has(key)) continue;
			subscriptions.set(key, { source, stop: subscribeSafely(key, source) });
		}
		publish();
	};

	core.extensions.subscribe((extensionPointId) => {
		if (
			extensionPointId === KernelIdentityProvider.id ||
			extensionPointId === KernelLinkedAccount.id
		) {
			resubscribe();
		}
	});
	return provider;
}
