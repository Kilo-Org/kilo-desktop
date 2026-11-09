import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";

import { Greetings, type GreetingsState } from "../contracts";

const selectGreetings = (state: GreetingsState) => state;

function describe({ count, last }: GreetingsState): string {
	if (count === 0 || last === null) return "No greetings yet.";
	return `${count} ${count === 1 ? "greeting" : "greetings"}, the last to ${last}.`;
}

/** Settings → Hello: the greetings so far, and buttons to add or clear them. */
export function HelloSettings() {
	const greetings = useDomain(Greetings);
	const state = useDomainState(Greetings, selectGreetings);
	if (!greetings || !state) {
		return <p className="text-muted-foreground text-sm">Greetings aren't available.</p>;
	}
	return (
		<div className="flex flex-col items-start gap-3" data-qa-id="hello-settings">
			<p className="text-sm" data-qa-id="hello-count">
				{describe(state)}
			</p>
			<div className="flex gap-2">
				<Button
					data-qa-id="hello-say-hello"
					onClick={() => void greetings.methods.greet({ name: "world" }).catch(() => {})}
				>
					Say hello
				</Button>
				<Button
					variant="outline"
					data-qa-id="hello-reset"
					disabled={state.count === 0}
					onClick={() => void greetings.methods.reset(undefined).catch(() => {})}
				>
					Reset
				</Button>
			</div>
		</div>
	);
}
