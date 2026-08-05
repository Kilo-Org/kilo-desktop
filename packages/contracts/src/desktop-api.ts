import type { z } from "zod";

import type { ipcEvents, ipcMessages, ipcMethods } from "./registry.js";
import type { IpcResult } from "./result.js";

export type IpcMethodChannel = keyof typeof ipcMethods;
export type IpcEventChannel = keyof typeof ipcEvents;
export type IpcMessageChannel = keyof typeof ipcMessages;

export type IpcMethodInput<TChannel extends IpcMethodChannel> = z.input<
	(typeof ipcMethods)[TChannel]["input"]
>;
export type IpcMethodOutput<TChannel extends IpcMethodChannel> = z.output<
	(typeof ipcMethods)[TChannel]["output"]
>;
export type IpcEventPayload<TChannel extends IpcEventChannel> = z.output<
	(typeof ipcEvents)[TChannel]["payload"]
>;
export type IpcMessagePayload<TChannel extends IpcMessageChannel> = z.input<
	(typeof ipcMessages)[TChannel]["payload"]
>;

export type InvokeArguments<TChannel extends IpcMethodChannel> =
	IpcMethodInput<TChannel> extends undefined
		? [input?: undefined]
		: [input: IpcMethodInput<TChannel>];

export interface DesktopApi {
	/** Preload-only resolver for Electron's opaque dropped File objects. */
	getPathForFile(file: File): string | null;
	invoke<TChannel extends IpcMethodChannel>(
		channel: TChannel,
		...args: InvokeArguments<TChannel>
	): Promise<IpcResult<IpcMethodOutput<TChannel>>>;
	on<TChannel extends IpcEventChannel>(
		channel: TChannel,
		listener: (payload: IpcEventPayload<TChannel>) => void,
	): () => void;
	send<TChannel extends IpcMessageChannel>(
		channel: TChannel,
		payload: IpcMessagePayload<TChannel>,
	): void;
}

export type IpcHandlers = {
	[TChannel in IpcMethodChannel]: (
		input: IpcMethodInput<TChannel>,
	) => IpcMethodOutput<TChannel> | Promise<IpcMethodOutput<TChannel>>;
};

export interface IpcMessageContext {
	/** Electron webContents id of the trusted renderer that sent the message. */
	senderId: number;
}

export type IpcMessageHandlers = {
	[TChannel in IpcMessageChannel]: (
		payload: IpcMessagePayload<TChannel>,
		context: IpcMessageContext,
	) => void;
};
