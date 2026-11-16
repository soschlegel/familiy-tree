# syntax=docker/dockerfile:1
#
# MinIO-Server und -Client (mc), aus dem Quelltext gebaut.
#
# Warum selbst bauen: MinIO veröffentlicht seit Herbst 2025 keine freien
# Images und Binärdateien mehr (minio/minio und minio/mc auf Docker Hub und
# quay.io sind nicht mehr abrufbar, dl.min.io liefert "410 Gone"). Die
# GitHub-Repositories sind archiviert; der letzte Community-Stand ist
# RELEASE.2025-10-15T17-29-55Z (Server) bzw. RELEASE.2025-08-13T08-35-41Z (mc).
#
# Gebaut wird genau dieser Stand; der Commit wird gegen den Tag geprüft, damit
# ein nachträglich verschobener Tag auffällt. Das fertige Image legt der
# GitHub-Workflow unter ghcr.io/<owner>/<repo>-minio:<MINIO_RELEASE> ab.
#
# Neue Versionen gibt es upstream nicht mehr — der Speicher ist im Stack
# ohnehin nur intern erreichbar (kein veröffentlichter Port).

ARG GO_VERSION=1.24
ARG ALPINE_VERSION=3.22

FROM golang:${GO_VERSION}-alpine AS build
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-trimpath
RUN apk add --no-cache git
WORKDIR /src

RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git minio \
 && test "$(git -C minio rev-parse HEAD)" = "${MINIO_COMMIT}" \
 && git clone --depth 1 --branch "${MC_RELEASE}" https://github.com/minio/mc.git mc \
 && test "$(git -C mc rev-parse HEAD)" = "${MC_COMMIT}"

# Wie das Makefile von MinIO (`make build`), nur ohne Prüfschritte.
RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd minio \
 && go build -tags kqueue -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio . \
 && cd ../mc \
 && go build -tags kqueue -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/mc . \
 && /out/minio --version && /out/mc --version

FROM alpine:${ALPINE_VERSION}
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
LABEL org.opencontainers.image.title="MinIO (Community, aus dem Quelltext gebaut)" \
      org.opencontainers.image.version="${MINIO_RELEASE}" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      io.min.mc.version="${MC_RELEASE}"
# ca-certificates für mc gegen HTTPS-Ziele; busybox-wget dient dem Healthcheck.
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/minio /out/mc /usr/bin/
ENV MC_CONFIG_DIR=/tmp/.mc
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data"]
