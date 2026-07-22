namespace Eject.Agent.Core;

public interface IDeviceKeyStore
{
    DevicePublicKey Create(Guid keyId);

    DevicePublicKey GetPublicKey(Guid keyId);

    byte[] Sign(Guid keyId, ReadOnlySpan<byte> data);
}

public sealed class DevicePublicKey
{
    private readonly byte[] _subjectPublicKeyInfo;

    public DevicePublicKey(Guid keyId, ReadOnlySpan<byte> subjectPublicKeyInfo)
    {
        if (keyId == Guid.Empty)
        {
            throw new ArgumentOutOfRangeException(nameof(keyId));
        }

        if (subjectPublicKeyInfo.IsEmpty)
        {
            throw new ArgumentException("Public key must not be empty.", nameof(subjectPublicKeyInfo));
        }

        KeyId = keyId;
        _subjectPublicKeyInfo = subjectPublicKeyInfo.ToArray();
    }

    public Guid KeyId { get; }

    public ReadOnlyMemory<byte> SubjectPublicKeyInfo => _subjectPublicKeyInfo;
}
