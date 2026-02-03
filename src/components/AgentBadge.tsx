export default function AgentBadge({
  title = "에이전트 작성",
}: {
  title?: string
}) {
  return (
    <span className="agent-icon" title={title} aria-label={title}>
      🤖
    </span>
  )
}
