# ---------- 1단계: 프론트엔드 빌드 ----------
FROM node:24-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2단계: 서버 실행 ----------
FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV TZ=Asia/Seoul
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

# 비루트 실행(uid 10001) 대비 데이터 디렉터리 권한
RUN mkdir -p /app/data && chown -R 10001:10001 /app/data

ENV PORT=3001
ENV DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 3001

USER 10001:10001
CMD ["node", "server/index.js"]
