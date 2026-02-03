"use client"

import { useEffect } from "react"
import { addRecentBoard } from "./storage"

type Props = {
  slug: string
  titleKo: string
}

export default function RecentBoardTracker({ slug, titleKo }: Props) {
  useEffect(() => {
    addRecentBoard({ slug, titleKo })
  }, [slug, titleKo])

  return null
}
