"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type FC } from "react";

import { AnimatedKiloLogo } from "./animated-kilo-logo.js";
import { KiloLogo } from "./kilo-logo.js";

/**
 * Square Kilo mark for the draft welcome. Hover motion matches Kilo Cloud's
 * HeaderLogo (rotate + yellow Lottie crossfade) without the "Kilo" wordmark.
 * `lottieEnabled` stays false until the welcome headline has finished entering
 * so the WASM player cannot stall that fade-in; both layers stay mounted so
 * hover never flashes empty.
 */
export const KiloWelcomeLogo: FC<{ lottieEnabled?: boolean }> = ({ lottieEnabled = false }) => {
	const [isHovered, setIsHovered] = useState(false);
	const [lottieMounted, setLottieMounted] = useState(false);
	const showLottie = lottieEnabled || lottieMounted;

	return (
		<motion.div
			data-qa-id="kilo-welcome-logo"
			aria-hidden="true"
			className="text-muted-foreground/30 mb-4 hover:text-[#F0F042] dark:hover:text-yellow-200"
			onHoverStart={() => {
				setLottieMounted(true);
				setIsHovered(true);
			}}
			onHoverEnd={() => setIsHovered(false)}
			whileTap={{ y: -6 }}
		>
			<motion.div
				className="relative flex size-12 flex-none items-center justify-center overflow-hidden font-bold"
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
						className="absolute top-0 left-0 size-12"
					>
						{showLottie ? <AnimatedKiloLogo /> : <KiloLogo />}
					</motion.div>
					<motion.div
						key="static"
						initial={{ opacity: isHovered ? 0 : 1 }}
						animate={{ opacity: isHovered ? 0 : 1 }}
						exit={{ opacity: isHovered ? 0 : 1 }}
						transition={{ duration: 0.2 }}
						className="absolute top-0 left-0 size-12"
					>
						<KiloLogo />
					</motion.div>
				</AnimatePresence>
			</motion.div>
		</motion.div>
	);
};
