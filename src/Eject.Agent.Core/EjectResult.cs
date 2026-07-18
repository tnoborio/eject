namespace Eject.Agent.Core;

public enum EjectResultCode
{
    CommandAccepted,
    DriveNotFound,
    Busy,
    NotReady,
    Unsupported,
    Disconnected,
    AccessDenied,
    Failed,
}

public sealed record EjectResult(
    EjectResultCode Code,
    int? NativeErrorCode = null);
