using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Eject.Agent.Windows;

[SupportedOSPlatform("windows")]
internal sealed partial class WindowsStorageApi : IWindowsStorageApi
{
    private const uint GenericRead = 0x80000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint IoctlStorageEjectMedia = 0x002D4808;
    private const int ErrorInvalidName = 123;

    public IReadOnlyList<string> GetOpticalDriveRoots() =>
        DriveInfo.GetDrives()
            .Where(drive => drive.DriveType == DriveType.CDRom)
            .Select(drive => drive.Name)
            .ToArray();

    public NativeEjectAttempt Eject(string driveRoot)
    {
        var normalizedRoot = OpticalDriveIdentity.NormalizeRoot(driveRoot);
        if (normalizedRoot.Length != 3)
        {
            return new NativeEjectAttempt(false, ErrorInvalidName);
        }

        var devicePath = $@"\\.\{normalizedRoot[..2]}";
        using var handle = CreateFile(
            devicePath,
            GenericRead,
            FileShareRead | FileShareWrite,
            IntPtr.Zero,
            OpenExisting,
            0,
            IntPtr.Zero);

        if (handle.IsInvalid)
        {
            return new NativeEjectAttempt(false, Marshal.GetLastPInvokeError());
        }

        var succeeded = DeviceIoControl(
            handle,
            IoctlStorageEjectMedia,
            IntPtr.Zero,
            0,
            IntPtr.Zero,
            0,
            out _,
            IntPtr.Zero);

        return succeeded
            ? new NativeEjectAttempt(true, 0)
            : new NativeEjectAttempt(false, Marshal.GetLastPInvokeError());
    }

    [LibraryImport(
        "kernel32.dll",
        EntryPoint = "CreateFileW",
        SetLastError = true,
        StringMarshalling = StringMarshalling.Utf16)]
    private static partial SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DeviceIoControl(
        SafeFileHandle device,
        uint controlCode,
        IntPtr inputBuffer,
        uint inputBufferSize,
        IntPtr outputBuffer,
        uint outputBufferSize,
        out uint bytesReturned,
        IntPtr overlapped);
}
