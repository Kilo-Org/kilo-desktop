import type { z } from "zod";

import type { ipcMethods } from "./registry.js";
import type { IpcResult } from "./result.js";

export type IpcMethodChannel = keyof typeof ipcMethods;

export type IpcMethodInput<TChannel extends IpcMethodChannel> = z.input<
	(typeof ipcMethods)[TChannel]["input"]
>;
export type IpcMethodOutput<TChannel extends IpcMethodChannel> = z.output<
	(typeof ipcMethods)[TChannel]["output"]
>;

export type InvokeArguments<TChannel extends IpcMethodChannel> =
	IpcMethodInput<TChannel> extends undefined
		? [input?: undefined]
		: [input: IpcMethodInput<TChannel>];

export interface DesktopApi {
	invoke<TChannel extends IpcMethodChannel>(
		channel: TChannel,
		...args: InvokeArguments<TChannel>
	): Promise<IpcResult<IpcMethodOutput<TChannel>>>;
}

export type IpcHandlers = {
	[TChannel in IpcMethodChannel]: (
		input: IpcMethodInput<TChannel>,
	) => IpcMethodOutput<TChannel> | Promise<IpcMethodOutput<TChannel>>;
};
