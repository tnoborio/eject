using System.Text.Json;
using Eject.Agent.Core;
using Eject.Agent.Windows;

return Run(args);

static int Run(string[] arguments)
{
    if (!OperatingSystem.IsWindows())
    {
        WriteJson(new
        {
            Event = "AGENT_START_REJECTED",
            Result = "PLATFORM_UNSUPPORTED",
            RequiredPlatform = "WINDOWS",
        });
        return 20;
    }

    try
    {
        var adapter = new WindowsOpticalDriveAdapter();

        if (arguments is ["list"])
        {
            WriteJson(new
            {
                Event = "DRIVE_DISCOVERY_COMPLETED",
                Drives = adapter.DiscoverOpticalDrives(),
            });
            return 0;
        }

        if (arguments is ["eject", var driveId])
        {
            var result = adapter.Eject(driveId);
            WriteJson(new
            {
                Event = "EJECT_ATTEMPT_COMPLETED",
                DriveId = driveId,
                Result = ToCode(result.Code),
                NativeErrorCode = result.NativeErrorCode,
                PhysicalOutcome = "UNKNOWN",
            });
            return result.Code == EjectResultCode.CommandAccepted ? 0 : 10;
        }

        WriteJson(new
        {
            Event = "CLI_USAGE_REQUIRED",
            Commands = new object[]
            {
                new { Name = "list", Arguments = Array.Empty<string>() },
                new { Name = "eject", Arguments = new[] { "drive_id" } },
            },
        });
        return 2;
    }
    catch (IOException)
    {
        WriteJson(new { Event = "AGENT_OPERATION_FAILED", Result = "IO_FAILURE" });
        return 11;
    }
    catch (UnauthorizedAccessException)
    {
        WriteJson(new { Event = "AGENT_OPERATION_FAILED", Result = "ACCESS_DENIED" });
        return 12;
    }
}

static string ToCode(EjectResultCode code) => code switch
{
    EjectResultCode.CommandAccepted => "COMMAND_ACCEPTED",
    EjectResultCode.DriveNotFound => "DRIVE_NOT_FOUND",
    EjectResultCode.Busy => "DRIVE_BUSY",
    EjectResultCode.NotReady => "DRIVE_NOT_READY",
    EjectResultCode.Unsupported => "DRIVE_UNSUPPORTED",
    EjectResultCode.Disconnected => "DRIVE_DISCONNECTED",
    EjectResultCode.AccessDenied => "ACCESS_DENIED",
    _ => "FAILED",
};

static void WriteJson<T>(T value)
{
    var options = new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
    };

    Console.WriteLine(JsonSerializer.Serialize(value, options));
}
