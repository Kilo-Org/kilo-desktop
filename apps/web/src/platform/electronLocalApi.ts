import {
	LocalApiError,
	type DesktopApi,
	type IpcInvokeArguments,
	type IpcMethodChannel,
	type IpcMethodOutput,
	type LocalApi,
} from "@anaconda-agentic-desktop/contracts";

export function createElectronLocalApi(bridge: DesktopApi): LocalApi {
	const invoke = async <C extends IpcMethodChannel>(
		channel: C,
		...args: IpcInvokeArguments<C>
	): Promise<IpcMethodOutput<C>> => {
		const result = await bridge.invoke(channel, ...args);
		if (!result.ok) {
			throw new LocalApiError(result.error.code, result.error.message);
		}
		return result.value;
	};

	return {
		todos: {
			list: () => invoke("todos:list"),
			add: (input) => invoke("todos:add", input),
			toggle: (input) => invoke("todos:toggle", input),
		},
		theme: {
			get: () => invoke("theme:get"),
			set: (input) => invoke("theme:set", input),
			onChanged: (listener) => bridge.on("theme:changed", listener),
		},
		shell: {
			openExternal: (input) => invoke("shell:open-external", input),
			copyText: (input) => invoke("shell:copy-text", input),
		},
	};
}
