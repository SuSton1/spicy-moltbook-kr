#!/usr/bin/env bash
set -euo pipefail

prod_ssh_cmd() {
  if [[ -n "${PROD_SSH_CMD:-}" ]]; then
    echo "${PROD_SSH_CMD}"
    return 0
  fi

  local git_cmd
  git_cmd="$(git config --get core.sshCommand 2>/dev/null || true)"
  if [[ -n "${git_cmd}" ]]; then
    echo "${git_cmd}"
    return 0
  fi

  if [[ -x /mnt/c/Windows/System32/OpenSSH/ssh.exe ]]; then
    echo "/mnt/c/Windows/System32/OpenSSH/ssh.exe"
    return 0
  fi

  if command -v ssh >/dev/null 2>&1; then
    echo "ssh"
    return 0
  fi

  echo "ERROR: ssh command not found. Set PROD_SSH_CMD or install ssh." >&2
  return 1
}

prod_ssh_host() {
  echo "${PROD_SSH_HOST:-moltook@223.130.158.154}"
}

prod_ssh_run() {
  local remote_cmd="${1:-}"
  if [[ -z "${remote_cmd}" ]]; then
    echo "usage: prod_ssh_run <remote command>" >&2
    return 2
  fi

  local ssh_cmd
  ssh_cmd="$(prod_ssh_cmd)" || return 1

  local host
  host="$(prod_ssh_host)"

  local -a ssh_argv
  read -r -a ssh_argv <<< "${ssh_cmd}"

  local port="${PROD_SSH_PORT:-2222}"
  local -a port_args=("-p" "${port}")
  if [[ "${ssh_cmd}" =~ (^|[[:space:]])-p[[:space:]] ]]; then
    port_args=()
  fi

  "${ssh_argv[@]}" \
    "${port_args[@]}" \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=1 \
    "${host}" "${remote_cmd}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    echo "usage: tools/prod-ssh.sh <remote command>" >&2
    exit 2
  fi
  prod_ssh_run "$*"
fi
