# Chemtech ERP — application image (Next.js production build + Prisma).
# The full (non-slim) image already includes OpenSSL, which the Prisma engine needs.
FROM node:22-bookworm

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
RUN sed -i "s/\r$//" docker/entrypoint.sh && chmod +x docker/entrypoint.sh
CMD ["sh", "docker/entrypoint.sh"]
