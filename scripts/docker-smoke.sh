#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${FIRSTRUNG_DOCKER_IMAGE:-node:22-bookworm}"
NPM_CACHE_DIR="${FIRSTRUNG_DOCKER_NPM_CACHE:-/private/tmp/firstrung-docker-npm-cache}"

mkdir -p "$NPM_CACHE_DIR"

docker run --rm \
  -e npm_config_cache=/npm-cache \
  -v "$ROOT_DIR:/workspace:ro" \
  -v "$NPM_CACHE_DIR:/npm-cache" \
  "$IMAGE" \
  sh -lc '
set -eu

log() {
  printf "\n==> %s\n" "$1"
}

expect_failure() {
  description="$1"
  shift

  set +e
  "$@"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    printf "Expected failure but command succeeded: %s\n" "$description" >&2
    return 1
  fi
}

install_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends git ca-certificates
    rm -rf /var/lib/apt/lists/*
    return
  fi

  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache git ca-certificates
    return
  fi

  printf "Git is not installed, and this image has no supported package manager for installing it.\n" >&2
  exit 1
}

log "Copy source into an isolated container workspace"
mkdir -p /tmp/firstrung-core
tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.firstrung \
  --exclude=dist \
  --exclude="packages/*/dist" \
  --exclude="*.tgz" \
  -C /workspace \
  -cf - . | tar -C /tmp/firstrung-core -xf -
cd /tmp/firstrung-core

log "Install container prerequisites"
install_git

node --version
npm --version
git --version

log "Install dependencies and run workspace checks"
npm ci
npm run check

log "Smoke: install check is silent when prerequisites are ready"
node packages/cli/scripts/postinstall-check.cjs >/tmp/firstrung-install-check.out 2>/tmp/firstrung-install-check.err
test ! -s /tmp/firstrung-install-check.out
test ! -s /tmp/firstrung-install-check.err

log "Create a synthetic Git project"
fixture=/tmp/firstrung-fixture
git init -b main "$fixture" >/dev/null
git -C "$fixture" config user.email "test@example.invalid"
git -C "$fixture" config user.name "FirstRung Docker Smoke"

cat > "$fixture/package.json" <<EOF
{"scripts":{"test":"node --test"}}
EOF
mkdir -p "$fixture/src/auth"
cat > "$fixture/src/auth/session.ts" <<EOF
export const existing = true;
EOF
git -C "$fixture" add .
git -C "$fixture" commit -m "initial project" >/dev/null
baseline="$(git -C "$fixture" rev-parse HEAD)"

cat > "$fixture/src/auth/session.test.ts" <<EOF
test("auth boundary", () => {});
EOF
git -C "$fixture" add .
git -C "$fixture" commit -m "add auth test" >/dev/null

log "Smoke: doctor validates prerequisites and repo path"
node packages/cli/dist/index.js doctor "$fixture" > /tmp/firstrung-doctor.out
grep -q "FirstRung doctor" /tmp/firstrung-doctor.out
grep -q "Repository: Git repository ready" /tmp/firstrung-doctor.out

log "Smoke: happy path writes no files by default"
node packages/cli/dist/index.js scan "$fixture" --since "$baseline" > /tmp/firstrung-summary.out
grep -q "^FirstRung " /tmp/firstrung-summary.out
grep -q "changed path" /tmp/firstrung-summary.out
grep -Fq "Local path metadata only; nothing uploaded." /tmp/firstrung-summary.out
test "$(grep -cve "^[[:space:]]*$" /tmp/firstrung-summary.out)" -eq 4
test "$(wc -w < /tmp/firstrung-summary.out)" -le 65
test ! -e "$fixture/.firstrung"

log "Smoke: optional artifacts are explicit and parseable"
out_dir=/tmp/firstrung-output
node packages/cli/dist/index.js scan "$fixture" --since "$baseline" --out "$out_dir" --format all --debug-artifacts > /tmp/firstrung-files.out
grep -q "scan.json" /tmp/firstrung-files.out
test -s "$out_dir/scan.json"
test -s "$out_dir/report.md"
node -e "JSON.parse(require(\"node:fs\").readFileSync(process.argv[1], \"utf8\"));" "$out_dir/scan.json"

log "Smoke: optional coach dry-run prints redacted context without writing files"
node packages/pi-coach/dist/bin/firstrung-coach.js coach "$fixture" --since "$baseline" --dry-run-context > /tmp/firstrung-coach-context.json
grep -q "\"rawDataDisclosure\": \"none\"" /tmp/firstrung-coach-context.json
grep -q "\"rawContentIncluded\": false" /tmp/firstrung-coach-context.json
test ! -e "$fixture/.firstrung"

log "Smoke: optional coach live mode loads Pi and gives credential guidance"
mkdir -p /tmp/firstrung-empty-home
expect_failure "coach without credentials" env HOME=/tmp/firstrung-empty-home node packages/pi-coach/dist/bin/firstrung-coach.js coach "$fixture" --since "$baseline" --confirm-provider >/tmp/firstrung-coach-live.out 2>/tmp/firstrung-coach-live.err
grep -q "No Pi/model credential is available for firstrung-coach" /tmp/firstrung-coach-live.err

log "Smoke: missing repo path gives usage guidance"
expect_failure "missing repo path" node packages/cli/dist/index.js scan >/tmp/firstrung-missing.out 2>/tmp/firstrung-missing.err
grep -q "Usage: firstrung scan <repo>" /tmp/firstrung-missing.err

log "Smoke: non-Git paths get repository guidance"
mkdir -p /tmp/firstrung-not-git
expect_failure "non-Git path" node packages/cli/dist/index.js scan /tmp/firstrung-not-git >/tmp/firstrung-non-git.out 2>/tmp/firstrung-non-git.err
grep -q "require a Git repository" /tmp/firstrung-non-git.err

log "Smoke: non-summary formats explain --out requirement"
expect_failure "format without out" node packages/cli/dist/index.js scan "$fixture" --format markdown >/tmp/firstrung-format.out 2>/tmp/firstrung-format.err
grep -q "require --out" /tmp/firstrung-format.err

log "Smoke: missing Git executable gets dependency guidance"
node_dir="$(dirname "$(command -v node)")"
git_dir="$(dirname "$(command -v git)")"
if [ "$node_dir" = "$git_dir" ]; then
  printf "Skipping missing-Git PATH check because node and git share %s\n" "$node_dir"
else
  expect_failure "missing git" env PATH="$node_dir" node packages/cli/dist/index.js scan "$fixture" >/tmp/firstrung-no-git.out 2>/tmp/firstrung-no-git.err
  grep -q "Git to be installed and available on PATH" /tmp/firstrung-no-git.err

  env PATH="$node_dir" node packages/cli/dist/index.js doctor --install-check >/tmp/firstrung-doctor-no-git.out 2>/tmp/firstrung-doctor-no-git.err
  grep -q "Git was not found on PATH" /tmp/firstrung-doctor-no-git.err
fi

log "Docker smoke passed"
'
