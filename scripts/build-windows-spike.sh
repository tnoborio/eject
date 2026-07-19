#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
artifact_dir="${repository_root}/artifacts/windows-x64"
dotnet_command="${EJECT_DOTNET_COMMAND:-dotnet}"

cd "${repository_root}"

"${dotnet_command}" test Eject.slnx --configuration Release
"${dotnet_command}" publish src/Eject.Agent.Cli/Eject.Agent.Cli.csproj \
  --configuration Release \
  --runtime win-x64 \
  --self-contained true \
  --output "${artifact_dir}" \
  -p:PublishSingleFile=true \
  -p:DebugType=None

cp scripts/record-windows-hardware-test.ps1 "${artifact_dir}/"
cp docs/schemas/stage-0-hardware-evidence.schema.json "${artifact_dir}/"
mkdir -p "${artifact_dir}/locales"
cp scripts/locales/stage0-hardware-validation.*.json "${artifact_dir}/locales/"
(
  cd "${artifact_dir}"
  sha256sum eject-agent.exe > eject-agent.exe.sha256
)
