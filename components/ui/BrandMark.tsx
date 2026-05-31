type BrandMarkSize = "sm" | "md" | "lg";

type BrandMarkProps = {
  size?: BrandMarkSize;
  className?: string;
};

const sizeClasses: Record<BrandMarkSize, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-11 w-11",
};

export default function BrandMark({ size = "md", className = "" }: BrandMarkProps) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-[0.9rem] ${sizeClasses[size]} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        className="h-full w-full overflow-visible drop-shadow-[0_8px_16px_rgba(5,8,20,0.22)]"
      >
        <rect
          x="15"
          y="8"
          width="34"
          height="48"
          rx="8"
          fill="url(#brand-card-fill)"
          stroke="rgba(15,23,42,0.32)"
          strokeWidth="1.6"
        />
        <rect
          x="17"
          y="10"
          width="30"
          height="44"
          rx="6.5"
          fill="url(#brand-card-shine)"
        />
        <path
          d="M32 21.8C33.3 27.4 36.6 30.7 42.2 32C36.6 33.3 33.3 36.6 32 42.2C30.7 36.6 27.4 33.3 21.8 32C27.4 30.7 30.7 27.4 32 21.8Z"
          fill="url(#brand-star-fill)"
          stroke="#f6b938"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <path
          d="M32 27.5C32.6 30 34 31.4 36.5 32C34 32.6 32.6 34 32 36.5C31.4 34 30 32.6 27.5 32C30 31.4 31.4 30 32 27.5Z"
          fill="#fff9c7"
        />
        <defs>
          <linearGradient id="brand-card-fill" x1="18" y1="8" x2="49" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#f2edf8" />
          </linearGradient>
          <linearGradient id="brand-card-shine" x1="23" y1="11" x2="42" y2="53" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" stopOpacity="0.78" />
            <stop offset="0.55" stopColor="#fff8ee" stopOpacity="0.42" />
            <stop offset="1" stopColor="#efe8f3" stopOpacity="0.22" />
          </linearGradient>
          <radialGradient id="brand-star-fill" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 32) rotate(90) scale(13)">
            <stop stopColor="#fffdf2" />
            <stop offset="0.32" stopColor="#ffe987" />
            <stop offset="1" stopColor="#f2a82b" />
          </radialGradient>
        </defs>
      </svg>
    </span>
  );
}
