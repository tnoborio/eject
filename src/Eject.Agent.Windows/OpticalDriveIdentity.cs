using System.Security.Cryptography;
using System.Text;

namespace Eject.Agent.Windows;

internal static class OpticalDriveIdentity
{
    internal static string NormalizeRoot(string driveRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(driveRoot);

        if (driveRoot.Length < 2 || !char.IsAsciiLetter(driveRoot[0]) || driveRoot[1] != ':')
        {
            throw new ArgumentOutOfRangeException(nameof(driveRoot));
        }

        return $"{char.ToUpperInvariant(driveRoot[0])}:\\";
    }

    internal static string CreateOpaqueId(string driveRoot)
    {
        var normalizedRoot = NormalizeRoot(driveRoot);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedRoot));
        return $"optical-{Convert.ToHexString(hash.AsSpan(0, 8))}";
    }
}
