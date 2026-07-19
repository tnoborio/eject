[CmdletBinding(DefaultParameterSetName = "Record")]
param(
    [Parameter(ParameterSetName = "Verify", Mandatory = $true)]
    [switch]$VerifyOnly,

    [Parameter(ParameterSetName = "Record", Mandatory = $true)]
    [ValidatePattern('^optical-[0-9A-F]{16}$')]
    [string]$DriveId,

    [Parameter(ParameterSetName = "Record", Mandatory = $true)]
    [ValidatePattern('^[^\r\n]{1,120}$')]
    [string]$DriveModel,

    [Parameter(ParameterSetName = "Record", Mandatory = $true)]
    [ValidateSet("INTERNAL_SATA", "EXTERNAL_USB", "OTHER", "UNKNOWN")]
    [string]$ConnectionType,

    [Parameter(ParameterSetName = "Record", Mandatory = $true)]
    [ValidateSet("TRAY", "TRAYLESS", "UNKNOWN")]
    [string]$Mechanism,

    [Parameter(ParameterSetName = "Record", Mandatory = $true)]
    [ValidateSet("EMPTY", "INSERTED_IDLE", "INSERTED_BUSY", "UNKNOWN")]
    [string]$MediaState,

    [Parameter(ParameterSetName = "Record")]
    [ValidateSet("PRESENT", "ABSENT")]
    [string]$ExpectedDiscoveryState = "PRESENT",

    [Parameter(ParameterSetName = "Record")]
    [string]$OutputPath,

    [ValidateSet("en", "ja")]
    [string]$Locale
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Locale)) {
    $candidateLocale = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName
    $Locale = if ($candidateLocale -eq "ja") { "ja" } else { "en" }
}

function Import-LocaleResource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
    $resourceJson = [IO.File]::ReadAllText($Path, $strictUtf8)
    return $resourceJson | ConvertFrom-Json
}

$resourcePath = Join-Path $PSScriptRoot "locales/stage0-hardware-validation.$Locale.json"
$messages = Import-LocaleResource $resourcePath
$agentPath = Join-Path $PSScriptRoot "eject-agent.exe"
$checksumPath = Join-Path $PSScriptRoot "eject-agent.exe.sha256"
$schemaPath = Join-Path $PSScriptRoot "stage-0-hardware-evidence.schema.json"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot "stage-0-hardware-evidence.json"
}

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
    throw $messages.PlatformUnsupported
}

try {
    $englishMessages = Import-LocaleResource (
        Join-Path $PSScriptRoot "locales/stage0-hardware-validation.en.json")
    $japaneseMessages = Import-LocaleResource (
        Join-Path $PSScriptRoot "locales/stage0-hardware-validation.ja.json")
    $englishKeys = @($englishMessages.PSObject.Properties.Name)
    $japaneseKeys = @($japaneseMessages.PSObject.Properties.Name)
    $localeDifference = Compare-Object $englishKeys $japaneseKeys
    if ($localeDifference) {
        throw "LOCALE_KEY_MISMATCH"
    }
}
catch {
    throw $messages.LocaleResourcesInvalid
}

function Stop-WithMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    throw $Message
}

if (-not (Test-Path -LiteralPath $agentPath -PathType Leaf)) {
    Stop-WithMessage $messages.AgentMissing
}

if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
    Stop-WithMessage $messages.ChecksumMissing
}

if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
    Stop-WithMessage $messages.SchemaMissing
}

try {
    $null = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
}
catch {
    Stop-WithMessage $messages.SchemaInvalid
}

$checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
if ($checksumLine -notmatch '^(?<hash>[0-9a-fA-F]{64})\s+\*?eject-agent\.exe$') {
    Stop-WithMessage $messages.ChecksumInvalid
}

$expectedHash = $Matches.hash.ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $agentPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -cne $expectedHash) {
    Stop-WithMessage $messages.ChecksumMismatch
}

$discoveryText = (& $agentPath list | Out-String)
$discoveryExitCode = $LASTEXITCODE
if ($discoveryExitCode -ne 0) {
    Stop-WithMessage ($messages.DiscoveryFailed -f $discoveryExitCode)
}

try {
    $discovery = $discoveryText | ConvertFrom-Json
}
catch {
    Stop-WithMessage $messages.DiscoveryInvalid
}

