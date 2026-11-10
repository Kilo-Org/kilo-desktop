import {
	KernelDataCollection,
	KernelIdentity,
	KernelTelemetry,
	KernelTelemetryEvent,
	KernelTelemetrySink,
	type TelemetryEnvelope,
} from "../builtins";
import type { QualifiedId } from "../ids";
import type { Kernel } from "../kernel";

/**
 * Provides `kernel/telemetry`. Every event passes two gates before any sink
 * sees it: consent (`kernel/data-collection`'s `allowed`, read per event so a
 * change applies at once; without the host's consent object nothing is sent)
 * and declaration (the caller's manifest contributes a `telemetry-event` with
 * that id). Sinks are called in parallel; one that throws is logged and the
 * others still deliver. `track` resolves once every sink has settled and
 * never rejects for a delivery problem, so telemetry can't break a caller.
 */
export function provideTelemetry(core: Kernel): void {
	const sdk = core.kernelSdk;
	const names = new Map<QualifiedId, string>();
	for (const contribution of core.discovery.contributions) {
		if (contribution.pointId !== KernelTelemetryEvent.id) continue;
		const { name } = contribution.entry.metadata as { name: string };
		names.set(`${contribution.pluginId}/${contribution.entry.id}`, name);
	}

	sdk.domainObjects.provide(KernelTelemetry, {
		initialState: {},
		methods: {
			track: async ({ event, data }, caller) => {
				const consent = sdk.domainObjects.get(KernelDataCollection)?.getState();
				if (!consent?.allowed) return;
				const key: QualifiedId = `${caller.pluginId}/${event}`;
				const name = names.get(key);
				if (name === undefined) {
					sdk.logger.warn(`Telemetry event "${key}" is not declared; dropped.`);
					return;
				}
				const envelope: TelemetryEnvelope = {
					name,
					key,
					pluginId: caller.pluginId,
					data,
					identity: sdk.domainObjects.get(KernelIdentity)?.getState() ?? {
						primary: null,
						linked: [],
					},
					installationId: consent.installationId,
					environment: consent.environment,
					timestamp: Date.now(),
				};
				await Promise.all(
					core.extensions.list(KernelTelemetrySink).map(async (sink) => {
						try {
							await sink.implementation?.deliver(envelope);
						} catch (error) {
							sdk.logger.error(`Telemetry sink "${sink.key}" failed`, error);
						}
					}),
				);
			},
		},
	});
}
