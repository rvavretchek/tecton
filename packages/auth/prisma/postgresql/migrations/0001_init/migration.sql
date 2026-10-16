-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
