# クラウドデータベース運用

[English](CLOUD-DATABASE.md)

このrunbookは、EJECT専用managed databaseとdeployment境界を記録します。provider識別子と
再現可能な確認方法は含めますが、credential、署名素材、device token、user dataは含めません。

## 作成済み環境

2026-07-24時点で、Sasaraの運用管理下に次の環境があります。

| Component               | 設定                              |
| ----------------------- | --------------------------------- |
| Supabase project        | `EJECT` (`twmmpmwmlegqlaoalolv`)  |
| Database region         | Tokyo、`ap-northeast-1`           |
| Database engine         | PostgreSQL 17                     |
| Vercel project          | `sasara/eject`                    |
| Vercel application root | npm workspace内の`control-plane`  |
| Vercel runtime          | Next.js、Node.js 22、Tokyo `hnd1` |
| Git source              | `tnoborio/eject`                  |

Supabase projectはEJECT専用です。`sasara-hub`内のdatabaseではなく、他のSasara serviceと
application schemaやcredentialを共有しません。

repository migration 5件はすべて適用・checksum検証済みです。PostgreSQLはTLSを使わない外部接続を
拒否します。singleton delivery gateは`false`、physical hourly ceilingは未設定で、EJECT application
tableには招待済みperson 1件が存在し、relationship、relationship invitation、device、command、
result、private eventは存在しません。

## Environment境界

Vercelはrepository外に設定を保存します。

| Variable                          | Production | Preview | Development |
| --------------------------------- | ---------- | ------- | ----------- |
| `DATABASE_URL`                    | sensitive  | なし    | なし        |
| `EJECT_DATABASE_SSL_CA_B64`       | sensitive  | なし    | なし        |
| `EJECT_AGENT_DELIVERY_ENABLED`    | `false`    | `false` | `false`     |
| `EJECT_DEVICE_ENROLLMENT_ENABLED` | なし       | なし    | なし        |
| `EJECT_PERSON_AUTH_ENABLED`       | `true`     | なし    | なし        |
| `EJECT_SUPABASE_AUTH_ISSUER`      | 設定済み   | なし    | なし        |
| `EJECT_SUPABASE_AUTH_AUDIENCE`    | 設定済み   | なし    | なし        |
| `EJECT_SUPABASE_PUBLISHABLE_KEY`  | 設定済み   | なし    | なし        |
| `EJECT_PUBLIC_ORIGIN`             | 設定済み   | なし    | なし        |

Productionはport 6543のSupavisor transaction poolerを使います。Preview buildにはproduction
database credentialを渡しません。shellのbuildとrenderはできますが、agent routeは利用できない
ままです。Developmentはdownloadしたproduction secretではなく、operatorが指定したlocal database
URLを使います。

Vercelにserver response-signing private keyは設定していません。environment delivery flagを誤って
変更しても、必要なsigning keyがないためagent transport compositionはfail closedになります。
独立したdatabase delivery gateも無効のままです。device enrollmentもopt-in environment variableが
存在しないため、独立してfail closedです。person authは完全一致する
`https://eject-bice.vercel.app` originのProductionだけで有効です。PreviewとDevelopmentはauth
opt-inとprovider設定がないためfail closedのままです。

## 招待制person provisioning

person authenticationはdevice enrollment・deliveryから分離します。有効化する前にSupabase Authの
public sign-upを拒否し、完全一致するEJECT HTTPS originをsite URLかつ唯一のredirect originとして
設定します。

招待済みの既存accountは、Vercelやbrowserではなくoperator環境からprovisionします。保護された
production database変数、完全一致するSupabase issuer、operatorだけが使うsecret API keyをprocess
environmentで渡します。

```sh
npm run person:provision --workspace @eject/control-plane -- \
  PERSON_EMAIL "Display name"
```

scriptはconfirmed Supabase Auth identityを作成し、同じUUIDを持つEJECT `people` rowとprivate-by-defaultの
`recipient_access_policies` rowを1つのdatabase transactionで作成します。そのtransactionが失敗した場合は
新しいAuth identityの削除を試みます。email、token、database credentialは出力しません。rollbackに確認が
必要と報告された場合はSupabase Authを手動確認します。

`EJECT_PROVISIONING_SUPABASE_SECRET_KEY`をVercelへ設定してはいけません。deployed applicationが必要と
するのはpublishable keyだけで、固定sign-in requestは`create_user = false`を使います。

## Production email OTP delivery

