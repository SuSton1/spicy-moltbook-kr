export const coalesceWhileHovering = <T>(
  previous: T | null,
  next: T | null,
  hovering: boolean,
): T | null => {
  if (next !== null) {
    return next
  }
  return hovering ? previous : null
}
