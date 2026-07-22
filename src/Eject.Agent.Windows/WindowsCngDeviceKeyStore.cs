using System.Runtime.Versioning;
using System.Security.Cryptography;
using Eject.Agent.Core;

namespace Eject.Agent.Windows;

public enum WindowsDeviceKeyFailure
{
    AlreadyExists,
    NotFound,
    ProtectedStorageUnavailable,
    InvalidStoredKey,
}

public sealed class WindowsDeviceKeyException : Exception
{
    internal WindowsDeviceKeyException(
        WindowsDeviceKeyFailure failure,
        Exception? innerException = null)
        : base(failure.ToString(), innerException)
    {
        Failure = failure;
    }

    public WindowsDeviceKeyFailure Failure { get; }
}

public sealed class WindowsCngDeviceKeyStore : IDeviceKeyStore
{
    private const string KeyNamePrefix = "EJECT-device-";

    [SupportedOSPlatform("windows")]
    public DevicePublicKey Create(Guid keyId)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException();
        }

        ValidateKeyId(keyId);
        var keyName = CreateKeyName(keyId);
        if (FindExistingProviders(keyName).Count != 0)
        {
            throw Failure(WindowsDeviceKeyFailure.AlreadyExists);
        }

        return PreferPlatformProvider(provider => Create(keyId, keyName, provider));
    }

    [SupportedOSPlatform("windows")]
    public DevicePublicKey GetPublicKey(Guid keyId)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException();
        }

        ValidateKeyId(keyId);
        using var key = OpenSingleKey(CreateKeyName(keyId));
        return ExportPublicKey(keyId, key);
    }

    [SupportedOSPlatform("windows")]
    public byte[] Sign(Guid keyId, ReadOnlySpan<byte> data)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException();
        }

        ValidateKeyId(keyId);
        using var key = OpenSingleKey(CreateKeyName(keyId));
        ValidateKey(key);
        using var signer = new ECDsaCng(key);
        var signature = signer.SignData(
            data,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        if (signature.Length != 64)
        {
            throw Failure(WindowsDeviceKeyFailure.InvalidStoredKey);
        }

        return signature;
    }

    internal static string CreateKeyName(Guid keyId)
    {
        ValidateKeyId(keyId);
        return $"{KeyNamePrefix}{keyId:D}";
    }

    internal static T PreferPlatformProvider<T>(
        Func<WindowsCngProviderKind, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        Exception platformFailure;
        try
        {
            return operation(WindowsCngProviderKind.Platform);
        }
        catch (Exception exception) when (IsProviderFailure(exception))
        {
            platformFailure = exception;
        }

        try
        {
            return operation(WindowsCngProviderKind.Software);
        }
        catch (Exception exception) when (IsProviderFailure(exception))
        {
            throw Failure(
                WindowsDeviceKeyFailure.ProtectedStorageUnavailable,
                new AggregateException(platformFailure, exception));
        }
    }

    [SupportedOSPlatform("windows")]
    internal static CngProvider ToProvider(WindowsCngProviderKind provider) =>
        provider switch
        {
            WindowsCngProviderKind.Platform => CngProvider.MicrosoftPlatformCryptoProvider,
            WindowsCngProviderKind.Software => CngProvider.MicrosoftSoftwareKeyStorageProvider,
            _ => throw new ArgumentOutOfRangeException(nameof(provider)),
        };

    [SupportedOSPlatform("windows")]
    private static DevicePublicKey Create(
        Guid keyId,
        string keyName,
        WindowsCngProviderKind providerKind)
    {
        var provider = ToProvider(providerKind);
        try
        {
            using var key = CngKey.Create(
                CngAlgorithm.ECDsaP256,
                keyName,
                new CngKeyCreationParameters
                {
                    Provider = provider,
                    ExportPolicy = CngExportPolicies.None,
                    KeyCreationOptions = CngKeyCreationOptions.None,
                    KeyUsage = CngKeyUsages.Signing,
                });
            return ExportPublicKey(keyId, key);
        }
        catch (Exception exception) when (IsProviderFailure(exception))
        {
            if (KeyExists(keyName, provider))
            {
                throw Failure(WindowsDeviceKeyFailure.AlreadyExists, exception);
            }

            throw;
        }
    }

    [SupportedOSPlatform("windows")]
    private static DevicePublicKey ExportPublicKey(Guid keyId, CngKey key)
    {
        ValidateKey(key);
        using var signer = new ECDsaCng(key);
        var publicKey = signer.ExportSubjectPublicKeyInfo();
        if (publicKey.Length is < 80 or > 120)
        {
            throw Failure(WindowsDeviceKeyFailure.InvalidStoredKey);
        }

        return new DevicePublicKey(keyId, publicKey);
    }

    [SupportedOSPlatform("windows")]
    private static CngKey OpenSingleKey(string keyName)
    {
        var providers = FindExistingProviders(keyName);
        if (providers.Count == 0)
        {
            throw Failure(WindowsDeviceKeyFailure.NotFound);
        }

        if (providers.Count != 1)
        {
            throw Failure(WindowsDeviceKeyFailure.InvalidStoredKey);
        }

        try
        {
            return CngKey.Open(
                keyName,
                ToProvider(providers[0]),
                CngKeyOpenOptions.UserKey | CngKeyOpenOptions.Silent);
        }
        catch (Exception exception) when (IsProviderFailure(exception))
        {
            throw Failure(WindowsDeviceKeyFailure.ProtectedStorageUnavailable, exception);
        }
    }

    [SupportedOSPlatform("windows")]
    private static IReadOnlyList<WindowsCngProviderKind> FindExistingProviders(
        string keyName)
    {
        var providers = new List<WindowsCngProviderKind>(2);
        foreach (var provider in Enum.GetValues<WindowsCngProviderKind>())
        {
            if (KeyExists(keyName, ToProvider(provider)))
            {
                providers.Add(provider);
            }
        }

        return providers;
    }

    [SupportedOSPlatform("windows")]
    private static bool KeyExists(string keyName, CngProvider provider)
    {
        try
        {
            return CngKey.Exists(keyName, provider, CngKeyOpenOptions.UserKey);
        }
        catch (Exception exception) when (IsProviderFailure(exception))
        {
            return false;
        }
    }

    [SupportedOSPlatform("windows")]
    private static void ValidateKey(CngKey key)
    {
        using var signer = new ECDsaCng(key);
        if (
            key.IsMachineKey
            || key.ExportPolicy != CngExportPolicies.None
            || key.KeyUsage != CngKeyUsages.Signing
            || key.AlgorithmGroup != CngAlgorithmGroup.ECDsa
            || signer.KeySize != 256)
        {
            throw Failure(WindowsDeviceKeyFailure.InvalidStoredKey);
        }
    }

    private static void ValidateKeyId(Guid keyId)
    {
        if (keyId == Guid.Empty)
        {
            throw new ArgumentOutOfRangeException(nameof(keyId));
        }
    }

    private static bool IsProviderFailure(Exception exception) =>
        exception is CryptographicException or PlatformNotSupportedException;

    private static WindowsDeviceKeyException Failure(
        WindowsDeviceKeyFailure failure,
        Exception? innerException = null) => new(failure, innerException);
}

internal enum WindowsCngProviderKind
{
    Platform,
    Software,
}
