import { ipcMain, type IpcMain } from "electron";

import {
	ipcMethods,
	ipcMessages,
	type IpcHandlers,
	type IpcMessageChannel,
	type IpcMessageHandlers,
	type IpcMethodChannel,
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

	constructor(
		private readonly electronIpcMain: IpcMain = ipcMain,
		private readonly logger: IpcLogger = createLogger("ipc"),
	) {}

	register(handlers: IpcHandlers, messageHandlers?: IpcMessageHandlers): void {
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
					return failure("INTERNAL", "The desktop operation failed.");
				}
			});
			this.#channels.push(channel);
		}

		if (!messageHandlers) return;
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
	}

	dispose(): void {
		for (const channel of this.#channels) this.electronIpcMain.removeHandler(channel);
		this.#channels = [];
		for (const [channel, listener] of this.#messageListeners) {
			this.electronIpcMain.removeListener(channel, listener);
		}
		this.#messageListeners.clear();
	}
}
