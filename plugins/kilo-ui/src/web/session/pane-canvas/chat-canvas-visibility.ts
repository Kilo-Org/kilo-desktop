export function shouldShowChatCanvas(args: {
	readonly hasMessages: boolean;
	readonly hasExtraPanes: boolean;
	readonly remoteId: string | undefined;
	readonly status: string;
}): boolean {
	if (args.status === "new" && !args.hasMessages) return false;
	return args.hasMessages || args.hasExtraPanes || Boolean(args.remoteId?.trim());
}
