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

The Windows x64 single-file executable and hardware-validation kit are written
to:

```text
artifacts/windows-x64/eject-agent.exe
```

The output contains the self-contained executable, its checksum, the validation
helper, English and Japanese helper resources, and the evidence JSON Schema. It
does not require a separately installed .NET runtime on the Windows test
computer. It is not code-signed and must not be distributed as a public build.

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
download contains `eject-agent.exe`, its checksum, and the hardware-validation
kit, and expires after 14 days. Repository read access and an authenticated
GitHub session are required.

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

## Record one hardware test

The artifact includes `record-windows-hardware-test.ps1`. It verifies the
executable checksum, performs fresh discovery, requires a physical-safety
confirmation, makes exactly one eject attempt, and asks the tester to classify
the visible outcome. It never retries the physical operation.

Before any physical test, verify the assembled kit without ejecting:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\record-windows-hardware-test.ps1 `
  -VerifyOnly `
  -Locale en
```

First run `list` and copy the selected opaque identifier. For a present,
tray-style external USB drive with no media, run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\record-windows-hardware-test.ps1 `
  -DriveId optical-REPLACE_WITH_DISCOVERED_ID `
  -DriveModel "Manufacturer and model family only" `
  -ConnectionType EXTERNAL_USB `
  -Mechanism TRAY `
  -MediaState EMPTY `
  -Locale en `
  -OutputPath .\stage-0-usb-empty.json
```

The execution-policy override in these commands applies only to that PowerShell
process. Use it only for the unsigned test artifact downloaded from the known
Actions run; do not change the machine-wide execution policy. The helper still
verifies the companion executable checksum before discovery or eject.

The helper accepts `en` and `ja`. Omit `-Locale` to select Japanese when the
Windows UI culture is Japanese and English otherwise. Enter `EJECT` only after
clearing the space in front of the tray. After the attempt, record one of:

- `OPENED`;
- `NO_VISIBLE_MOVEMENT`; or
- `NOT_OBSERVABLE`.

For a disconnect test, retain an identifier from a prior discovery, disconnect
that known test drive, and add `-ExpectedDiscoveryState ABSENT`. The helper
requires the identifier to be absent before invoking the agent, so the adapter
records its bounded not-found result without accepting a device path.

The resulting JSON follows `stage-0-hardware-evidence.schema.json`. It includes
only the test date, Windows version and architecture, privilege class, coarse
drive conditions, executable checksum, bounded agent result, and human-observed
physical outcome. It excludes the drive identifier, user name, computer name,
device serial number, media contents, and exact event time.

Keep raw reports local until reviewed. Record only the manufacturer and model
family in `-DriveModel`; never enter a serial number, asset tag, person name, or
computer name. A reviewed report may be committed later as explicit Stage 0
evidence. It is test evidence, not private product event history.

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

Use the validation helper to record the Windows version, user privilege,
connection type, drive model family, media state, semantic result, native error
code, and observed physical outcome for:

- internal and external tray-style drives;
- empty drives and inserted media;
- busy media;
- disconnected drives;
- trayless or otherwise unsupported drives;
- multiple optical drives; and
- every Windows version intended for support.

Stage 0 is not complete until these results establish a narrow repeatable
capability contract on real hardware.
