# 参考資料

[English](REFERENCES.md)

以下は技術的な成立可能性と、ネットワーク越しの物理インタラクションに関する背景を
示す資料です。実機検証の代わりにはなりません。

## Windows

- [Microsoft Learn: IOCTL_STORAGE_EJECT_MEDIA](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_storage_eject_media) — リムーバブルメディアをejectするWindowsのデバイス制御。対応状況は機器によって異なります。
- [Microsoft Learn: Storage driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/_storage/) — CD-ROM・ストレージ関連の制御操作一覧。

## macOS

- [Apple Developer: DiskArbitration.h](https://developer.apple.com/documentation/diskarbitration/diskarbitration-h) — ディスクオブジェクトをejectする`DADiskEject`を含みます。
- [Apple Developer: About Disk Arbitration](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/Introduction/Introduction.html) — ディスクの監視・操作を行うフレームワークの概念。
- [Apple Developer: NSWorkspace](https://developer.apple.com/documentation/AppKit/NSWorkspace) — アプリケーションレベルのアンマウント・eject操作。

## ネットワーク越しの物理インタラクション

- [Pokaboo: A networked toy for distance communication and play](https://www.researchgate.net/publication/221238352_Pokaboo_A_networked_toy_for_distance_communication_and_play) — 遠隔ソーシャルプレイに、物理的な呼びかけと応答を用いた例。

## 解釈

OSにはeject手段がありますが、APIの成功が目に見えるトレイ動作を保証するとは限り
ません。そのためEJECTでは、実機検証と正直な結果表示をプロダクト要件として扱います。
