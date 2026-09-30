"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type FC } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { AnimatedKiloLogo } from "./animated-kilo-logo.js";
import { KiloLogo } from "./kilo-logo.js";

/**
 * Square Kilo mark for the draft welcome. Hover motion matches Kilo Cloud's
 * HeaderLogo (rotate + yellow Lottie crossfade) without the "Kilo" wordmark.
 * `lottieEnabled` stays false until the welcome headline has finished entering
 * so the WASM player cannot stall that fade-in; both layers stay mounted so
 * hover never flashes empty.
 */
export const KiloWelcomeLogo: FC<{
	lottieEnabled?: boolean;
	/** Overrides the wrapper's colour / spacing classes. */
	className?: string;
	/** Size classes for the mark (default `size-12`). */
	sizeClassName?: string;
}> = ({ lottieEnabled = false, className, sizeClassName = "size-12" }) => {
	const [isHovered, setIsHovered] = useState(false);
	const [lottieMounted, setLottieMounted] = useState(false);
	const showLottie = lottieEnabled || lottieMounted;

	return (
		<motion.div
			data-qa-id="kilo-welcome-logo"
			aria-hidden="true"
			className={cn(
				"text-muted-foreground/30 mb-4 hover:text-[#F0F042] dark:hover:text-yellow-200",
				className,
			)}
			onHoverStart={() => {
				setLottieMounted(true);
				setIsHovered(true);
			}}
			onHoverEnd={() => setIsHovered(false)}
			whileTap={{ y: -6 }}
		>
			<motion.div
				className={cn(
					"relative flex flex-none items-center justify-center overflow-hidden font-bold",
					sizeClassName,
				)}
				animate={{ rotate: isHovered ? 90 : 0 }}
				transition={{ duration: 0.3, ease: "easeInOut" }}
				style={{ transformStyle: "preserve-3d" }}
			>
				<AnimatePresence>
					<motion.div
						key="animated"
						initial={{ opacity: isHovered ? 1 : 0 }}
						animate={{
							opacity: isHovered ? 1 : 0,
							rotate: isHovered ? 270 : 0,
						}}
						exit={{ opacity: isHovered ? 1 : 0 }}
						transition={{ duration: 0.2 }}
						className={cn("absolute top-0 left-0", sizeClassName)}
					>
						{showLottie ? <AnimatedKiloLogo /> : <KiloLogo />}
					</motion.div>
					<motion.div
						key="static"
						initial={{ opacity: isHovered ? 0 : 1 }}
						animate={{ opacity: isHovered ? 0 : 1 }}
						exit={{ opacity: isHovered ? 0 : 1 }}
						transition={{ duration: 0.2 }}
						className={cn("absolute top-0 left-0", sizeClassName)}
					>
						<KiloLogo />
					</motion.div>
				</AnimatePresence>
			</motion.div>
		</motion.div>
	);
};
