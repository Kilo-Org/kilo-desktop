import useMountedState from "react-use/esm/useMountedState.js";
import useSetState from "react-use/esm/useSetState.js";

export type WriteText = (text: string) => Promise<void>;

export interface CopyToClipboardState {
	readonly value?: string | undefined;
	readonly error?: Error | undefined;
}

/**
 * react-use's `useCopyToClipboard`, with the writer injected and async.
 * react-use writes through `copy-to-clipboard` (DOM `execCommand`, falling
 * back to `window.prompt`); the app's renderer copies through the host
 * clipboard (`kernel/clipboard`), which this package can't import. Each
 * copy sets a new state, whether it repeats the last value or not.
 */
export function useCopyToClipboard(
	writeText: WriteText,
): [CopyToClipboardState, (value: string) => void] {
	const isMounted = useMountedState();
	const [state, setState] = useSetState<CopyToClipboardState>({
		value: undefined,
		error: undefined,
	});

	const copyToClipboard = (value: string) => {
		if (!isMounted()) return;
		if (value === "") {
			setState({ value, error: new Error("Cannot copy empty string to clipboard.") });
			return;
		}
		writeText(value).then(
			() => {
				if (isMounted()) setState({ value, error: undefined });
			},
			(error: unknown) => {
				if (!isMounted()) return;
				setState({ value, error: error instanceof Error ? error : new Error(String(error)) });
			},
		);
	};

	return [state, copyToClipboard];
}
