using Eject.Agent.Core;

namespace Eject.Agent.Windows.Tests;

public sealed class WindowsOpticalDriveAdapterTests
{
    [Fact]
    public void DiscoveryReturnsSortedDistinctOpaqueBindings()
    {
        var storage = new FakeWindowsStorageApi("e:\\", "D:\\", "d:\\");
        var adapter = new WindowsOpticalDriveAdapter(storage);

        var drives = adapter.DiscoverOpticalDrives();

        Assert.Collection(
            drives,
            drive =>
            {
                Assert.StartsWith("optical-", drive.Id, StringComparison.Ordinal);
                Assert.Equal("D:", drive.DisplayName);
                Assert.Equal(ProductCapabilities.OpticalDriveEject, drive.Capability);
            },
            drive => Assert.Equal("E:", drive.DisplayName));
    }

    [Fact]
    public void OpaqueIdIsStableForDriveLetterCase()
    {
        var upper = OpticalDriveIdentity.CreateOpaqueId("D:\\");
        var lower = OpticalDriveIdentity.CreateOpaqueId("d:\\");

        Assert.Equal(upper, lower);
    }

    [Fact]
    public void EjectRejectsUnknownIdWithoutCallingNativeApi()
    {
        var storage = new FakeWindowsStorageApi("D:\\");
        var adapter = new WindowsOpticalDriveAdapter(storage);

        var result = adapter.Eject("optical-NOT-DISCOVERED");

        Assert.Equal(EjectResultCode.DriveNotFound, result.Code);
        Assert.Empty(storage.EjectedRoots);
    }

    [Fact]
    public void EjectResolvesOpaqueIdBackToDiscoveredRoot()
    {
        var storage = new FakeWindowsStorageApi("D:\\");
        var adapter = new WindowsOpticalDriveAdapter(storage);
        var drive = Assert.Single(adapter.DiscoverOpticalDrives());

        var result = adapter.Eject(drive.Id);

        Assert.Equal(EjectResultCode.CommandAccepted, result.Code);
        Assert.Equal(new[] { "D:\\" }, storage.EjectedRoots);
    }

    [Theory]
    [InlineData(5, EjectResultCode.AccessDenied)]
    [InlineData(21, EjectResultCode.NotReady)]
    [InlineData(32, EjectResultCode.Busy)]
    [InlineData(50, EjectResultCode.Unsupported)]
    [InlineData(1167, EjectResultCode.Disconnected)]
    [InlineData(9999, EjectResultCode.Failed)]
    public void NativeErrorsMapToBoundedResults(int nativeError, EjectResultCode expected)
    {
        var storage = new FakeWindowsStorageApi("D:\\")
        {
            Attempt = new NativeEjectAttempt(false, nativeError),
        };
        var adapter = new WindowsOpticalDriveAdapter(storage);
        var drive = Assert.Single(adapter.DiscoverOpticalDrives());

        var result = adapter.Eject(drive.Id);

        Assert.Equal(expected, result.Code);
        Assert.Equal(nativeError, result.NativeErrorCode);
    }

    private sealed class FakeWindowsStorageApi(params string[] driveRoots) : IWindowsStorageApi
    {
        internal NativeEjectAttempt Attempt { get; init; } = new(true, 0);

        internal List<string> EjectedRoots { get; } = [];

        public IReadOnlyList<string> GetOpticalDriveRoots() => driveRoots;

        public NativeEjectAttempt Eject(string driveRoot)
        {
            EjectedRoots.Add(driveRoot);
            return Attempt;
        }
    }
}
