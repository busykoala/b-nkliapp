#!/usr/bin/env bash
set -euo pipefail

# Installs the repository-scoped Benchly GitHub Actions runner. The short-lived
# registration token is read from stdin only on first configuration.
readonly RUNNER_VERSION="2.337.0"
readonly RUNNER_SHA256="70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613"
readonly RUNNER_ARCHIVE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
readonly RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
readonly RUNNER_DIR="/opt/actions-runner-benchly"
readonly RUNNER_USER="busykoala"
readonly RUNNER_NAME="blizzard-benchly"
readonly REPOSITORY_URL="https://github.com/busykoala/b-nkliapp"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_DIR"

if [[ ! -x "$RUNNER_DIR/bin/Runner.Listener" ]]; then
  archive_path="$(mktemp "/var/tmp/${RUNNER_ARCHIVE}.XXXXXX")"
  trap 'rm -f "${archive_path:-}"' EXIT
  curl --fail --location --silent --show-error "$RUNNER_URL" --output "$archive_path"
  printf '%s  %s\n' "$RUNNER_SHA256" "$archive_path" | sha256sum --check --status
  tar -xzf "$archive_path" -C "$RUNNER_DIR"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
fi

"$RUNNER_DIR/bin/installdependencies.sh"

if [[ ! -f "$RUNNER_DIR/.runner" ]]; then
  registration_token=""
  IFS= read -r registration_token
  if [[ -z "$registration_token" ]]; then
    echo "A short-lived GitHub runner registration token is required on stdin." >&2
    exit 1
  fi

  sudo -u "$RUNNER_USER" "$RUNNER_DIR/config.sh" \
    --unattended \
    --url "$REPOSITORY_URL" \
    --token "$registration_token" \
    --name "$RUNNER_NAME" \
    --labels benchly \
    --work _work \
    --replace
  unset registration_token
fi

service_file="$(find /etc/systemd/system -maxdepth 1 -type f -name 'actions.runner.busykoala-b-nkliapp.*.service' -print -quit)"
if [[ -z "$service_file" ]]; then
  (
    cd "$RUNNER_DIR"
    ./svc.sh install "$RUNNER_USER"
  )
  service_file="$(find /etc/systemd/system -maxdepth 1 -type f -name 'actions.runner.busykoala-b-nkliapp.*.service' -print -quit)"
fi

if [[ -z "$service_file" ]]; then
  echo "Runner service was not installed." >&2
  exit 1
fi

systemctl enable --now "$(basename "$service_file")"
systemctl --no-pager --full status "$(basename "$service_file")"
