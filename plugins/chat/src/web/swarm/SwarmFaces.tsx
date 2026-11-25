import { cn } from "@kilo-desktop/ui/lib/utils";

import { MAIN_AGENT_COLOR, WORKER_COLORS } from "./swarm-colors";
import { AgentAvatar } from "./swarm-parts";
import { isActive, type TeamMember } from "./swarm-team";

/** Faces shown before the rest fold into "+N". */
const MAX_FACES = 4;

const faceName = (member: TeamMember) => (member.main ? "Main agent" : member.title);

function faceState(member: TeamMember): string {
	if (member.needsYou) return "needs you";
	if (isActive(member.state)) return "working";
	return member.main ? "idle" : "finished";
}

/** Each face's 2px ring in the surface behind the stack (`--swarm-face-ring`), so overlaps read cleanly. */
const RING = "0 0 0 2px var(--swarm-face-ring, var(--background))";

/**
 * A team as a stack of overlapping faces, the main agent first: a working
 * worker as its monster in its color, a stopped one greyed, and one waiting
 * on the person ringed in the text color; past four, a "+N" chip. With
 * `onOpen` the workers' faces are buttons.
 */
export function SwarmFaces({
	team,
	colors,
	onOpen,
	faceQaId,
	size = "sm",
}: {
	readonly team: readonly TeamMember[];
	readonly colors: ReadonlyMap<string, string>;
	readonly onOpen?: (member: TeamMember) => void;
	readonly faceQaId?: string;
	/** `md` (26px) where the faces lead a row, `sm` (20px) in tight spots. */
	readonly size?: "sm" | "md";
}) {
	const shown = team.slice(0, MAX_FACES);
	const folded = team.length - shown.length;
	const overlap = size === "md" ? "-ms-2.5" : "-ms-1.5";
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
						className="flex rounded-full"
						style={{
							boxShadow: member.needsYou ? `${RING}, 0 0 0 3.5px var(--foreground)` : RING,
						}}
						data-state={member.needsYou ? "needs-you" : member.state}
					>
						<AgentAvatar
							name={name}
							color={color}
							size={size}
							done={!member.main && !member.needsYou && !isActive(member.state)}
						/>
					</span>
				);
				const title = `${name}: ${faceState(member)}`;
				const place = cn("relative", index > 0 && overlap);
				if (onOpen && !member.main) {
					return (
						<button
							key={member.chatId}
							type="button"
							className={cn(
								place,
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
					<span key={member.chatId} className={place} title={title}>
						{face}
					</span>
				);
			})}
			{folded > 0 ? (
				<span
					className={cn(
						"bg-muted text-foreground/85 relative flex items-center justify-center rounded-full px-[7px] font-semibold tabular-nums",
						overlap,
						size === "md" ? "h-[26px] min-w-[26px] text-[11px]" : "h-5 min-w-5 text-[10px]",
					)}
					style={{
						boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent), ${RING}`,
					}}
					title={team
						.slice(MAX_FACES)
						.map((member) => faceName(member))
						.join(", ")}
				>
					+{folded}
				</span>
			) : null}
		</span>
	);
}
