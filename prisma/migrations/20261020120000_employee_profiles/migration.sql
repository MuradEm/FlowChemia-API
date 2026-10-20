ALTER TABLE "Membership"
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "workEmail" TEXT,
  ADD COLUMN "workPhone" TEXT;
CREATE TABLE "EmployeePhoto" (
  "membershipId" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "image" BYTEA NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeePhoto_pkey" PRIMARY KEY ("membershipId"),
  CONSTRAINT "EmployeePhoto_membership_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "Membership"("orgId", "id") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "EmployeePhoto_orgId_membershipId_key" ON "EmployeePhoto"("orgId", "membershipId");
