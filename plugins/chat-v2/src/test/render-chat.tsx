// The test host with kilo.chat's real entries, as the old chat-host booted
// them by default: kilo.chat's main (its domain objects over kilo.core's and
// kilo.work-sessions' stand-ins) and window entries.
import { createChatMainEntry } from "../main/entry";
import { chatWebEntry } from "../web";
import { renderAgentPane, type ChatHostOptions } from "./chat-host";

export function renderChat(options: ChatHostOptions = {}) {
	return renderAgentPane({
		chatMain: createChatMainEntry(),
		chatWeb: chatWebEntry,
		...options,
	});
}
