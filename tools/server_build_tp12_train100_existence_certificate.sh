#!/usr/bin/env bash
set -euo pipefail

bash tools/run_server_command.sh node tools/build_tp12_train100_existence_certificate.mjs "$@"

