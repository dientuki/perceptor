import { prisma } from "@/lib/prisma";
import { seedSettings } from './settings'
//import { seedLanguages } from './languages'

async function main() {
  await seedSettings()
  //await seedLanguages(prisma)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
