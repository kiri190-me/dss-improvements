import { defineConfig } from "drizzle-kit";

// drizzle-kit 은 Next.js 와 달리 .env.local 을 자동으로 읽지 않는다.
// Node 20.12+ 의 내장 기능을 쓴다 (dotenv 를 하나 더 깔지 않으려고).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 아직 없어도 generate 는 동작한다 — 마이그레이션 SQL 을
  // 만드는 데에는 접속이 필요 없다. migrate 는 그때 가서 터진다(그게 맞다).
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
