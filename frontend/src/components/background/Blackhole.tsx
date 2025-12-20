import { motion } from "framer-motion";
import svgPaths from "./imports/svg";


interface BlackHoleProps {
  isActivated?: boolean;
  className?: string;
}

export function BlackHole({ isActivated = false, className = "" }: BlackHoleProps) {
  return (
    <motion.div
      className={`relative ${className}`}
      style={{ width: "610px", height: "630px" }}
      animate={
        isActivated
          ? {
              scale: [1, 1.08, 1],
            }
          : {}
      }
      transition={{
        duration: 0.8,
        ease: "easeInOut",
      }}
    >
      {/*  Spiral  */}
      <motion.div
        className="absolute inset-0"
        animate={{
          rotate: isActivated ? [0, 360] : 360,
        }}
        transition={{
          duration: isActivated ? 2 : 20,
          ease: isActivated ? "easeOut" : "linear",
          repeat: Infinity,
        }}
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 697 722">
          <g>
            <path d={svgPaths.p32904e80} opacity="0" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p1a01f880} opacity="0.0241379" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p15ce5400} opacity="0.0482759" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p2ed3da00} opacity="0.0724138" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p2d154000} opacity="0.0965517" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.pd3402a0} opacity="0.12069" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p34e02600} opacity="0.144828" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p31cbab00} opacity="0.168966" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p29314b80} opacity="0.193103" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p1d305f30} opacity="0.217241" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.pa26b800} opacity="0.241379" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3264c500} opacity="0.265517" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3c80ec00} opacity="0.289655" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3ccb2700} opacity="0.313793" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p9524d00} opacity="0.337931" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p1739b400} opacity="0.362069" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p11de8a00} opacity="0.386207" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p1673d900} opacity="0.410345" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p2d35e200} opacity="0.434483" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.pae89c00} opacity="0.458621" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3e8e1700} opacity="0.482759" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3fe5ef40} opacity="0.506897" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p330f0000} opacity="0.531034" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p37e1e280} opacity="0.555172" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p17f4b900} opacity="0.57931" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p31f0b480} opacity="0.603448" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p28749880} opacity="0.627586" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p3fe85580} opacity="0.651724" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.pbe92400} opacity="0.675862" stroke="#FF951C" strokeWidth="2" />
            <path d={svgPaths.p35929a80} opacity="0.7" stroke="#FF951C" strokeWidth="2" />
          </g>
        </svg>
      </motion.div>

      {/* Glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {/* Outer glow layer which is transparent gray */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: "330px", height: "340px" }}
          animate={
            isActivated
              ? {
                  scale: [1, 1.4, 1],
                  opacity: [0.5, 0.8, 0.5],
                }
              : {}
          }
          transition={{
            duration: 0.8,
            ease: "easeInOut",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(255, 240, 220, 0.3) 0%, rgba(255, 220, 180, 0.2) 40%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
        </motion.div>

        {/* the biggest circle */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: "260px", height: "280px" }}
          animate={
            isActivated
              ? {
                  scale: [1, 1.2, 1],
                  opacity: [1, 1, 1],
                }
              : {}
          }
          transition={{
            duration: 0.6,
            ease: "easeInOut",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(159, 182, 227, 0.7) 0%, rgba(159, 182, 227, 0.7) 25%, rgba(245, 175, 106, 0.9) 70%, transparent 100%)",
              mixBlendMode: "lighten",
              filter: "blur(8px)",
            }}
          />
        </motion.div>

        {/* to provide a reddish colour */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: "180px", height: "180px" }}
          animate={
            isActivated
              ? {
                  scale: [1, 1.2, 1],
                  opacity: [1, 1, 1],
                }
              : {}
          }
          transition={{
            duration: 0.6,
            ease: "easeInOut",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "rgba(245, 106, 106, 0.9)",
              opacity: 0.18,
              mixBlendMode: "lighten",
              filter: "blur(14px)",
            }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}

export default BlackHole;