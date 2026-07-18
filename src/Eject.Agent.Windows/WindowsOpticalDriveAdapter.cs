using Eject.Agent.Core;

namespace Eject.Agent.Windows;

public sealed class WindowsOpticalDriveAdapter : IOpticalDriveAdapter
{
    private readonly IWindowsStorageApi _storageApi;

    public WindowsOpticalDriveAdapter()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException();
        }

        _storageApi = new WindowsStorageApi();
    }

    internal WindowsOpticalDriveAdapter(IWindowsStorageApi storageApi)
    {
        _storageApi = storageApi ?? throw new ArgumentNullException(nameof(storageApi));
    }

    public IReadOnlyList<DriveCapability> DiscoverOpticalDrives() =>
        DiscoverDriveBindings()
            .Select(binding => binding.Capability)
            .ToArray();

    public EjectResult Eject(string locallyDiscoveredDriveId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(locallyDiscoveredDriveId);

        var binding = DiscoverDriveBindings()
            .SingleOrDefault(candidate =>
                string.Equals(
                    candidate.Capability.Id,
                    locallyDiscoveredDriveId,
                    StringComparison.Ordinal));

        if (binding is null)
        {
            return new EjectResult(EjectResultCode.DriveNotFound);
        }

        var attempt = _storageApi.Eject(binding.DriveRoot);
        return MapResult(attempt);
    }

    private IReadOnlyList<DriveBinding> DiscoverDriveBindings() =>
        _storageApi.GetOpticalDriveRoots()
            .Select(OpticalDriveIdentity.NormalizeRoot)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Select(root => new DriveBinding(
                root,
                new DriveCapability(
                    OpticalDriveIdentity.CreateOpaqueId(root),
                    root[..2],
                    ProductCapabilities.OpticalDriveEject)))
            .ToArray();

    private static EjectResult MapResult(NativeEjectAttempt attempt)
    {
        if (attempt.Succeeded)
        {
            return new EjectResult(EjectResultCode.CommandAccepted);
        }

        var code = attempt.ErrorCode switch
        {
            1 or 50 => EjectResultCode.Unsupported,
            3 or 15 or 55 or 1117 or 1167 => EjectResultCode.Disconnected,
            5 => EjectResultCode.AccessDenied,
            21 => EjectResultCode.NotReady,
            32 or 33 => EjectResultCode.Busy,
            _ => EjectResultCode.Failed,
        };

        return new EjectResult(code, attempt.ErrorCode);
    }

    private sealed record DriveBinding(
        string DriveRoot,
        DriveCapability Capability);
}