2026-07-27時点で、Supabase Authはverified済み`sasara.io` domainのsenderを持つResend custom SMTPを
使います。SMTP credentialはprovider設定内だけに存在し、repositoryやVercelには存在しません。

独立したManagement API read-backで、external email有効、port 465のResend SMTP endpoint、
public sign-up無効、email OTPが8桁・有効期限10分のままであることを検証しました。magic-link
templateは英日両方で限定された`{{ .Token }}`値を含み、`{{ .ConfirmationURL }}`を含みません。

新しいProduction requestはHTTP 202を返し、text・HTML alternative内に同一の一意な8桁codeを1件だけ
含み、URLを含まないemailを配送しました。OTP endpointはHTTP 204を返し、その後、保護された
owner-device・consent routeはHTTP 200を返しました。device 0件、relationship 0件、incoming accessの
pauseなしを確認しました。logoutはHTTP 204、その後の保護device routeはHTTP 401を返しました。
email address、OTP、provider credential、session値はlogへ残していません。Gmail connectorはmessageの
検索・読取だけに使い、一時PKCE・cookie fileはすべて削除しました。

## TLS trust

applicationは、Supabase hostnameに対してbase64 encodeしたX.509 CAを
`EJECT_DATABASE_SSL_CA_B64`に必須とします。`DATABASE_URL`内のTLS optionを拒否し、certificateを
検証して、Supabase Root 2021 CAのSHA-256 fingerprintをpinします。

```text
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

これにより、暗号化はするが検証しない接続ではなく、CAとhostnameの検証を維持します。
SupabaseはDashboardからCAを配布し、[SSL guide](https://supabase.com/docs/guides/platform/ssl-enforcement)で
`verify-full`を最も強いmodeとして説明しています。

## Migration適用

`control-plane/migrations/`の英語SQL fileを、EJECT schemaの唯一の正本として維持します。
provider dashboardでdatabase schemaを編集してはいけません。

operator sessionでは、database passwordと現在のSupabase CAをprovider controlから取得し、
repositoryへ書き込まないでください。migrationにはport 5432のsession poolerを使い、次を実行します。

```sh
cd control-plane
npm run migrate
npm run verify:cloud-database -- --expect-empty
```

そのprocess environmentに`DATABASE_URL`と`EJECT_DATABASE_SSL_CA_B64`が設定済みである必要が
あります。migration runnerはPostgreSQL advisory lockを取得し、各fileをtransaction内で適用し、
適用済みmigrationをskipする前に保存済みSHA-256 checksumを検証します。

実accountが存在するようになった後は`--expect-empty`を外します。その場合もverifierは次を必須とします。

- repositoryと完全一致するmigration名・checksum
- PostgreSQL major version 17
- pin済みTLS CAと検証済み接続の成功
- `delivery_enabled = false`
- `physical_hourly_ceiling IS NULL`

出力するのは限定された運用上の事実とEJECT rowの合計数だけです。connection string、host credential、
row内容、event識別子は出力しません。

migration 0005をdeployした後、同じoperator専用環境からinvitation cleanupを実行します。

```sh
npm run relationships:cleanup
```

1回につき、使用・無効化・失効から24時間を超えたrowを最大500件削除し、削除件数だけを出力します。
0件になるまで実行してください。database credentialをpublic schedulerやbrowserへ設定してはいけません。

## Deployment動作

Vercel projectはGitHubへ接続済みです。pull requestにはproduction databaseへaccessできないPreview
deploymentが作られます。`main`へのmergeではprotected database variableを持つProduction deploymentが
作られ得ますが、agent deliveryは引き続き`404 DELIVERY_DISABLED`を返します。

migration 0005とmigration 5件すべてのchecksumは検証済みです。relationship切断・再接続はdeploy済み
ですが、認証済み利用には既存の招待accountとrelationshipが引き続き必要です。schema適用とroute
deployによってdevice enrollmentや物理deliveryは有効になっていません。

次のすべてが完了するまでresponse-signing keyを設定せず、どちらのdelivery gateも有効にしません。

1. device enrollmentとrevocationを実装する
2. Windows agentがresponse keyをpinし、signed responseを検証する
3. standard-user CNG動作について実Windows証拠を得る
4. Stage 0で実際のtray式optical drive証拠を得る
5. 独立security reviewで構成が受理される
6. rollback・incident手順を含む意図的なenablement changeを行う

## Rotationとrecovery

- Supabaseでdatabase passwordをrotateし、Productionの`DATABASE_URL` sensitive valueを置き換え、
  redeploy・verifyしてから以前のcredentialを無効化します。Previewへcopyしてはいけません。
- SupabaseがCAをrotateする場合は、公式provider channelで新しいcertificateを検証し、pinしたfingerprintと
  Production CAを同時に更新し、full test suiteを実行してreview済みchangeとしてdeployします。
- database accessが疑わしい場合はdeliveryを無効のままにし、credentialをrotateし、影響するsession・
  deviceをrevokeし、限定されたsecurity evidenceだけを保持します。
- checked-inのforward-only migrationからschemaを復元します。provider backupはrecovery materialであり、
  schema source of truthの代わりではありません。
- provider project administratorはdatabase passwordをresetできます。project作成時の一時passwordは
  repositoryやrunbookに保存しません。

## Provisioning・migration証拠

2026-07-21にrepository verifierでpin済みdirect-TLS接続と初期の空schemaを確認しました。
2026-07-22には、認証済みSupabase Management APIを通じてadvisory lock付きの1 transactionで
migration 0003を適用しました。その後、独立したread-only Management API queryにより、migration
3件のchecksum完全一致、PostgreSQL major version、無効なdatabase gate、未設定のphysical ceiling、
application row合計0件、新しいdevice metadata column・index、旧owner constraintの除去を確認しました。

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "tls": "CA_AND_HOSTNAME_VERIFIED",
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "application_rows": 0
}
```

