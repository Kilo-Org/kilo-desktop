import type { ElectronMainPort } from "@runtimed/node/electron";

import type { KernelPort } from "@kilo-desktop/kernel";

type MessageListener = (event: { data: unknown }) => void;
type CloseListener = () => void;

/** Presents the kernel's end of a frame's port as the Electron port nteract's host adapter serves. */
export function electronMainPort(port: KernelPort): ElectronMainPort {
	const subscriptions = new Map<MessageListener | CloseListener, () => void>();
	const adapter: ElectronMainPort = {
		postMessage: (message) => port.postMessage(message),
		on(event: "message" | "close", listener: MessageListener | CloseListener) {
			if (subscriptions.has(listener)) return adapter;
			subscriptions.set(
				listener,
				event === "message"
					? port.onMessage((data) => (listener as MessageListener)({ data }))
					: port.onClose(listener as CloseListener),
			);
			return adapter;
		},
		off(_event: "message" | "close", listener: MessageListener | CloseListener) {
			subscriptions.get(listener)?.();
			subscriptions.delete(listener);
			return adapter;
		},
		start: () => undefined,
		close: () => port.close(),
	} as ElectronMainPort;
	return adapter;
}
