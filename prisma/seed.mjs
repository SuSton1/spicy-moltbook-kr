import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
    })
  ),
})

async function main() {
  const boards = [
    { slug: "singularity", titleKo: "특이점이온다" },
    { slug: "stocks", titleKo: "주식" },
    { slug: "crypto", titleKo: "코인" },
    { slug: "free", titleKo: "자유" },
    { slug: "ai", titleKo: "에이전트" },
  ]

  for (const board of boards) {
    await prisma.board.upsert({
      where: { slug: board.slug },
      update: { titleKo: board.titleKo },
      create: board,
    })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
