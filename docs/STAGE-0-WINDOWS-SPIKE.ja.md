# Stage 0 Windowsスパイク

[English](STAGE-0-WINDOWS-SPIKE.md)

このスパイクは、Stage 0のローカルかつ非ネットワーク部分を実装します。Linuxの
ビルドホストからWindows向けにビルドできますが、物理的な挙動の検証には、実際の
Windows端末とトレイ式光学ドライブが必要です。

## スコープ

このスパイクが行うのは次の処理だけです。

1. ローカル種別が`CDRom`のWindowsドライブルートを検出する。
2. 検出した各光学ドライブに不透明な識別子を返す。
3. 現在のローカル検出で生成された不透明な識別子を受け取る。
4. 固定された`IOCTL_STORAGE_EJECT_MEDIA`操作を1回だけ実行する。
5. 限定された意味コードと、任意のローカルWin32エラーコードを返す。

ネットワーク、アカウント、デバイス登録、任意パス入力、汎用IO制御入力、ディスク
内容へのアクセス、再試行ループ、トレイを閉じる操作はありません。

## ビルド

.NET 10 SDKをインストールし、次を実行します。

```sh
./scripts/build-windows-spike.sh
```

Windows x64向けの単一実行ファイルは次に出力されます。

```text
artifacts/windows-x64/eject-agent.exe
```

出力は自己完結型で、テスト用Windows端末に.NETランタイムを別途インストールする
必要はありません。コード署名はされていないため、公開配布には使用できません。

## GitHub Actionsでのビルド

`Windows spike` workflowは、GitHubの`windows-2025`ホステッドランナー上でテストと
ビルドを実行します。関連するPull Requestと`main`へのpushで自動実行されるほか、
手動でも実行できます。

GitHubのWebサイトから実行する手順は次のとおりです。

1. **Actions**を開く。
2. **Windows spike**を選ぶ。
3. **Run workflow**を選ぶ。
4. 完了したworkflow runを開く。

workflow runの**Artifacts**欄から`eject-windows-x64`をダウンロードします。ダウンロード
内容は`eject-agent.exe`と`eject-agent.exe.sha256`で、14日後に期限切れになります。
リポジトリの読み取り権限と、認証済みのGitHubセッションが必要です。

GitHub CLIでは次のように実行できます。

```sh
gh workflow run windows-spike.yml
gh run list --workflow windows-spike.yml --limit 1
gh run watch RUN_ID
gh run download RUN_ID --name eject-windows-x64 --dir artifacts/github-actions
```

workflowのスモークテストが行うのはドライブ検出だけです。ホステッドランナー上でejectを
要求することはありません。生成される実行ファイルは引き続き未署名のテストビルドで、
リリースや更新用の成果物ではありません。

## Windowsでの実行

PowerShellを標準ユーザーとして開きます。最初にローカルの光学ドライブを検出します。

```powershell
.\eject-agent.exe list
```

コマンドは構造化JSONを返します。返された`id`を1つ選び、トレイ前方の物理空間を
空けてから、ejectを1回試します。

```powershell
.\eject-agent.exe eject optical-REPLACE_WITH_DISCOVERED_ID
```

ドライブパスを指定する引数は意図的に用意していません。実行ファイルはWindows APIを
呼ぶ前に、不透明な識別子を最新のローカル検出結果と照合します。

## 結果の契約

`COMMAND_ACCEPTED`はWindowsのデバイス制御呼び出しが成功を返したことを意味します。
EJECTが物理的なトレイ動作を独立して確認したという意味ではありません。そのため、
CLIは常に`physical_outcome`を`UNKNOWN`として報告します。

想定される限定済みの失敗コードは次のとおりです。

- `DRIVE_NOT_FOUND`
- `DRIVE_BUSY`
- `DRIVE_NOT_READY`
- `DRIVE_UNSUPPORTED`
- `DRIVE_DISCONNECTED`
- `ACCESS_DENIED`
- `FAILED`

## 今後必要な実機検証

次の各条件について、Windowsバージョン、ユーザー権限、接続方式、ドライブ機種、
メディア状態、意味コード、ネイティブエラーコード、観察した物理結果を記録します。

- 内蔵および外付けのトレイ式ドライブ
- 空のドライブおよびメディア挿入時
- メディア使用中
- ドライブ切断時
- トレイレスなどの非対応ドライブ
- 複数の光学ドライブ
- 対応対象とする各Windowsバージョン

実機上で狭く再現可能な能力契約を確立するまで、Stage 0は完了ではありません。
