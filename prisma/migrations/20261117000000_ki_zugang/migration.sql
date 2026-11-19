-- CreateEnum
CREATE TYPE "AiAccess" AS ENUM ('NONE', 'READ', 'WRITE');

-- CreateEnum
CREATE TYPE "ApiTokenLevel" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "ApiTokenKind" AS ENUM ('PERSONAL', 'OAUTH');

-- CreateEnum
CREATE TYPE "AuditChannel" AS ENUM ('MCP');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "apiTokenId" TEXT,
ADD COLUMN     "channel" "AuditChannel";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiAccess" "AiAccess" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "level" "ApiTokenLevel" NOT NULL,
    "kind" "ApiTokenKind" NOT NULL DEFAULT 'PERSONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_prefix_key" ON "ApiToken"("prefix");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_apiTokenId_idx" ON "AuditLog"("apiTokenId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

