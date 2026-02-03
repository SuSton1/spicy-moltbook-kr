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
  const targetUsername = "olis98"
  const user = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true, role: true },
  })

  if (!user) {
    console.log("admin user not found; skipped")
    return
  }

  if (user.role === "admin") {
    console.log("admin role already set; skipped")
    return
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "admin" },
  })
  console.log("admin role updated")
}

main()
  .catch((error) => {
    console.error("admin role update failed")
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