if ($discovery.event -cne "DRIVE_DISCOVERY_COMPLETED") {
    Stop-WithMessage $messages.DiscoveryInvalid
}

$drives = @($discovery.drives)

if ($VerifyOnly) {
    Write-Host ($messages.VerificationCompleted -f $drives.Count)
    exit 0
}

if (Test-Path -LiteralPath $OutputPath) {
    Stop-WithMessage ($messages.OutputExists -f $OutputPath)
}

if ([string]::IsNullOrWhiteSpace($DriveModel)) {
    Stop-WithMessage $messages.DriveModelInvalid
}

$outputDirectory = Split-Path -Parent $OutputPath
if ([string]::IsNullOrWhiteSpace($outputDirectory)) {
    $outputDirectory = Get-Location
}

if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    Stop-WithMessage ($messages.OutputDirectoryMissing -f $outputDirectory)
}

$matchingDrives = @($drives | Where-Object { $_.id -ceq $DriveId })
if ($ExpectedDiscoveryState -eq "PRESENT" -and $matchingDrives.Count -ne 1) {
    Stop-WithMessage $messages.ExpectedDriveMissing
}

if ($ExpectedDiscoveryState -eq "ABSENT" -and $matchingDrives.Count -ne 0) {
    Stop-WithMessage $messages.ExpectedDrivePresent
}

Write-Host $messages.SafetyNotice
$confirmation = Read-Host $messages.ConfirmationPrompt
if ($confirmation -cne "EJECT") {
    Write-Host $messages.Cancelled
    exit 3
}

# This is the only physical attempt in the helper. There is deliberately no
# retry path, regardless of the process exit code or semantic result.
$attemptText = (& $agentPath eject $DriveId | Out-String)
$attemptExitCode = $LASTEXITCODE
$attemptResult = "RESULT_UNKNOWN"
$nativeErrorCode = $null
$allowedResults = @(
    "COMMAND_ACCEPTED",
    "DRIVE_NOT_FOUND",
    "DRIVE_BUSY",
    "DRIVE_NOT_READY",
    "DRIVE_UNSUPPORTED",
    "DRIVE_DISCONNECTED",
    "ACCESS_DENIED",
    "FAILED")

try {
    $attempt = $attemptText | ConvertFrom-Json
    $reportedResult = [string]$attempt.result
    if ($attempt.event -ceq "EJECT_ATTEMPT_COMPLETED" -and
        $allowedResults -ccontains $reportedResult) {
        $attemptResult = $reportedResult
        $nativeErrorCode = $attempt.native_error_code
    }
}
catch {
    # The physical attempt may already have happened. Preserve that fact in a
    # bounded report instead of invoking the executable again.
}

$allowedOutcomes = @("OPENED", "NO_VISIBLE_MOVEMENT", "NOT_OBSERVABLE")
do {
    $observedOutcome = (Read-Host $messages.ObservationPrompt).Trim().ToUpperInvariant()
    if ($allowedOutcomes -notcontains $observedOutcome) {
        Write-Host $messages.ObservationInvalid
    }
} while ($allowedOutcomes -notcontains $observedOutcome)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$privilege = if ($isElevated) { "ELEVATED" } else { "STANDARD_USER" }

$report = [ordered]@{
    schema_version = 1
    event = "STAGE_0_HARDWARE_TEST_RECORDED"
    test_date = [DateTimeOffset]::Now.ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
    platform = [ordered]@{
        name = "WINDOWS"
        version = [Environment]::OSVersion.Version.ToString()
        architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToUpperInvariant()
        privilege = $privilege
    }
    drive = [ordered]@{
        model = $DriveModel.Trim()
        connection_type = $ConnectionType
        mechanism = $Mechanism
        media_state = $MediaState
        expected_discovery_state = $ExpectedDiscoveryState
        discovered_drive_count = $drives.Count
    }
    agent = [ordered]@{
        sha256 = $actualHash
    }
    attempt = [ordered]@{
        process_exit_code = $attemptExitCode
        result = $attemptResult
        native_error_code = $nativeErrorCode
        physical_outcome = $observedOutcome
    }
}

$json = $report | ConvertTo-Json -Depth 5
$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($OutputPath, $json + [Environment]::NewLine, $utf8WithoutBom)
Write-Host ($messages.ReportWritten -f $OutputPath)
