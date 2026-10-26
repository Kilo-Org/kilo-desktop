import { useState } from "react";

export function useCopyToClipboard(
	writeText: (value: string) => Promise<void>,
	{ copiedDuration = 3000 }: { copiedDuration?: number } = {},
) {
	const [isCopied, setIsCopied] = useState<boolean>(false);

	const copyToClipboard = (value: string) => {
		if (!value) return;

		void writeText(value).then(
			() => {
				setIsCopied(true);
				setTimeout(() => setIsCopied(false), copiedDuration);
			},
			() => {},
		);
	};

	return { isCopied, copyToClipboard };
}
