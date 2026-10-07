-- DropForeignKey
ALTER TABLE "Plan" DROP CONSTRAINT "Plan_createdById_fkey";

-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
