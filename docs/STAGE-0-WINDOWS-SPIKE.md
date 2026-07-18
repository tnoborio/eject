# Stage 0 Windows Spike

[日本語](STAGE-0-WINDOWS-SPIKE.ja.md)

This spike implements the local, non-networked part of Stage 0. It can be built
for Windows on a Linux build host, but its physical behavior still requires a
real Windows computer and tray-style optical drive for validation.

## Scope

The spike does only the following:

1. discover Windows drive roots whose local type is `CDRom`;
2. return an opaque identifier for each discovered optical drive;
3. accept an opaque identifier that was produced by current local discovery;
4. issue the fixed `IOCTL_STORAGE_EJECT_MEDIA` operation once; and
5. return a bounded semantic result and an optional local Win32 error code.

It has no networking, accounts, device registration, arbitrary path input,
generic IO control input, disc-content access, retry loop, or tray-close action.

## Build

Install a .NET 10 SDK, then run:

```sh
./scripts/build-windows-spike.sh
```

The Windows x64 single-file executable is written to:

```text
artifacts/windows-x64/eject-agent.exe
```

The output is self-contained and does not require a separately installed .NET
runtime on the Windows test computer. It is not code-signed and must not be
distributed as a public build.

## Build with GitHub Actions

The `Windows spike` workflow runs the tests and build on GitHub's
`windows-2025` hosted runner. It runs automatically for relevant pull requests
and pushes to `main`, and it also supports manual execution.

To run it in the GitHub website:

1. open **Actions**;
2. select **Windows spike**;
3. select **Run workflow**; and
4. open the completed workflow run.

Download `eject-windows-x64` from the workflow run's **Artifacts** section. The
download contains `eject-agent.exe` and `eject-agent.exe.sha256` and expires
after 14 days. Repository read access and an authenticated GitHub session are
required.

The equivalent GitHub CLI flow is:

```sh
gh workflow run windows-spike.yml
gh run list --workflow windows-spike.yml --limit 1
gh run watch RUN_ID
gh run download RUN_ID --name eject-windows-x64 --dir artifacts/github-actions
```

The workflow performs only discovery during its smoke test. It never asks the
hosted runner to eject a drive. The resulting executable remains an unsigned
test build and is not a release or update artifact.

## Run on Windows

Open PowerShell as a standard user. First discover local optical drives:

```powershell
.\eject-agent.exe list
```

The command returns structured JSON. Select one returned `id`, keep the physical
space in front of that tray clear, and make one eject attempt:

```powershell
.\eject-agent.exe eject optical-REPLACE_WITH_DISCOVERED_ID
```

There is deliberately no drive-path argument. The executable resolves the
opaque identifier against a fresh local discovery before calling the Windows
API.

## Result contract

`COMMAND_ACCEPTED` means that the Windows device-control call returned success.
It does **not** mean that EJECT has independently verified physical tray motion.
The CLI therefore always reports `physical_outcome` as `UNKNOWN`.

Expected bounded failures include:

- `DRIVE_NOT_FOUND`;
- `DRIVE_BUSY`;
- `DRIVE_NOT_READY`;
- `DRIVE_UNSUPPORTED`;
- `DRIVE_DISCONNECTED`;
- `ACCESS_DENIED`; and
- `FAILED`.

## Hardware validation still required

Record the Windows version, user privilege, connection type, drive model, media
state, semantic result, native error code, and observed physical outcome for:

- internal and external tray-style drives;
- empty drives and inserted media;
- busy media;
- disconnected drives;
- trayless or otherwise unsupported drives;
- multiple optical drives; and
- every Windows version intended for support.

Stage 0 is not complete until these results establish a narrow repeatable
capability contract on real hardware.
