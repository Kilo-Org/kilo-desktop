import { cn } from "@kilo-desktop/ui/lib/utils";

import { MAIN_AGENT_COLOR, WORKER_COLORS } from "./swarm-colors";
import { AgentAvatar } from "./swarm-parts";
import { isActive, type TeamMember } from "./swarm-team";

/** Faces shown before the rest fold into "+N". */
const MAX_FACES = 6;

const faceName = (member: TeamMember) => (member.main ? "Main agent" : member.title);

function faceState(member: TeamMember): string {
	if (member.needsYou) return "needs you";
	if (isActive(member.state)) return "working";
	return member.main ? "idle" : "finished";
}

/**
 * A team as a stack of overlapping faces, the main agent first: a working
 * agent in its own color, a stopped one greyed, and one waiting on the person
 * ringed in the text color. With `onOpen` the workers' faces are buttons.
 */
export function SwarmFaces({
	team,
	colors,
	onOpen,
	faceQaId,
}: {
	readonly team: readonly TeamMember[];
	readonly colors: ReadonlyMap<string, string>;
	readonly onOpen?: (member: TeamMember) => void;
	readonly faceQaId?: string;
}) {
	const shown = team.slice(0, MAX_FACES);
	const folded = team.length - shown.length;
	return (
		<span className="flex shrink-0 items-center">
			{shown.map((member, index) => {
				const name = faceName(member);
				const color =
					colors.get(member.chatId) ??
					(member.main
						? MAIN_AGENT_COLOR
						: WORKER_COLORS[Math.max(index - 1, 0) % WORKER_COLORS.length]!);
				const face = (
					<span
						className={cn(
							"bg-background flex rounded-full p-px",
							member.needsYou && "ring-foreground ring-[1.5px]",
							!member.needsYou && !isActive(member.state) && "opacity-55 grayscale",
						)}
						data-state={member.needsYou ? "needs-you" : member.state}
					>
						<AgentAvatar name={name} color={color} size="sm" />
					</span>
				);
				const title = `${name}: ${faceState(member)}`;
				const overlap = "relative -ms-1.5 first:ms-0";
				if (onOpen && !member.main) {
					return (
						<button
							key={member.chatId}
							type="button"
							className={cn(
								overlap,
								"focus-visible:ring-ring rounded-full outline-none hover:z-10 focus-visible:z-10 focus-visible:ring-2",
							)}
							aria-label={`Open ${name} (${faceState(member)})`}
							title={title}
							onClick={() => onOpen(member)}
							data-qa-id={faceQaId}
						>
							{face}
						</button>
					);
				}
				return (
					<span key={member.chatId} className={overlap} title={title}>
						{face}
					</span>
				);
			})}
			{folded > 0 ? (
				<span className="text-muted-foreground ps-1 text-xs tabular-nums">+{folded}</span>
			) : null}
		</span>
	);
}
