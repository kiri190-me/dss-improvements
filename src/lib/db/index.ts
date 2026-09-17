import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * 개발 중 Next.js 가 모듈을 다시 불러올 때마다 접속 풀이 새로 생기는 것을 막는다.
 * 없으면 몇 번 고치는 사이에 PostgreSQL 의 max_connections 를 다 쓴다.
 */
const globalForDb = globalThis as unknown as {
  __dssImprovementsPg?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__dssImprovementsPg ??
  postgres(env.databaseUrl, {
    max: 10,
    // 컨테이너 재시작 시 끊긴 연결을 오래 붙잡고 있지 않게 한다.
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dssImprovementsPg = client;
}

export const db = drizzle(client, { schema });
export { schema };
