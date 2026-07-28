import { ipcMain, type IpcMain } from "electron";

import {
	ipcMethods,
	type IpcHandlers,
	type IpcMethodChannel,
	type IpcResult,
} from "@anaconda-agentic-desktop/contracts";

import { BusinessError } from "./BusinessError.js";
import { isTrustedIpcSender } from "./ElectronSecurity.js";

function failure(code: "VALIDATION" | "AUTHORIZATION" | "BUSINESS" | "INTERNAL", message: string) {
	return { ok: false, error: { code, message } } as const;
}

export class IpcServer {
	#channels: IpcMethodChannel[] = [];

	constructor(private readonly electronIpcMain: IpcMain = ipcMain) {}

	register(handlers: IpcHandlers): void {
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
					console.error(`IPC handler failed for ${channel}`, error);
					return failure("INTERNAL", "The desktop operation failed.");
				}
			});
			this.#channels.push(channel);
		}
	}

	dispose(): void {
		for (const channel of this.#channels) this.electronIpcMain.removeHandler(channel);
		this.#channels = [];
	}
}
