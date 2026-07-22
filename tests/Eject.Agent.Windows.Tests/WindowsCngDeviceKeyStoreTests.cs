using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Eject.Agent.Windows;

namespace Eject.Agent.Windows.Tests;

public sealed class WindowsCngDeviceKeyStoreTests
{
    [Fact]
    public void KeyNameIsCanonicalAndBoundOnlyToTheKeyId()
    {
        var keyId = Guid.Parse("11111111-2222-4333-8444-555555555555");

        Assert.Equal(
            "EJECT-device-11111111-2222-4333-8444-555555555555",
            WindowsCngDeviceKeyStore.CreateKeyName(keyId));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            WindowsCngDeviceKeyStore.CreateKeyName(Guid.Empty));
    }

    [Fact]
    public void ProviderSelectionPrefersPlatformAndStopsAfterSuccess()
    {
        var attempted = new List<WindowsCngProviderKind>();

        var selected = WindowsCngDeviceKeyStore.PreferPlatformProvider(provider =>
        {
            attempted.Add(provider);
            return provider;
        });

        Assert.Equal(WindowsCngProviderKind.Platform, selected);
        Assert.Equal(new[] { WindowsCngProviderKind.Platform }, attempted);
    }

    [Fact]
    public void ProviderSelectionFallsBackOnlyAfterAProviderFailure()
    {
        var attempted = new List<WindowsCngProviderKind>();

        var selected = WindowsCngDeviceKeyStore.PreferPlatformProvider(provider =>
        {
            attempted.Add(provider);
            if (provider == WindowsCngProviderKind.Platform)
            {
                throw new CryptographicException();
            }

            return provider;
        });

        Assert.Equal(WindowsCngProviderKind.Software, selected);
        Assert.Equal(
            new[]
            {
                WindowsCngProviderKind.Platform,
                WindowsCngProviderKind.Software,
            },
            attempted);
        Assert.Throws<InvalidOperationException>(() =>
            WindowsCngDeviceKeyStore.PreferPlatformProvider<int>(_ =>
                throw new InvalidOperationException()));
    }

    [Fact]
    public void ProviderSelectionFailsWhenNeitherProtectedProviderWorks()
    {
        var exception = Assert.Throws<WindowsDeviceKeyException>(() =>
            WindowsCngDeviceKeyStore.PreferPlatformProvider<int>(_ =>
                throw new CryptographicException()));

        Assert.Equal(
            WindowsDeviceKeyFailure.ProtectedStorageUnavailable,
            exception.Failure);
        Assert.IsType<AggregateException>(exception.InnerException);
    }

    [Fact]
    [SupportedOSPlatform("windows")]
    public void WindowsKeyIsPersistentCurrentUserNonExportableP256AndSignsP1363()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var keyId = Guid.NewGuid();
        var store = new WindowsCngDeviceKeyStore();
        try
        {
            var created = store.Create(keyId);
            var reopened = new WindowsCngDeviceKeyStore().GetPublicKey(keyId);
            Assert.Equal(keyId, created.KeyId);
            Assert.Equal(
                created.SubjectPublicKeyInfo.ToArray(),
                reopened.SubjectPublicKeyInfo.ToArray());

            var payload = Encoding.UTF8.GetBytes("EJECT-CNG-TEST-V1");
            var signature = store.Sign(keyId, payload);
            Assert.Equal(64, signature.Length);
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(
                created.SubjectPublicKeyInfo.Span,
                out var bytesRead);
            Assert.Equal(created.SubjectPublicKeyInfo.Length, bytesRead);
            Assert.Equal(256, verifier.KeySize);
            Assert.True(verifier.VerifyData(
                payload,
                signature,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

            using var key = OpenTestKey(keyId);
            Assert.False(key.IsMachineKey);
            Assert.Equal(CngExportPolicies.None, key.ExportPolicy);
            Assert.Equal(CngKeyUsages.Signing, key.KeyUsage);
            Assert.Throws<CryptographicException>(() =>
                key.Export(CngKeyBlobFormat.EccPrivateBlob));

            var duplicate = Assert.Throws<WindowsDeviceKeyException>(() =>
                store.Create(keyId));
            Assert.Equal(WindowsDeviceKeyFailure.AlreadyExists, duplicate.Failure);
        }
        finally
        {
            DeleteTestKey(keyId);
        }
    }

    [SupportedOSPlatform("windows")]
    private static CngKey OpenTestKey(Guid keyId)
    {
        var keyName = WindowsCngDeviceKeyStore.CreateKeyName(keyId);
        var providers = Enum.GetValues<WindowsCngProviderKind>()
            .Select(WindowsCngDeviceKeyStore.ToProvider)
            .Where(provider => CngKey.Exists(
                keyName,
                provider,
                CngKeyOpenOptions.UserKey))
            .ToArray();
        var provider = Assert.Single(providers);
        return CngKey.Open(
            keyName,
            provider,
            CngKeyOpenOptions.UserKey | CngKeyOpenOptions.Silent);
    }

    [SupportedOSPlatform("windows")]
    private static void DeleteTestKey(Guid keyId)
    {
        var keyName = WindowsCngDeviceKeyStore.CreateKeyName(keyId);
        foreach (var providerKind in Enum.GetValues<WindowsCngProviderKind>())
        {
            var provider = WindowsCngDeviceKeyStore.ToProvider(providerKind);
            try
            {
                if (!CngKey.Exists(keyName, provider, CngKeyOpenOptions.UserKey))
                {
                    continue;
                }

                using var key = CngKey.Open(
                    keyName,
                    provider,
                    CngKeyOpenOptions.UserKey | CngKeyOpenOptions.Silent);
                key.Delete();
            }
            catch (CryptographicException)
            {
                // An unavailable provider cannot contain the unique test key.
            }
        }
    }
}
