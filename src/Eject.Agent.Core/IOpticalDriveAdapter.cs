namespace Eject.Agent.Core;

public interface IOpticalDriveAdapter
{
    IReadOnlyList<DriveCapability> DiscoverOpticalDrives();

    EjectResult Eject(string locallyDiscoveredDriveId);
}
