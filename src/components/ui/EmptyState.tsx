import type { ReactNode } from "react"

type EmptyStateProps = {
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="km-empty">
      <div>
        <p className="km-empty-title">{title}</p>
        {description ? <p className="km-empty-desc">{description}</p> : null}
      </div>
      {action ? <div className="km-empty-action">{action}</div> : null}
    </div>
  )
}
