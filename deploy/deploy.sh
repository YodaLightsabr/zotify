#!/usr/bin/env bash
# Deploys the latest commit on GitHub, if there's a new one. systemd runs this every minute (zotify-deploy.timer), as the app user.
#
# Each commit is built in its own folder under releases/, and "current" only switches to it once the build has worked, so a
# broken or half-finished build never touches the running site. The database, .env and .accounts.json live in shared/.
#
# Usage: deploy.sh [--force]    --force rebuilds even if nothing changed
#
# Settings come from /etc/default/zotify, written by install.sh: ZOTIFY_ROOT, ZOTIFY_BRANCH and a PATH that includes Node.

# Everything is in one function that's called on the last line, so bash has read the whole script before running it.
# The script updates itself from GitHub partway through, and bash would otherwise read the new version mid-run
main() {
    set -euo pipefail

    local root="${ZOTIFY_ROOT:?ZOTIFY_ROOT is not set, see /etc/default/zotify}"
    local branch="${ZOTIFY_BRANCH:-main}"
    local keep=3
    local force="${1:-}"

    cd "$root"

    git -C repo fetch --quiet origin "$branch"
    local target
    target="$(git -C repo rev-parse "origin/$branch")"
    local running=""
    [ -L current ] && running="$(basename "$(readlink current)")"

    local release="releases/$target"
    local building="$release.building"

    if [ "$force" != "--force" ]; then
        if [ "$target" = "$running" ]; then
            write_status "$target" live
            return 0
        fi

        # A commit that didn't build isn't tried again every minute; the next push (or --force) tries again
        if [ -e "$release.failed" ]; then
            write_status "$target" failed
            return 0
        fi
    fi

    write_status "$target" building

    echo "Deploying ${target:0:7} (running: ${running:0:7})"

    # Keep this script and the service files' source up to date. The repo checkout is only used for deploying
    git -C repo reset --quiet --hard "origin/$branch"

    rm -rf "$building" "$release.failed"
    mkdir -p "$building"
    git -C repo archive "$target" | tar -x -C "$building"

    # Which commit this is, for the admin dashboard: hash, commit time, message and repo, one per line. The deploy time is added
    # once it goes live. The frontend reads this while building, too
    git -C repo log -1 --format='%H%n%cI%n%s' "$target" > "$building/.release-info"
    git -C repo remote get-url origin >> "$building/.release-info"

    # Files that outlive releases
    ln -s ../../shared/.env "$building/.env"
    ln -s ../../shared/.accounts.json "$building/.accounts.json"
    ln -s ../../shared/backups "$building/backups"

    if ! build "$building" "$running"; then
        touch "$release.failed"
        write_status "$target" failed
        echo "The build for ${target:0:7} failed, so ${running:0:7} keeps running. It's tried again on the next push, or with --force" >&2
        return 1
    fi

    # The build worked, so switch to it. Renaming a new link over the old one swaps it in one step
    rm -rf "$release"
    mv "$building" "$release"
    date -u +%Y-%m-%dT%H:%M:%SZ >> "$release/.release-info"
    ln -sfn "$release" current.next
    mv -T current.next current

    sudo -n systemctl restart zotify-api.service zotify-web.service
    write_status "$target" live
    echo "Deployed ${target:0:7}"

    # Drop leftovers from failed builds, then keep the newest few releases for rolling back
    rm -rf releases/*.building releases/*.failed
    local old
    for old in $(ls -1dt releases/*/ | sed 's:/$::' | tail -n +$((keep + 1))); do
        [ "$old" = "$release" ] || rm -rf "$old"
    done
}

# The newest commit on GitHub and where it stands, for the admin dashboard's deploy progress bar (see src/deploys.ts): its
# hash, commit time, state (building, failed or live) and message, one per line. Swapped in whole, so it's never read half-written
write_status() {
    local target="$1" state="$2"
    git -C repo log -1 --format="%H%n%cI%n$state%n%s" "$target" > shared/deploy-status.next
    mv shared/deploy-status.next shared/deploy-status
}

# Installs packages and builds a release in its folder
build() {
    local building="$1" running="$2"

    # Reuse the running release's packages when they haven't changed; hard links make that instant and take no extra space
    if [ -n "$running" ] && [ -d "current/node_modules" ] && cmp -s current/package-lock.json "$building/package-lock.json"; then
        cp -al current/node_modules "$building/" || return 1
    else
        echo "Installing packages"
        # Building needs the dev dependencies too (TypeScript, types), which NODE_ENV=production would skip
        (cd "$building" && NODE_ENV= npm ci --no-audit --no-fund) || return 1
    fi

    echo "Building"
    (cd "$building" && NODE_ENV= npm run build) || return 1
}

main "$@"; exit $?
