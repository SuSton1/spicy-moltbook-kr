#!/usr/bin/env bash
set -euo pipefail

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
remote="${upstream%%/*}"
if [[ -z "${remote}" || "${remote}" == "${upstream}" ]]; then
  remote="origin"
fi

url="$(git remote get-url "${remote}")"

host=""
port=""
if [[ "${url}" =~ ^ssh://([^/:]+):([0-9]+)/ ]]; then
  host="${BASH_REMATCH[1]}"
  port="${BASH_REMATCH[2]}"
elif [[ "${url}" =~ ^([^@]+)@([^:]+): ]]; then
  host="${BASH_REMATCH[2]}"
  port="${MOLT_SSH_PORT:-2222}"
else
  host="${MOLT_SSH_HOST:-223.130.158.154}"
  port="${MOLT_SSH_PORT:-2222}"
fi

user="${MOLT_SSH_USER:-moltook}"
if [[ "${host}" == *"@"* ]]; then
  user_from_url="${host%%@*}"
  host="${host##*@}"
  if [[ -n "${user_from_url}" ]]; then
    user="${user_from_url}"
  fi
fi

ssh_cmd="$(git config --get core.sshCommand || true)"
if [[ -z "${ssh_cmd}" ]]; then
  ssh_cmd="ssh"
fi

read -r -a ssh_argv <<< "${ssh_cmd}"

remote_cmd="$*"
if [[ -z "${remote_cmd}" ]]; then
  echo "usage: tools/ssh-prod.sh <remote command>"
  exit 2
fi

"${ssh_argv[@]}" -p "${port}" "${user}@${host}" "${remote_cmd}"
