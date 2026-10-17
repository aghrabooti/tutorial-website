#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
CREATE_INITIAL_ADMIN=${CREATE_INITIAL_ADMIN:-0}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, for example: sudo env CREATE_INITIAL_ADMIN=1 bash deploy/self-hosted/bootstrap-ubuntu.sh" >&2
  exit 2
fi
if [ ! -f /etc/os-release ]; then
  echo "Cannot identify the operating system; this bootstrap supports Ubuntu 24.04 only." >&2
  exit 2
fi
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  echo "This bootstrap supports Ubuntu 24.04 only; detected ${PRETTY_NAME:-unknown}." >&2
  exit 2
fi
if [ "$(dpkg --print-architecture)" != amd64 ]; then
  echo "This bootstrap currently supports x86_64/amd64 VPS only." >&2
  exit 2
fi
case "$CREATE_INITIAL_ADMIN" in
  0|1) ;;
  *) echo "CREATE_INITIAL_ADMIN must be 0 or 1." >&2; exit 2 ;;
esac

export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl openssl

  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location --retry 3 \
    https://download.docker.com/linux/ubuntu/gpg \
    --output /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  architecture=$(dpkg --print-architecture)
  codename=${UBUNTU_CODENAME:-$VERSION_CODENAME}
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$architecture" "$codename" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! command -v openssl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y openssl
fi

systemctl enable --now docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin installation did not succeed." >&2
  exit 1
fi

# Uploaded ZIPs do not always preserve executable bits.
chmod 755 "$ROOT_DIR/deploy/self-hosted/create-env.sh" "$ROOT_DIR/deploy/self-hosted/start.sh"

exec env \
  CREATE_INITIAL_ADMIN="$CREATE_INITIAL_ADMIN" \
  "$ROOT_DIR/deploy/self-hosted/start.sh"
