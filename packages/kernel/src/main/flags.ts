import {
	flagKey,
	KernelFlag,
	KernelFlags,
	KernelFlagSource,
	KernelIdentity,
	type FlagRecord,
	type FlagSource,
	type FlagValue,
} from "../builtins";
import type { DomainObjectProvider } from "../domain-object-registry";
import type { MetadataOf } from "../extension-point";
import { isLocalName } from "../ids";
import type { Kernel } from "../kernel";

interface Declaration {
	readonly pluginId: string;
	readonly metadata: MetadataOf<typeof KernelFlag>;
}

/**
 * Provides `kernel/flags` and the `kernel/flag:<id>` context keys.
 *
 * Declarations come from manifests (discovery), not the live registry, so a
 * plugin gated on its own flag declares it while inactive and can be started
 * by it. A flag's value is, in order: the host's override, the flag source's
 * value, its declared default. Values the source reports for undeclared
 * flags are ignored. The `flag-source` winner is followed like any exclusive
 * contribution: the kernel subscribes while it is bound and calls `identify`
 * with `kernel/identity` on binding and whenever the identity changes.
 * Without a source, flags are `ready` at once with their defaults; with one,
 * `ready` waits for its first values.
 */
export function provideFlags(
	core: Kernel,
	overrides: Readonly<Record<string, FlagValue>> = {},
): void {
	const sdk = core.kernelSdk;
	const declarations = collectDeclarations(core);

	let source: FlagSource | undefined;
	let stopSource: (() => void) | undefined;

	const snapshot = () => {
		const values = source ? safely(() => source!.values(), null) : {};
		const flags: Record<string, FlagRecord> = {};
		for (const [id, { pluginId, metadata }] of declarations) {
			const [value, origin] =
				id in overrides
					? [overrides[id]!, "override" as const]
					: values && id in values
						? [values[id]!, "source" as const]
						: [metadata.default, "default" as const];
			flags[id] = {
				value,
				default: metadata.default,
				description: metadata.description,
				pluginId,
				origin,
			};
		}
		return { ready: values !== null, flags };
	};

	const safely = <T>(read: () => T, fallback: T): T => {
		try {
			return read();
		} catch (error) {
			sdk.logger.error("The flag source failed", error);
			return fallback;
		}
	};

	const provider: DomainObjectProvider<typeof KernelFlags> = sdk.domainObjects.provide(
		KernelFlags,
		{
			initialState: snapshot(),
			methods: {},
		},
	);

	const publish = () => {
		const previous = provider.state;
		const next = snapshot();
		const changed = [...declarations.keys()].filter(
			(id) => previous.flags[id]?.value !== next.flags[id]?.value,
		);
		if (changed.length === 0 && previous.ready === next.ready) return;
		provider.setState(next);
		for (const id of changed) sdk.context.set(`flag:${id}`, next.flags[id]!.value === true);
		if (changed.length > 0) provider.emit("changed", { ids: changed });
	};
	for (const [id, flag] of Object.entries(provider.state.flags)) {
		sdk.context.set(`flag:${id}`, flag.value === true);
	}

	const identify = () => {
		const identity = sdk.domainObjects.get(KernelIdentity)?.getState();
		if (!source || !identity) return;
		const failed = (error: unknown) =>
			sdk.logger.error("The flag source failed to identify", error);
		try {
			void Promise.resolve(source.identify(identity)).catch(failed);
		} catch (error) {
			failed(error);
		}
	};

	const follow = () => {
		const winner = core.extensions.exclusive(KernelFlagSource).winner?.implementation;
		if (winner === source) return;
		stopSource?.();
		stopSource = undefined;
		source = winner;
		if (source) {
			stopSource = safely(() => source!.subscribe(publish), undefined);
			identify();
		}
		publish();
	};

	core.extensions.subscribe((extensionPointId) => {
		if (extensionPointId === KernelFlagSource.id) follow();
	});
	sdk.domainObjects.get(KernelIdentity)?.on("changed", identify);
}

/** Flag declarations from every manifest, by flag id; the first plugin to declare an id keeps it. */
function collectDeclarations(core: Kernel): Map<string, Declaration> {
	const declarations = new Map<string, Declaration>();
	for (const contribution of core.discovery.contributions) {
		if (contribution.pointId !== KernelFlag.id) continue;
		const { id } = contribution.entry;
		const existing = declarations.get(id);
		if (existing) {
			core.kernelSdk.logger.warn(
				`Flag "${id}" from "${contribution.pluginId}" is ignored: "${existing.pluginId}" declares it.`,
			);
		} else if (!isLocalName(flagKey(id).slice("kernel/".length))) {
			core.kernelSdk.logger.warn(`Flag "${id}" from "${contribution.pluginId}" has an invalid id.`);
		} else {
			declarations.set(id, {
				pluginId: contribution.pluginId,
				metadata: contribution.entry.metadata as Declaration["metadata"],
			});
		}
	}
	return declarations;
}
