#!/usr/bin/env bash
# Sets Zotify up as systemd services on a Linux server: the API and the frontend start on boot and restart if they crash,
# and a timer deploys new commits from GitHub every minute. Run once with sudo; running it again updates the setup.
#
#   sudo deploy/install.sh --import ~/zotify
#
# Options:
#   --user NAME       who the services run as (default: whoever ran sudo)
#   --dir PATH        where Zotify lives (default: /srv/zotify)
#   --import PATH     an existing checkout to copy .env, .accounts.json and the database from
#   --repo URL        the GitHub repo (default: this checkout's origin)
#   --branch NAME     the branch to deploy (default: main)
#   --node-bin PATH   the folder with node and npm (default: found from the user's shell, so nvm works)
#
# Layout:
#   repo/              a clone used to fetch and export commits
#   releases/<commit>  one built copy per deploy; the newest few are kept
#   current            the running release
#   shared/            .env, .accounts.json, zotify.db and backups/, used by every release

# Whether this folder has npm and a node that's at least 22.9
new_enough() {
    [ -x "$1/node" ] && [ -x "$1/npm" ] \
        && "$1/node" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 9) ? 0 : 1)'
}

main() {
    set -euo pipefail

    local user="${SUDO_USER:-}" dir="/srv/zotify" import="" repo="" branch="main" node_bin=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --user) user="$2"; shift 2 ;;
            --dir) dir="$2"; shift 2 ;;
            --import) import="$2"; shift 2 ;;
            --repo) repo="$2"; shift 2 ;;
            --branch) branch="$2"; shift 2 ;;
            --node-bin) node_bin="$2"; shift 2 ;;
            *) echo "Unknown option $1" >&2; exit 1 ;;
        esac
    done

    [ "$(id -u)" = 0 ] || { echo "Run this with sudo." >&2; exit 1; }
    [ -n "$user" ] && id "$user" >/dev/null 2>&1 || { echo "Pass --user with the account the services should run as." >&2; exit 1; }
    command -v systemctl >/dev/null || { echo "This needs systemd." >&2; exit 1; }

    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    [ -n "$repo" ] || repo="$(git -C "$here" remote get-url origin)"
    local home
    home="$(getent passwd "$user" | cut -d: -f6)"

    # Node 22.9 or newer, from the user's own shell so nvm installs are found. Login shells and interactive ones load different files,
    # and a server can have an old system Node alongside a newer one from nvm, so try each until one is new enough
    if [ -z "$node_bin" ]; then
        local found candidate
        for flags in -lc -ic; do
            found="$(runuser -u "$user" -- env HOME="$home" bash "$flags" 'command -v node' 2>/dev/null | tail -n 1 || true)"
            [ -n "$found" ] || continue
            candidate="$(dirname "$found")"
            if new_enough "$candidate"; then node_bin="$candidate"; break; fi
            echo "Skipping $found ($("$found" --version)), which is older than Node 22.9"
        done
    fi

    [ -n "$node_bin" ] && new_enough "$node_bin" \
        || { echo "Couldn't find Node 22.9 or newer with npm. Pass --node-bin with the folder that has them." >&2; exit 1; }

    echo "Installing Zotify in $dir as $user, with Node $("$node_bin/node" --version) from $node_bin"

    # An earlier setup of these services has to stop before its database can be copied
    systemctl stop zotify-api.service zotify-web.service 2>/dev/null || true

    local port
    for port in 3000 3001; do
        if ss -ltnH "( sport = :$port )" | grep -q .; then
            echo "Something is already using port $port. Stop the old Zotify (or whatever it is) and run this again:" >&2
            ss -ltnp "( sport = :$port )" >&2
            exit 1
        fi
    done

    install -d -o "$user" -g "$(id -gn "$user")" "$dir" "$dir/releases" "$dir/shared" "$dir/shared/backups"
    local as_user=(runuser -u "$user" -- env HOME="$home" PATH="$node_bin:$PATH")

    if [ ! -d "$dir/repo/.git" ]; then
        "${as_user[@]}" git clone --quiet --branch "$branch" "$repo" "$dir/repo"
    fi

    # Data from an existing checkout, unless it's already been brought over. The database's -wal and -shm files go with it
    if [ -n "$import" ]; then
        local name
        for name in .env .accounts.json; do
            if [ -f "$import/$name" ] && [ ! -e "$dir/shared/$name" ]; then
                install -m 600 -o "$user" "$import/$name" "$dir/shared/$name"
                echo "Copied $name"
            fi
        done

        if [ -f "$import/.zotify.db" ] && [ ! -e "$dir/shared/zotify.db" ]; then
            local suffix
            for suffix in "" -wal -shm; do
                if [ -f "$import/.zotify.db$suffix" ]; then
                    install -m 600 -o "$user" "$import/.zotify.db$suffix" "$dir/shared/zotify.db$suffix"
                fi
            done
            echo "Copied the database"
        fi
    fi

    [ -e "$dir/shared/.env" ] || install -m 600 -o "$user" /dev/null "$dir/shared/.env"
    [ -e "$dir/shared/.accounts.json" ] || echo "Warning: $dir/shared/.accounts.json is missing. The API needs it to reach Rockbot." >&2

    # Settings for the services and the deploy script
    cat > /etc/default/zotify <<CONFIG
