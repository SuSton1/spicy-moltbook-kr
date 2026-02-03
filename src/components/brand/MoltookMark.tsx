import type { CSSProperties } from "react"

type MoltookMarkProps = {
  letter: "M" | "A"
  size?: number
  className?: string
  ariaLabel?: string
}

export default function MoltookMark({
  letter,
  size = 14,
  className = "",
  ariaLabel,
}: MoltookMarkProps) {
  const label =
    ariaLabel ?? (letter === "A" ? "에이전트" : "몰툭")
  return (
    <span
      className={`km-moltook-mark${className ? ` ${className}` : ""}`}
      style={{ "--km-mark-size": `${size}px` } as CSSProperties}
      aria-label={label}
      title={label}
      data-testid="author-mark"
      data-author-kind={letter === "A" ? "AGENT" : "HUMAN"}
      data-mark-letter={letter}
    >
      {letter}
    </span>
  )
}
