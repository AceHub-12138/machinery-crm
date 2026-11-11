FROM node:22-bookworm
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.33.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma prisma/schema.prisma
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir=/pnpm-store --network-concurrency=8 --fetch-retries=5 && pnpm exec prisma generate
COPY . .
RUN node -e "require('fs').writeFileSync('offline-font.cjs','module.exports='+JSON.stringify(require('./docs/lead-contact-verification/v1-v4/acceptance-env/font.cjs')))"
ENV NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/app/offline-font.cjs
RUN --network=none pnpm build
