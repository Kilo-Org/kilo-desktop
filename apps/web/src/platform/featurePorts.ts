import { FEATURE_PORT_WINDOW_MESSAGE, featurePortPayload } from "@kilo-desktop/contracts";

/**
 * Create a renderer-owned channel and transfer its peer through the isolated
 * preload. The preload accepts only this exact same-window, same-origin shape.
 */
export function openFeaturePort(featureId: string, channel: string, args?: unknown): MessagePort {
	const message = featurePortPayload.parse({
		type: FEATURE_PORT_WINDOW_MESSAGE,
		featureId,
		channel,
		...(args === undefined ? {} : { args }),
	});
	const ports = new MessageChannel();
	window.postMessage(message, window.location.origin, [ports.port2]);
	return ports.port1;
}
