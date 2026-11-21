// Stand-ins for what the repository actions use beyond kilo.git: kilo.core's
// generation and models (under kilo.core's real manifest, through
// `bootGitHost`'s `coreMain`), kilo.chat's composer (its `chatWeb`), and a
// telemetry sink with consent, so tracked events arrive as the kernel sends them.
import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelTelemetrySink,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import { Generation, Models, type GenerateInput } from "@kilo-desktop/plugin-core/contracts";

import type { GitHost, GitHostOptions } from "./git-host";

export const PREFERRED_MODEL = { aiProviderId: "kilo", modelId: "fast", variant: "low" };

export function actionCollaborators() {
	const generated: GenerateInput[] = [];
	const delivered: TelemetryEnvelope[] = [];
	const inserted: unknown[] = [];
	let answer: Record<string, unknown> = { message: "Fix the login" };
	const unused = () => {
		throw new KernelError("NOT_FOUND", "unused");
	};
	const coreMain = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Generation, {
				initialState: {},
				methods: {
					generate: (input) => {
						generated.push(input);
						return answer;
					},
					generateBranchName: unused,
				},
			});
			sdk.domainObjects.provide(Models, {
				initialState: {
					ready: true,
					followingAccount: false,
					aiProviders: {},
					models: {},
					defaults: {},
					preferences: {
						byAgent: {},
						preferred: PREFERRED_MODEL,
						variants: {},
						recent: [],
						favorites: [],
						autoFreeModels: true,
					},
					gatewayCatalog: { details: [], fetchedAt: null },
				},
				methods: new Proxy({}, { get: () => unused }) as never,
			});
		},
	});
	const chatWeb = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Composer, {
				initialState: { focusedWorkSessionId: null },
				methods: {
					focus: unused,
					insert: (input) => void inserted.push(input),
					startChat: unused,
					prefillNewSession: unused,
				},
			});
		},
	});
	const sink = testPlugin("test.telemetry-sink", {
		manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: (envelope) => void delivered.push(envelope),
				});
			},
		},
	});
	const options: Pick<GitHostOptions, "coreMain" | "chatWeb" | "main"> = {
		coreMain,
		chatWeb,
		main: [sink],
	};
	return {
		options,
		generated,
		inserted,
		/** Tracked events as delivered: `[key, data]`. */
		tracked: () => delivered.map(({ key, data }) => [key, data]),
		answer: (next: Record<string, unknown>) => (answer = next),
		/** Consents to data collection, so tracked events reach the sink. */
		consent: (host: GitHost) =>
			host.main.kernelSdk.domainObjects.provide(KernelDataCollection, {
				initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
				methods: { setChoice: () => {} },
			}),
	};
}
