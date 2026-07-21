# ADR 0005: IdentityとDevice Security

[English](0005-identity-and-device-security.md)

- **状態:** 採用
- **日付:** 2026-07-21

## 背景

EJECTには、Web control planeを使うpersonと、登録された一台の端末として動くWindows agent
という二種類のidentityが必要です。browser sessionをdevice credentialとして再利用すると、
窃取、revocation、無人動作を封じ込めにくくなります。protocol v1も、server authorizationとは
独立して、agentがcommandのintegrity、audience、expiry、uniquenessを検証することを要求します。

このdecisionは、agent向けendpointを有効にする前に、authentication、enrollment、保護保存、
message integrity、replay、revocation、result idempotency、clockの境界を確定します。物理tray
動作を主張せず、汎用remote commandを許可せず、macOSを対応targetにしません。

## 決定

### Person identity

1. Stage 1のperson identityにはmanaged Supabase Authを使います。private alphaはPKCE flowの
   email magic linkまたはemail OTPで開始します。public releaseにはproduction SMTP、account
   recovery review、MFAまたはpasskey必須化の別decisionが必要です。
2. Supabaseのasymmetric JWT signing keyを使います。server-side codeはproject JWKSから署名を
   検証し、設定済みissuer、audience、expiry、UUID subjectを必須にします。request bodyのperson
   IDをidentityとして受け入れません。
3. access・refresh materialはserver-side auth routeが所有するSecure、HttpOnly、SameSite cookie
   に保存します。browserの状態変更requestはPOSTだけとし、`Origin`を確認し、現在のdatabase
   stateからapplication authorizationも実行します。有効なJWTはidentityの証拠であり、eject
   permissionではありません。
4. Supabase secretやservice-role keyをbrowser codeへ公開しません。domain・application moduleは
   Supabase SDKではなくidentity portへ依存します。emailとprovider identityはSupabaseが保存し、
   EJECT tableはsubject UUIDだけを使います。後で明示的にproduct needを承認しない限りemailを
   複製しません。
5. 状態変更requestはJWT検証後にEJECT account statusを確認します。そのため短寿命access tokenが
   暗号学的には有効でもaccount restrictionを反映できます。global sign-outとprovider session
   revocationもincident controlとして維持します。

### Device enrollmentとcredential

6. person sessionは一人のownerに対して暗号学的randomな32-byte enrollment secretを作れます。
   secretは一度だけ表示し、HTTPS bodyだけで送り、10分で失効し、一度だけ消費します。
   PostgreSQLにはSHA-256 digest、owner、expiry、限定されたused stateだけを保存し、URLやlogへ
   含めません。
7. enrollment時にWindows agentはWindows CNG内で端末ごとのECDSA P-256 keyを生成します。
   利用可能ならMicrosoft Platform Crypto Providerを優先し、それ以外はMicrosoft Software Key
   Storage Providerを使います。keyは現在のWindows userにscopeし、永続かつnon-exportableに
   します。どちらのprotected providerも使えなければenrollmentを失敗させ、plaintextや
   exportable keyへのfallbackは行いません。
8. agentが送るのはenrollment secret、新しいdevice UUID、新しいkey UUID、DER
   SubjectPublicKeyInfo形式のP-256 public key、閉じたsetup metadataだけです。serverはsecret消費と
   owner・deviceへのpublic key bindをatomicに行います。再install、profile消失、key消失時は
   revokeして再enrollmentし、private keyをbackup・同期しません。
9. person sessionとdevice keyを交換可能にしません。person sessionはenrollmentを作成・取消し、
   pollとresultの全requestは登録device keyの所持を証明します。

### 認証済みrequest構成

10. agent endpointはquery parameterなしのHTTPS POSTだけを使います。各requestにはendpointごとの
    最大body sizeを設け、次のheaderを持たせます。

    ```text
    Eject-Device-Id: UUID
    Eject-Key-Id: UUID
    Eject-Timestamp: 10進Unix time milliseconds
    Eject-Nonce: paddingなしbase64url、random 16 bytes
    Eject-Content-SHA256: paddingなしbase64url、正確なbody bytesのSHA-256
    Eject-Signature: paddingなしbase64url、64-byte IEEE P1363 signature
    ```

11. deviceは次の改行区切りstringのUTF-8 bytesへ署名し、末尾改行は付けません。methodは大文字、
    pathは登録済みの正確なpath、body hashは受信した正確なUTF-8 JSON bytesを対象にします。

    ```text
    EJECT-DEVICE-REQUEST-V1
    <key UUID>
    <device UUID>
    <timestamp milliseconds>
    <nonce>
    <HTTP method>
    <path>
    <body SHA-256>
    ```

12. ECDSA P-256とSHA-256、固定64-byte IEEE P1363 `r || s`表現でsign・verifyします。crypto処理前に
    不正encodingを拒否し、identifierを完全一致で比較し、protocol v1ではalgorithm negotiationを
    許可しません。
