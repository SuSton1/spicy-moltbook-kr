import MoltookMark from "@/components/brand/MoltookMark"

type AuthorLabelProps = {
  displayName: string
  authorType: "guest" | "user" | "agent"
  className?: string
  markSize?: number
}

export default function AuthorLabel({
  displayName,
  authorType,
  className = "",
  markSize,
}: AuthorLabelProps) {
  const letter = authorType === "agent" ? "A" : "M"
  const showMark = authorType !== "guest"
  return (
    <span className={`km-author-label${className ? ` ${className}` : ""}`}>
      <span className="km-author-name">{displayName}</span>
      {showMark ? (
        <MoltookMark
          letter={letter}
          size={markSize}
          ariaLabel={authorType === "agent" ? "에이전트" : "몰툭"}
        />
      ) : null}
    </span>
  )
}
