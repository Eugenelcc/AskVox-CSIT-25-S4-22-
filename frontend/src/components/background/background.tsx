import React, { useEffect } from "react";

const AskVoxStarBackground: React.FC = () => {
  useEffect(() => {
    const bg = document.querySelector(".bg");
    if (!bg) return;

    //This is to generate 60 stars
    for (let i = 0; i < 60; i++) {
      const s = document.createElement("div");
      s.className = "star";
      s.style.top = Math.random() * 100 + "vh";
      s.style.left = Math.random() * 100 + "vw";
      s.style.animationDelay = Math.random() * 4 + "s";
      bg.appendChild(s);
    }

    return () => {
      
      const stars = document.querySelectorAll(".star");
      stars.forEach((star) => star.remove());
    };
  }, []);

  return (
    <>
      <style>{`
        .bg {
          position: fixed;
          inset: 0;
          background: #000;
          overflow: hidden;
          pointer-events: none; /* ensure background never blocks clicks */
          z-index: -1;
        }

        .star {
          position: absolute;
          width: 2px;
          height: 2px;
          background: #ffae4a;
          border-radius: 50%;
          box-shadow: 0 0 6px #ffae4a, 0 0 12px rgba(255,150,50,0.7);
          opacity: 0.7;
          animation: twinkle 2.4s ease-in-out infinite alternate;
          pointer-events: none;
        }

        @keyframes twinkle {
          0%   { opacity: 0.3; transform: scale(1); }
          100% { opacity: 1;   transform: scale(1.5); }
        }

        .shooting-star {
          position: absolute;
          width: 120px;
          height: 2px;
          background: linear-gradient(90deg, rgba(255,150,50,0.8), transparent);
          border-radius: 999px;
          opacity: 0.9;
          transform: translateX(-200px) rotate(12deg);
          

          animation: shoot 40s ease-out infinite;
          pointer-events: none;
        }

        @keyframes shoot {
          

          0% {
            transform: translateX(-200px) translateY(0) rotate(12deg);
            opacity: 0;
          }
          

          5% {
            opacity: 1;
          }
          
          
          20% {
            transform: translateX(120vw) translateY(50vh) rotate(12deg);
            opacity: 0;
          }
          
          100% {
            opacity: 0;
            transform: translateX(-200px) translateY(0) rotate(12deg);
          }
        }

        
        .shoot1 { top: 20%; left: -10%; animation-delay: 0s; }
        .shoot2 { top: 45%; left: -15%; animation-delay: 8s; }
        .shoot3 { top: 70%; left: -20%; animation-delay: 16s; }
      `}</style>

      <div className="bg">
        <div className="shooting-star shoot1" />
        <div className="shooting-star shoot2" />
        <div className="shooting-star shoot3" />
      </div>


    </>
  );
};

export default AskVoxStarBackground;

