# DSS 개선요청 — 운영 이미지
#
# 개발 PC에서 굽고 NAS로 옮긴다. 절차는 ../dss-deploy/runbook/02-이미지-빌드.md
#
#   docker build -t dss-improvements:0.1 .
#   docker save dss-improvements:0.1 -o dss-improvements-0.1.tar
#   (NAS에서) docker load -i dss-improvements-0.1.tar
#
# 🔴 굽는 것도 올리는 것도 사람이 한다. 이 파일은 그때 쓸 절차를 적어 둔 것이지,
#    지금 돌리라는 뜻이 아니다.
#
# ⚠️ 이 이미지를 NAS 에 띄우려면 dss-deploy/nas/docker-compose.nas.yml 에
#    서비스가 하나 늘어야 하고, DSM 리버스 프록시에 주소가 하나 늘어야 한다.
#    그 파일은 이 저장소의 것이 아니다 — dss-deploy 에서 따로 한다.

ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1단계 : 라이브러리만 설치한다 ─────────────────────────────────────
#
# package 파일만 먼저 복사한다. 소스를 먼저 복사하면 화면 한 줄만 고쳐도
# 라이브러리를 처음부터 다시 깐다 — 이 순서 하나가 빌드 시간을 몇 배 가른다.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2단계 : 앱을 굽는다 ───────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 빌드에만 쓰는 가짜 DATABASE_URL.
#
# `next build` 는 각 화면의 데이터를 모으려고 서버 모듈을 실제로 불러온다.
# src/lib/env.ts 의 required() 가 값이 없으면 던지는데, 이미지에는
# .dockerignore 가 .env* 를 막아 두어(그게 맞다) 값이 없다.
#
# 접속은 하지 않는다 — postgres.js 는 실제로 쓸 때 연결한다. 값이 "있기만"
# 하면 되므로 누가 봐도 가짜인 값을 쓴다. 이 값은 이 단계에만 있고 최종
# 이미지에는 남지 않는다(3단계는 별도 FROM 이다). 운영에서는 컨테이너
# 환경변수로 진짜 값이 들어온다.
ENV DATABASE_URL="postgres://build:build@127.0.0.1:5432/build_time_only"

RUN npm run build

# ── 곁가지 : 마이그레이션을 돌리는 도구 이미지 ────────────────────────
#
# 운영 이미지(3단계)에는 drizzle-kit 이 없다 — devDependency 라서다. 그래서
# 그 안에서는 db:migrate 를 부를 수 없다. 이 스테이지가 그 자리를 맡는다.
#
#   docker build --target tools -t dss-improvements-tools:1 .
#
# NAS 에서는 compose 의 `profiles: [tools]` 서비스로 두고, 부를 때만 잠깐
# 떴다 사라진다(`run --rm`). 상시 서비스가 아니라 메모리 예산 밖이다.
#
# ⚠️ 이 스테이지를 runner 뒤로 옮기지 않는다. **마지막 스테이지가 `docker build`
#    의 기본 대상**이라, 뒤에 두면 `--target` 없이 구운 이미지가 앱이 아니라
#    도구가 된다 — 그 이미지는 `node server.js` 를 모른다.
FROM ${NODE_IMAGE} AS tools
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Seoul

# ⚠️ 소유자는 COPY 할 때 정한다. 다 옮겨 놓고 `RUN chown -R /app` 을 하면 그
#    한 줄이 /app 전체를 새 레이어에 한 벌 더 복사한다 — 계측기 도구 이미지에서
#    실측 1.86GB → 1.07GB.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json drizzle.config.ts ./
COPY --chown=node:node src ./src
COPY --chown=node:node drizzle ./drizzle

USER node

# 기본값은 아무것도 바꾸지 않는 쪽으로 둔다. 적용은 명령을 적어 부른다:
#   docker compose … run --rm tools-improvements npm run db:migrate
CMD ["node", "-e", "console.log('db:migrate 를 명령으로 적어 부르세요.')"]

# ── 3단계 : 실행에 필요한 것만 담는다 ─────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Seoul

# standalone 은 public 과 .next/static 을 자동으로 담지 않는다(Next 문서 output.md).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p .next/cache && chown -R node:node /app

USER node

# HOSTNAME 을 0.0.0.0 으로 두지 않으면 컨테이너 안 루프백에만 붙어, 포트를
# 열어도 밖에서 닿지 않는다.
ENV PORT=3500 HOSTNAME=0.0.0.0
EXPOSE 3500

CMD ["node", "server.js"]