# Read by the zotify-* systemd services; written by deploy/install.sh
ZOTIFY_ROOT=$dir
ZOTIFY_BRANCH=$branch
ZOTIFY_DB=$dir/shared/zotify.db
PATH=$node_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CONFIG

    # The deploy timer runs as $user, which may restart the two services and nothing else
    local systemctl
    systemctl="$(command -v systemctl)"
    echo "$user ALL=(root) NOPASSWD: $systemctl restart zotify-api.service zotify-web.service" > /etc/sudoers.d/zotify
    chmod 440 /etc/sudoers.d/zotify
    visudo -cqf /etc/sudoers.d/zotify || { rm -f /etc/sudoers.d/zotify; echo "The sudoers rule didn't check out." >&2; exit 1; }

    local service
    # name|command|description. Split on | since the frontend's command has a colon in it
    for service in "api|npm start|API (port 3001)" "web|npm run start:web|frontend (port 3000)"; do
        local name="${service%%|*}" rest="${service#*|}"
        local command="${rest%%|*}" description="${rest#*|}"

        cat > "/etc/systemd/system/zotify-$name.service" <<UNIT
[Unit]
Description=Zotify $description
After=network-online.target
Wants=network-online.target

[Service]
User=$user
EnvironmentFile=/etc/default/zotify
# A link to the running release, followed each time the service starts
WorkingDirectory=$dir/current
ExecStart=$node_bin/$command
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    done

    cat > /etc/systemd/system/zotify-deploy.service <<UNIT
[Unit]
Description=Deploy Zotify's latest commit from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$user
EnvironmentFile=/etc/default/zotify
ExecStart=/bin/bash $dir/repo/deploy/deploy.sh
TimeoutStartSec=20min
UNIT

    cat > /etc/systemd/system/zotify-deploy.timer <<UNIT
[Unit]
Description=Check GitHub for new Zotify commits every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
UNIT

    systemctl daemon-reload
    systemctl enable --quiet zotify-api.service zotify-web.service zotify-deploy.timer

    # The first deploy builds the current commit and starts both services
    echo "Building the first release. This takes a few minutes; follow along with: journalctl -fu zotify-deploy"
    if [ -L "$dir/current" ]; then
        systemctl restart zotify-api.service zotify-web.service
    else
        systemctl start zotify-deploy.service
    fi
    systemctl start zotify-deploy.timer

    echo
    systemctl --no-pager --lines=0 status zotify-api.service zotify-web.service zotify-deploy.timer || true
    echo
    echo "Done. Zotify starts on boot, and deploys new commits on $branch within a minute of a push."
}

main "$@"; exit $?
