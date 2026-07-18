namespace Eject.Agent.Windows;

internal interface IWindowsStorageApi
{
    IReadOnlyList<string> GetOpticalDriveRoots();

    NativeEjectAttempt Eject(string driveRoot);
}

internal readonly record struct NativeEjectAttempt(
    bool Succeeded,
    int ErrorCode);
