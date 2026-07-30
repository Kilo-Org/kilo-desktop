import type { z } from "zod";

import type { ipcEvents, ipcMethods } from "./registry.js";
import type { IpcResult } from "./result.js";

export type IpcMethodChannel = keyof typeof ipcMethods;
export type IpcEventChannel = keyof typeof ipcEvents;

export type IpcMethodInput<TChannel extends IpcMethodChannel> = z.input<
	(typeof ipcMethods)[TChannel]["input"]
>;
export type IpcMethodOutput<TChannel extends IpcMethodChannel> = z.output<
	(typeof ipcMethods)[TChannel]["output"]
>;
export type IpcEventPayload<TChannel extends IpcEventChannel> = z.output<
	(typeof ipcEvents)[TChannel]["payload"]
>;

export type IpcInvokeArguments<TChannel extends IpcMethodChannel> =
	IpcMethodInput<TChannel> extends undefined
		? [input?: undefined]
		: [input: IpcMethodInput<TChannel>];

export interface DesktopApi {
	invoke<TChannel extends IpcMethodChannel>(
		channel: TChannel,
		...args: IpcInvokeArguments<TChannel>
	): Promise<IpcResult<IpcMethodOutput<TChannel>>>;
	on<TChannel extends IpcEventChannel>(
		channel: TChannel,
		listener: (payload: IpcEventPayload<TChannel>) => void,
	): () => void;
}

export type IpcHandlers = {
	[TChannel in IpcMethodChannel]: (
		input: IpcMethodInput<TChannel>,
	) => IpcMethodOutput<TChannel> | Promise<IpcMethodOutput<TChannel>>;
};
