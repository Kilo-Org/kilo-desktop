import {
	KERNEL_OWNER,
	KernelError,
	type DomainObjectCaller,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { CORE_PLUGIN_ID, KiloServer, KiloWorkStyle } from "../../contracts";
import {
	applyWorkStyle,
	findConflictingPermissionKeys,
	type CreateKiloWorkStyleClient,
	type KiloWorkStyleClient,
} from "./apply-work-style";
import type { AppliedWorkStyle } from "./work-style-presets";

export type { CreateKiloWorkStyleClient, KiloWorkStyleClient } from "./apply-work-style";

/**
 * The `kilo.core/work-style` domain object: how much the agent may do without
 * asking, written as permission rules into the user's own global Kilo config
 * through the running server (`kilo.core/server`'s connection, so `conflicts`
 * and `apply` start the server when needed).
 *
 * Review first replaces the preset's permission keys and remembers, for this
 * session only, what they held before; switching back to High autonomy
 * restores exactly that while the preset is still in place, and otherwise
 * writes nothing. The memory is deliberately not persisted: after a restart
 * there is no safe record of what the user's config held, so High autonomy
 * leaves the config alone. Applies run one at a time so a second one plans
 * from the config the first one wrote.
 *
 * Both methods change (or inspect) the user's own config, shared with the
 * Kilo CLI and VS Code, so they are refused to every caller but kilo.core,
 * kilo.shell (its onboarding step) and the main kernel.
 */

export interface WorkStyleOptions {
	/** A client for the running Kilo server's global config. */
	readonly createClient: CreateKiloWorkStyleClient;
}

const WORK_STYLE_CALLERS: ReadonlySet<string> = new Set([CORE_PLUGIN_ID, "kilo.shell"]);

function assertWorkStyleCaller(caller: DomainObjectCaller): void {
	if (WORK_STYLE_CALLERS.has(caller.pluginId)) return;
	if (caller.pluginId === KERNEL_OWNER && caller.process === "main") return;
	throw new KernelError("PERMISSION_DENIED", "Only kilo.core and kilo.shell set the work style.");
}

export function activateWorkStyle(sdk: PluginSdk, options: WorkStyleOptions): void {
	let applied: AppliedWorkStyle | null = null;
	let applying: Promise<unknown> = Promise.resolve();

	const workStyle = sdk.domainObjects.provide(KiloWorkStyle, {
		initialState: { style: null },
		methods: {
			conflicts: async (_input, caller) => {
				assertWorkStyleCaller(caller);
				return { keys: await findConflictingPermissionKeys(await connectClient()) };
			},
			apply: ({ style }, caller) => {
				assertWorkStyleCaller(caller);
				const run = applying.then(async () => {
					const client = await connectClient();
					const result = await applyWorkStyle(client, style, applied).catch(explainFailure);
					applied = result.applied;
					workStyle.setState({ style });
				});
				applying = run.catch(() => undefined);
				return run;
			},
		},
	});

	/** Kilo's own message (a read-only config, say) is what the person needs to fix it. */
	function explainFailure(error: unknown): never {
		sdk.logger.warn("Could not apply the work style", error);
		if (error instanceof KernelError) throw error;
		const message = error instanceof Error && error.message ? error.message : undefined;
		throw new KernelError("BUSINESS", message ?? "Could not save your work style.", {
			cause: error,
		});
	}

	async function connectClient(): Promise<KiloWorkStyleClient> {
		const server = sdk.domainObjects.get(KiloServer);
		if (!server) throw new KernelError("UNAVAILABLE", "The Kilo server isn't available.");
		return options.createClient(await server.methods.connect(undefined));
	}
}
