import {
	LocalApiError,
	type DesktopApi,
	type InvokeArguments,
	type IpcMethodChannel,
	type IpcMethodOutput,
	type LocalApi,
} from "@anaconda-agentic-desktop/contracts";

export function createElectronLocalApi(bridge: DesktopApi): LocalApi {
	const invoke = async <C extends IpcMethodChannel>(
		channel: C,
		...args: InvokeArguments<C>
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
			sync: (input) => invoke("theme:sync", input),
		},
		shell: {
			openExternal: (input) => invoke("shell:open-external", input),
			copyText: (input) => invoke("shell:copy-text", input),
		},
	};
}
