FROM oven/bun:1-debian AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY src ./src

RUN bun build --compile --outfile=itsysync src/server.ts

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/itsysync /app/itsysync

ENV DATA_DIR=/data
EXPOSE 8080

CMD ["/app/itsysync"]
