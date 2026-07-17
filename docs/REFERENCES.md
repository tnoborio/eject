# References

[日本語](REFERENCES.ja.md)

These sources establish technical feasibility and provide context for physical
interaction over a network. They do not replace hardware testing.

## Windows

- [Microsoft Learn: IOCTL_STORAGE_EJECT_MEDIA](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_storage_eject_media) — supported Windows device-control operation for ejecting removable media; support can vary by device.
- [Microsoft Learn: Storage driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/_storage/) — related CD-ROM and storage control operations.

## macOS

- [Apple Developer: DiskArbitration.h](https://developer.apple.com/documentation/diskarbitration/diskarbitration-h) — includes `DADiskEject` for ejecting a disk object.
- [Apple Developer: About Disk Arbitration](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/Introduction/Introduction.html) — framework concepts for observing and manipulating disks.
- [Apple Developer: NSWorkspace](https://developer.apple.com/documentation/AppKit/NSWorkspace) — application-level unmount and eject operations.

## Networked physical interaction

- [Pokaboo: A networked toy for distance communication and play](https://www.researchgate.net/publication/221238352_Pokaboo_A_networked_toy_for_distance_communication_and_play) — an example of physical call-and-response used for remote social play.

## Interpretation

The operating systems provide ejection mechanisms, but an API success does not
necessarily prove that a visible tray moved. EJECT therefore treats real-device
testing and truthful outcome reporting as product requirements.
