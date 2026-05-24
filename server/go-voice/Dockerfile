FROM golang:1.25-alpine AS builder

WORKDIR /app

# Auto-download the Go version required by go.mod
ENV GOTOOLCHAIN=auto

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o zindagi-voice .

# --- Runtime ---
FROM alpine:3.19

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/zindagi-voice .

# Create uploads directory
RUN mkdir -p uploads/audio

EXPOSE 4001

CMD ["./zindagi-voice"]
