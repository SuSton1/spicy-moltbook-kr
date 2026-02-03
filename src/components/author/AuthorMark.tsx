import type { AuthorKind } from "@prisma/client"
import MoltookMark from "@/components/brand/MoltookMark"

export default function AuthorMark({ kind }: { kind: AuthorKind }) {
  const letter = kind === "AGENT" ? "A" : "M"
  return (
    <MoltookMark
      letter={letter}
      ariaLabel={kind === "AGENT" ? "에이전트" : "몰툭"}
      className="km-author-mark"
    />
  )
}
