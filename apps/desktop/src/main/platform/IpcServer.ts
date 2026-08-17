import { ipcMain, type IpcMain } from "electron";
import * as Sentry from "@sentry/electron/main";

import {
	ipcMethods,
	ipcMessages,
	ipcPorts,
	type IpcHandlers,
	type IpcMessageChannel,
	type IpcMessageHandlers,
	type IpcMethodChannel,
	type IpcPortChannel,
	type IpcPortHandlers,
	type IpcResult,
} from "@anaconda-agentic-desktop/contracts";

import { BusinessError } from "./BusinessError.js";
import { isTrustedIpcSender } from "./ElectronSecurity.js";
import { createLogger, type Logger } from "./logger.js";

type IpcLogger = Pick<Logger, "error">;

function failure(code: "VALIDATION" | "AUTHORIZATION" | "BUSINESS" | "INTERNAL", message: string) {
	return { ok: false, error: { code, message } } as const;
}

export class IpcServer {
	#channels: IpcMethodChannel[] = [];
	#messageListeners = new Map<IpcMessageChannel, Parameters<IpcMain["removeListener"]>[1]>();
	#portListeners = new Map<IpcPortChannel, Parameters<IpcMain["removeListener"]>[1]>();

	constructor(
		private readonly electronIpcMain: IpcMain = ipcMain,
		private readonly logger: IpcLogger = createLogger("ipc"),
	) {}

	register(
		handlers: IpcHandlers,
		messageHandlers?: IpcMessageHandlers,
		portHandlers?: IpcPortHandlers,
	): void {
		this.dispose();
		for (const channel of Object.keys(ipcMethods) as IpcMethodChannel[]) {
			this.electronIpcMain.handle(channel, async (event, rawInput: unknown) => {
				if (!isTrustedIpcSender(event)) {
					return failure("AUTHORIZATION", "The IPC sender is not trusted.");
				}

				const contract = ipcMethods[channel];
				const parsedInput = contract.input.safeParse(rawInput);
				if (!parsedInput.success) {
					return failure("VALIDATION", "The IPC request payload is invalid.");
				}

				try {
					const handler = handlers[channel] as (input: unknown) => unknown;
					const rawOutput = await handler(parsedInput.data);
					const parsedOutput = contract.output.safeParse(rawOutput);
					if (!parsedOutput.success) {
						return failure("INTERNAL", "The IPC handler returned an invalid response.");
					}
					return {
						ok: true,
						value: parsedOutput.data,
					} satisfies IpcResult<unknown>;
				} catch (error) {
					if (error instanceof BusinessError) {
						return failure("BUSINESS", error.message);
					}
					this.logger.error(`IPC handler failed for ${channel}`, error);
					Sentry.captureException(error, { tags: { ipc_channel: channel } });
					return failure("INTERNAL", "The desktop operation failed.");
				}
			});
			this.#channels.push(channel);
		}

		if (messageHandlers)
			for (const channel of Object.keys(ipcMessages) as IpcMessageChannel[]) {
				const listener = (event: Electron.IpcMainEvent, rawPayload: unknown): void => {
					if (!isTrustedIpcSender(event)) return;
					const parsedPayload = ipcMessages[channel].payload.safeParse(rawPayload);
					if (!parsedPayload.success) return;
					try {
						messageHandlers[channel](parsedPayload.data, { senderId: event.sender.id });
					} catch (error) {
						this.logger.error(`IPC message handler failed for ${channel}`, error);
					}
				};
				this.electronIpcMain.on(channel, listener);
				this.#messageListeners.set(channel, listener);
			}

		if (portHandlers)
			for (const channel of Object.keys(ipcPorts) as IpcPortChannel[]) {
				const listener = (event: Electron.IpcMainEvent, rawPayload: unknown): void => {
					const transferredPorts = event.ports;
					if (!isTrustedIpcSender(event) || transferredPorts.length !== 1) {
						for (const port of transferredPorts) port.close();
						return;
					}
					const parsedPayload = ipcPorts[channel].payload.safeParse(rawPayload);
					if (!parsedPayload.success) {
						transferredPorts[0]!.close();
						return;
					}
					const port = transferredPorts[0]!;
					const rejectPort = (error: unknown): void => {
						port.close();
						this.logger.error(`IPC port handler failed for ${channel}`, error);
						Sentry.captureException(error, { tags: { ipc_channel: channel } });
					};
					try {
						void Promise.resolve(
							portHandlers[channel](parsedPayload.data, { senderId: event.sender.id, port }),
						).catch(rejectPort);
					} catch (error) {
						rejectPort(error);
					}
				};
				this.electronIpcMain.on(channel, listener);
				this.#portListeners.set(channel, listener);
			}
	}

	dispose(): void {
		for (const channel of this.#channels) this.electronIpcMain.removeHandler(channel);
		this.#channels = [];
		for (const [channel, listener] of this.#messageListeners) {
			this.electronIpcMain.removeListener(channel, listener);
		}
		this.#messageListeners.clear();
		for (const [channel, listener] of this.#portListeners) {
			this.electronIpcMain.removeListener(channel, listener);
		}
		this.#portListeners.clear();
	}
}
