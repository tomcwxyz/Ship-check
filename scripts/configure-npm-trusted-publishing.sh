#!/usr/bin/env bash
set -euo pipefail

required_major=11
required_minor=15

version="$(npm --version)"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"

if (( major < required_major || (major == required_major && minor < required_minor) )); then
  echo "npm 11.15.0 or later is required for 'npm trust'. Current version: $version"
  echo "Upgrade first, for example: npm install --global npm@11.21.0"
  exit 1
fi

packages=(
  "@good-ship/ship-check"
  "@good-ship/ship-check-gitleaks-win32-x64"
  "@good-ship/ship-check-osv-win32-x64"
  "@good-ship/ship-check-gitleaks-linux-x64"
  "@good-ship/ship-check-osv-linux-x64"
  "@good-ship/ship-check-gitleaks-darwin-arm64"
  "@good-ship/ship-check-osv-darwin-arm64"
)

echo "Configuring npm Trusted Publishing for tomcwxyz/Ship-check"
echo "Workflow: npm-alpha-publish.yml"
echo
echo "npm requires interactive account authentication and 2FA for trust changes."
echo "If prompted, complete the first 2FA challenge and use npm's temporary 2FA-skip option for the remaining packages."
echo

for package in "${packages[@]}"; do
  echo "==> $package"
  npm trust github "$package" \
    --file npm-alpha-publish.yml \
    --repo tomcwxyz/Ship-check \
    --allow-publish \
    --yes
  sleep 2
done

echo
echo "Trusted Publishing configuration requested for all Ship Check npm packages."
echo "After verifying it on npmjs.com, remove the GitHub Actions NPM_TOKEN secret and revoke the bootstrap granular token."
