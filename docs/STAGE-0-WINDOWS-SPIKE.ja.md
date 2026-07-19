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

Windows x64向けの単一実行ファイルとハードウェア検証キットは次に出力されます。

```text
artifacts/windows-x64/eject-agent.exe
```

出力には、自己完結型実行ファイル、そのチェックサム、検証ツール、英語・日本語の
検証ツール用リソース、証拠JSON Schemaが含まれます。テスト用Windows端末に.NET
ランタイムを別途インストールする必要はありません。コード署名はされていないため、
公開配布には使用できません。

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
内容には`eject-agent.exe`、そのチェックサム、ハードウェア検証キットが含まれ、14日後に
期限切れになります。リポジトリの読み取り権限と、認証済みのGitHubセッションが必要です。

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

## 1件のハードウェアテストを記録する

artifactには`record-windows-hardware-test.ps1`が含まれます。このツールは実行ファイルの
チェックサムを検証し、最新のドライブ検出を行い、物理的安全の確認を求めた後、ejectを
正確に1回だけ試します。その後、テスターに目視結果の分類を求めます。物理操作を再試行する
ことはありません。

物理テストの前に、ejectせず検証キットの組み立てを確認します。

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\record-windows-hardware-test.ps1 `
  -VerifyOnly `
  -Locale ja
```

最初に`list`を実行し、選択した不透明な識別子をコピーします。メディアが入っていない、
存在するトレイ式外付けUSBドライブなら、次のように実行します。

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\record-windows-hardware-test.ps1 `
  -DriveId optical-REPLACE_WITH_DISCOVERED_ID `
  -DriveModel "メーカー名とモデル系列のみ" `
  -ConnectionType EXTERNAL_USB `
  -Mechanism TRAY `
  -MediaState EMPTY `
  -Locale ja `
  -OutputPath .\stage-0-usb-empty.json
```

これらのコマンドにあるexecution policyのoverrideは、そのPowerShell processだけに適用
されます。既知のActions runからダウンロードした未署名テストartifactにだけ使い、端末全体の
execution policyは変更しないでください。検証ツールは引き続き、ドライブ検出やejectより前に
同梱実行ファイルのチェックサムを検証します。

検証ツールは`en`と`ja`に対応します。`-Locale`を省略すると、Windows UIカルチャが日本語
なら日本語、それ以外なら英語を選びます。トレイの前方を空けてから`EJECT`と入力して
ください。実行後、次のいずれかを記録します。

- `OPENED`
- `NO_VISIBLE_MOVEMENT`
- `NOT_OBSERVABLE`

切断テストでは、以前の検出で得た識別子を保持し、既知のテスト用ドライブを切断して、
`-ExpectedDiscoveryState ABSENT`を追加します。検証ツールはagentを呼ぶ前に識別子が存在
しないことを要求するため、デバイスパスを受け付けずに、adapterの限定されたnot-found結果を
記録できます。

生成されるJSONは`stage-0-hardware-evidence.schema.json`に従います。テスト日、Windowsの
バージョンとアーキテクチャ、権限区分、粗いドライブ条件、実行ファイルのチェックサム、
限定されたagent結果、人が目視した物理結果だけを含みます。ドライブ識別子、ユーザー名、
コンピューター名、デバイスのシリアル番号、メディア内容、正確なイベント時刻は含めません。

生のレポートはレビューするまでローカルに保管してください。`-DriveModel`にはメーカー名と
モデル系列だけを記録し、シリアル番号、資産タグ、人名、コンピューター名を入力しないで
ください。レビュー済みレポートは、後でStage 0の明示的な証拠としてコミットできます。
これはテスト証拠であり、非公開のプロダクトイベント履歴ではありません。

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

次の各条件について、検証ツールを使い、Windowsバージョン、ユーザー権限、接続方式、
ドライブのモデル系列、メディア状態、意味コード、ネイティブエラーコード、観察した物理結果を
記録します。

- 内蔵および外付けのトレイ式ドライブ
- 空のドライブおよびメディア挿入時
- メディア使用中
- ドライブ切断時
- トレイレスなどの非対応ドライブ
- 複数の光学ドライブ
- 対応対象とする各Windowsバージョン

実機上で狭く再現可能な能力契約を確立するまで、Stage 0は完了ではありません。
