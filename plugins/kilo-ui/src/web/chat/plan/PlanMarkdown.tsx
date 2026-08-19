import { MarkdownContent } from "@anaconda-agentic-desktop/ui/components/markdown-content";
import { type FC, memo } from "react";

type PlanMarkdownProps = {
	text: string;
	className?: string;
};

const PlanMarkdownImpl: FC<PlanMarkdownProps> = ({ text, className }) => {
	return <MarkdownContent className={className} data-slot="plan-markdown" text={text} />;
};

export const PlanMarkdown = memo(PlanMarkdownImpl);
