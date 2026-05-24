FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Copy generated Prisma client to dist (tsc doesn't copy .js files)
RUN cp -r src/generated dist/generated

EXPOSE 4000

CMD ["npm", "start"]
