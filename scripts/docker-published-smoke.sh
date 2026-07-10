#!/usr/bin/env bash
set -euo pipefail

IMAGE="${FIRSTRUNG_DOCKER_IMAGE:-node:22-bookworm}"
NPM_CACHE_DIR="${FIRSTRUNG_DOCKER_NPM_CACHE:-/private/tmp/firstrung-docker-npm-cache}"
PACKAGE_SPEC="${FIRSTRUNG_DOCKER_PACKAGE_SPEC:-firstrung@latest}"
COACH_PACKAGE_SPEC="${FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC:-}"

mkdir -p "$NPM_CACHE_DIR"

docker run --rm \
  -e FIRSTRUNG_DOCKER_PACKAGE_SPEC="$PACKAGE_SPEC" \
  -e FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC="$COACH_PACKAGE_SPEC" \
  -e npm_config_cache=/npm-cache \
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

log "Install container prerequisites"
install_git

node --version
npm --version
git --version

log "Create a synthetic Git project"
fixture=/tmp/firstrung-published-fixture
git init -b main "$fixture" >/dev/null
git -C "$fixture" config user.email "test@example.invalid"
git -C "$fixture" config user.name "FirstRung Published Docker Smoke"

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

log "Smoke: published npm package install path"
npx --yes "$FIRSTRUNG_DOCKER_PACKAGE_SPEC" scan "$fixture" --since "$baseline" > /tmp/firstrung-published.out
grep -q "^FirstRung " /tmp/firstrung-published.out
grep -q "changed path" /tmp/firstrung-published.out
grep -Fq "Local path metadata only; nothing uploaded." /tmp/firstrung-published.out
test "$(grep -cve "^[[:space:]]*$" /tmp/firstrung-published.out)" -eq 4
test "$(wc -w < /tmp/firstrung-published.out)" -le 65
test ! -e "$fixture/.firstrung"

if [ -n "$FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC" ]; then
  log "Smoke: published FirstRung Coach install path"
  npx --yes --package "$FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC" firstrung-coach coach "$fixture" --since "$baseline" --dry-run-context > /tmp/firstrung-published-coach-context.json
  grep -q "\"rawDataDisclosure\": \"none\"" /tmp/firstrung-published-coach-context.json
  grep -q "\"rawContentIncluded\": false" /tmp/firstrung-published-coach-context.json
  test ! -e "$fixture/.firstrung"

  mkdir -p /tmp/firstrung-empty-home
  expect_failure "published coach without credentials" env HOME=/tmp/firstrung-empty-home npx --yes --package "$FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC" firstrung-coach coach "$fixture" --since "$baseline" --confirm-provider >/tmp/firstrung-published-coach-live.out 2>/tmp/firstrung-published-coach-live.err
  grep -q "No Pi/model credential is available for firstrung-coach" /tmp/firstrung-published-coach-live.err
else
  log "Skip published FirstRung Coach smoke; set FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC after @firstrung/pi-coach is published"
fi

log "Published Docker smoke passed"
'
