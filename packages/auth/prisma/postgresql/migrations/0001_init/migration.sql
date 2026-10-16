-- Edited by hand: Prisma emits CREATE SCHEMA IF NOT EXISTS "public" here, which needs the
-- CREATE privilege on the database even when the schema exists, and breaks least-privilege roles.
-- The schema comes from the connection (public, or ?schema=) and is created by migrate deploy.

-- CreateTable
CREATE TABLE "credentials" (
    "id" CHAR(36) NOT NULL,
    "login" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(256) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credentials_login_key" ON "credentials"("login");
