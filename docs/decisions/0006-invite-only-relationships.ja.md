# ADR 0006: 招待制relationship確立

[English](0006-invite-only-relationships.md)

- **Status:** Accepted
- **Date:** 2026-07-24

## コンテキスト

Stage 1では、受信者が方向付きEJECT accessを許可する前に、既存EJECT account 2件が非公開の
relationshipを確立する必要があります。公開account検索、address book upload、email discovery、
自動的な相互permissionは、プロダクトに不要なsurveillanceとsocial network surfaceを追加します。

relationshipは物理操作への同意ではありません。確立手段はこの分離を維持し、deliveryやdevice
capabilityを有効にせず、どちらかが相手をejectできると暗示してはいけません。

## 決定

1. sign-in済みの既存accountは、短期・1回限りのrelationship codeを1件作成できます。serviceはcodeを
   送信せず、本人がすでに管理するchannelで意図的に共有します。
2. 暗号学的にrandomな32 byteからcodeを生成し、paddingなしbase64url 43文字で表示します。表示は1回だけ、
   10分で失効します。
3. SHA-256 digest、inviter識別子、限定されたtimestamp、使用・無効化stateだけを保存します。新しいcodeを
   作ると、そのinviterの以前の未使用codeを無効化します。
4. 現在認証済みでactiveな別のEJECT accountだけがcodeを消費できます。自己使用、未知、malformed、失効、
   無効化済み、使用済み、制限済み、その他利用不可のcodeは、同じ限定されたunavailable resultを返します。
5. code受理で作成するのは、非公開で相互の`relationship` row 1件だけです。`eject_grant`の作成、audience
   scopeの拡張、delivery有効化、device enrollment、account検索公開、discoverability付与は行いません。
   EJECT accessは各受信者が別途許可します。
6. 作成・受理は短いPostgreSQL `SERIALIZABLE` transactionとbounded retryで実行します。受理時はinvitationと
   両account rowを決定論的順序でlockし、codeを消費できるaccepterを正確に1件にします。
7. pairがすでにactive relationshipを持つ場合は、grantを変更せずcodeをidempotentに消費します。このpathで
   inactive relationshipを再有効化しません。再接続・切断にはcancellation動作を含む別のreview済みdecisionが
   必要です。
8. code、raw request body、email address、relationship内容をlog出力しません。private alpha前に
   invitation rowの保持・削除期間を定義します。

## 結果

- 既存の招待account 2件はglobal directoryや追加のidentity provider lookupなしで接続できます。
- codeを所有しても作成できるのはrelationshipだけで、物理的なagencyは得られません。
- codeはbearer capabilityであり、高entropy・短期・1回限りを維持し、URLやlogへ含めません。
- UIとdata modelの両方で、relationship確立と方向付きconsentを明確に分離します。
- EJECT account自体への招待はoperator管理のままです。この決定は既存accountだけを接続します。

## 却下した代替案

- email address、display name、public usernameによる検索
- control planeからのinvitation送信
- code消費時のaccount作成
- 相互EJECT accessの自動grant
- codeのURL埋め込みまたはplaintext保存
- 明示的なdisconnect・cancellation設計なしでのinactive relationship再有効化
