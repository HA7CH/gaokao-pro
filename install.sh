#!/usr/bin/env bash
# gaokao-pro installer — clone + build + symlink. Works without npm publish.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/HA7CH/gaokao-pro/main/install.sh | bash
#
# Override the install dir with GAOKAO_PRO_DIR=~/somewhere/else.

set -euo pipefail

REPO="https://github.com/HA7CH/gaokao-pro.git"
DIR="${GAOKAO_PRO_DIR:-$HOME/.gaokao-pro}"

cyan()  { printf "\033[36m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1" >&2; }

# Surface a helpful message instead of a bare "exited with code N" on failure.
STEP="starting up"
on_error() {
  local code=$?
  red "install failed during: $STEP (exit $code)"
  red "see the output above for details, then re-run this script."
  exit "$code"
}
trap on_error ERR

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "missing dependency: $1"
    red "install it first, then re-run this script."
    exit 1
  fi
}

require git
require node

# Pick a package manager — pnpm preferred, npm fallback.
if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  red "need pnpm or npm in PATH"
  exit 1
fi

cyan "==> Installing gaokao-pro to $DIR (via $PM)"

if [ -d "$DIR/.git" ]; then
  cyan "==> Updating existing checkout"
  STEP="updating checkout (git pull --ff-only in $DIR)"
  git -C "$DIR" pull --ff-only
else
  cyan "==> Cloning $REPO"
  STEP="cloning $REPO into $DIR"
  git clone --depth 1 --single-branch "$REPO" "$DIR"
fi

cyan "==> Installing deps"
STEP="installing dependencies (via $PM)"
if [ "$PM" = "pnpm" ]; then
  (cd "$DIR" && pnpm install --filter ./cli --frozen-lockfile || pnpm install --filter ./cli)
else
  (cd "$DIR/cli" && npm install --no-audit --no-fund)
fi

cyan "==> Building"
STEP="building the CLI (tsc)"
(cd "$DIR/cli" && ./node_modules/.bin/tsc -p tsconfig.json)

BIN_SRC="$DIR/cli/dist/index.js"
chmod +x "$BIN_SRC"

# Pick install location: prefer /usr/local/bin if writable, else ~/.local/bin.
if [ -w "/usr/local/bin" ]; then
  BIN_DEST="/usr/local/bin/gaokao-pro"
else
  mkdir -p "$HOME/.local/bin"
  BIN_DEST="$HOME/.local/bin/gaokao-pro"
fi

ln -sf "$BIN_SRC" "$BIN_DEST"

green "==> Installed: $BIN_DEST"
echo
if [[ "$BIN_DEST" == "$HOME/.local/bin/"* ]]; then
  if ! echo ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
    cyan "Add $HOME/.local/bin to PATH:"
    echo '  export PATH="$HOME/.local/bin:$PATH"'
    echo
  fi
fi

green "Try it:"
echo '  gaokao-pro recommend --score 660 --province henan --subjects 物理,化学,生物 --985 --limit 5'
echo '  gaokao-pro help'
