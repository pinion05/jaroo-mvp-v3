# jaroo-paper-trade — 단독 스테이지: 소스만 복사해 실행 (Bun은 TS 직접 구동, 빌드 단계 없음)
FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY migrations ./migrations

# 데이터 볼륨 (SQLite) — cache ZERO / DB fetch only 의 유일한 상태 저장소
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun

ENV NODE_ENV=production \
    PORT=3041 \
    DB_PATH=/data/paper-trade.db

VOLUME /data
EXPOSE 3041

CMD ["bun", "src/index.ts"]