13. control-plane timeから30秒を超えるtimestampをserverは拒否します。操作前に
    `SHA-256(device_id || nonce)`を端末ごとのunique constraintの下でatomicにinsertし、replay recordを
    10分保存します。同じnonceはsignatureが異なっても拒否します。
14. key lookup、active device・key確認、replay消費、command dispatchまたはresult ingestion、該当する
    lifecycle writeは可能な範囲で一つのdatabase transactionにします。authentication failureは限定
    machine codeを返し、別personのdeviceが存在するかを明かしません。

### Server response integrity

15. TLSでtransport confidentialityとendpoint authenticationを提供します。さらにcontrol planeは
    独立したECDSA P-256 server keyで、認証済みagentへの全responseへ署名します。server private
    signing keyはenvironmentごとに分離し、protected server secret storageだけに置き、PostgreSQLや
    repositoryへ保存しません。
16. responseはkey IDと64-byte P1363 signatureを持ちます。署名対象のUTF-8 stringに末尾改行は
    ありません。

    ```text
    EJECT-SERVER-RESPONSE-V1
    <request nonce>
    <HTTP status in decimal>
    <base64url SHA-256 of exact response body bytes>
    ```

    agentはJSON parse前にraw bodyへのsignatureを検証します。bodyはsigned server timeとprotocol v1
    `COMMAND`一件またはcommandなしを持つ閉じたtransport wrapperです。protocol message自体は変更せず、
    transport wrapperの後でvalidateします。

17. signed responseのkey ringは署名済みagent distributionへpinします。rotationではcurrent・next public
    keyを含むoverlap releaseを先に配布し、その後serverがnext keyで署名を開始します。responseから
    command type、drive path、script、executable、その他local capabilityを追加できません。

### Polling、revocation、result、time

18. agentがoutbound HTTPS pollingを開始し、inbound portを開きません。再pollで有効な同じcommandを
    受け取る場合がありますが、二回目の物理試行を防ぐ正本はagentのdurableなcommand-ID消費です。
19. pollごとにactive device、key、owner、global delivery、command stateを確認します。deviceまたはkeyの
    revokeはagent updateなしに後続pollを直ちに拒否し、未配信outstanding commandをcancelします。
    offline network上ですでにdelivery済みのcommandは回収できません。protocolの最大残存時間とlocal
    pauseが限定controlになります。
20. revoked credentialはresultを送信できません。認証済みresultはcommandのdeviceと一致し、
    `(device_id, command_id)`へuniqueにbindします。同一retryは保存済みresultを返し、異なるsemanticsは
    conflictとして、新しいlifecycle transitionや物理試行を作りません。
21. issuance、expiry、cooldown、replay windowではcontrol-plane timeを正本にします。signed polling
    responseごとにserver timeを含めます。agentは後続request timestamp用の限定offsetを導出し、monotonic
    elapsed timeでcommand残存時間を短縮するだけに使い、延長しません。OS clockを変更しません。古いが
    正しく署名済みのrequestへは、keyとsignatureを検証した後だけsigned clock-skew responseを返せます。
22. enrollment secret、cookie、JWT、private key、signature、nonce、raw request・response body、完全なIP
    historyをlogに残しません。public key、限定reason code、key ID、revocation time、短寿命のhashed nonceが
    この設計で必要なauthentication dataの上限です。

## 結果

- 盗まれたbrowser sessionは無人device credentialにならず、盗まれたdevice keyはperson sessionに
  なりません。
- device侵害はrevocationまたはkey replacementまで、一台の登録deviceと一つの閉じたphysical commandに
  限定されます。
- 最初のpolling実装にはenrollment digest、public key、replay digest、result idempotency、server signing
  key IDのdatabase recordが必要ですが、private device・server key columnは不要です。
- Windows enrollmentは実際のCNG動作に依存し、target hardware上でstandard userとして検証が必要です。
  macOS protected storageは未決定で実験扱いのままです。
- application-level response signatureにはrotationとrelease coordinationが増えますが、TLS termination後の
  intermediaryとは独立して正確なcommand responseをagentが検証できます。
- このADRはprivate-alpha向けconstructionであり、独立security reviewではありません。public利用前には
  threat review、production SMTP、binary signing、update verification、retention limit、incident exerciseが
  必要です。

## 却下した代替案

- Supabase person access・refresh tokenをdesktop credentialとして再利用する。
- 全deviceで共有するbearer tokenやpolling URL内のdevice secret。
- configuration fileだけで保護するexportable private keyや、CNG不可時のsilent plaintext fallback。
- 最初のprivate alphaでのmutual TLS。certificate発行とproxy制約を増やしてもapplication replayとcommand
  validation要件はなくならない。
- authenticated person session経由という理由だけでunsigned command JSONを受理する。
- WebSocket、inbound listener、generic webhook、任意command payload、command protocol内のremote update命令。

## 参照

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Microsoft CNG key storage providers](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers)
- [DSASignatureFormat](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dsasignatureformat)