これはcloud schemaとconnectivityの証拠です。物理trayが開いた証拠ではなく、Stage 0を完了させません。

2026-07-24にmigration 0004を、認証済みSupabase Management APIを通じて、同じadvisory lockを持つ
1 transactionで適用しました。その後の独立read-only queryにより、repository migration 4件の
checksum完全一致、PostgreSQL 17、delivery無効、physical ceiling未設定、person 1件、relationship・
invitation 0件、digestだけを保存するinvitation列、pending codeを1件に限定するunique index、
accepter identityを保存する列がないことを確認しました。

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql",
    "0004_invite_only_relationships.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "people": 1,
  "relationships": 0,
  "relationship_invitations": 0
}
```

同じ2026-07-24の後半に、PR #21はreview済みone-time Vercel Production build bridgeを使い、
新deploymentがactiveになる前にmigration 0005を適用しました。bridgeはprocess memory内でSupabase
pooler portだけを変更し、credentialを出力せず、cleanup対象invitation 0件を確認しました。その後、
pin済みTLS、PostgreSQL 17、migration 5件すべてのchecksum、delivery無効、physical ceiling未設定、
application row合計1件を独立検証しました。

```json
{
  "database": "postgres",
  "postgres_major": 17,
  "tls": "CA_AND_HOSTNAME_VERIFIED",
  "migrations": [
    "0001_initial_control_plane.sql",
    "0002_agent_transport_security.sql",
    "0003_device_enrollment_and_revocation.sql",
    "0004_invite_only_relationships.sql",
    "0005_relationship_lifecycle.sql"
  ],
  "delivery_enabled": false,
  "physical_hourly_ceiling": null,
  "application_rows": 1,
  "deleted_invitations": 0
}
```

続いてProduction deployment `dpl_B4GqXfk457m1qWeRkb5bzYMDFWEo`がrelationship-disconnection routeを
含んで`Ready`へ到達しました。外部確認では`/`がHTTP 200、agent pollingが
`404 DELIVERY_DISABLED`、agent enrollmentが`404 ENROLLMENT_DISABLED`、未認証disconnection requestが
`401 AUTHENTICATION_REQUIRED`を返しました。PR #22はone-time bridgeを削除しました。その後、
merge commit `739392a`の通常Production deployment `dpl_91cuRwKTJp2bLa3kT9MVtJ4PG8Nb`が、
build command全体を`next build`へ戻した状態で`Ready`に到達しました。bridgeを汎用migration runnerとして
残していません。

現在のProduction deploymentからも、agent pollingで`{"error":"DELIVERY_DISABLED"}`、agent enrollmentで
`{"error":"ENROLLMENT_DISABLED"}`という限定されたsemantic bodyを確認しました。この操作では、
response-signing key、person、device、enrollment secret、command、result、private eventを作成していません。

最初のprotected Vercel deployment (`dpl_G6pHisFuPVmausakV6PXxzrGtZYi`)は2026-07-21に`Ready`へ
到達しました。Next.js Functionは`hnd1`へ配置され、認証付きdeployment checkで`/`からHTTP 200、
`POST /api/agent/v1/poll`からsemantic body `{"error":"DELIVERY_DISABLED"}`を持つHTTP 404を確認しました。
