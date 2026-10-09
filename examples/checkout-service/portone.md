# PortOne을 사용하는 새몰과 SDK 연결

Saemol SDK는 새몰 호스티드 결제 세션을 만든다. 새몰 서버가 PortOne 결제창·서버 승인 조회·환불을 처리하므로 판매자 앱에서 별도 PG 결제창을 만들 필요가 없다.

```text
판매자 서버: SDK createCheckout(itemCode, externalUserId, idempotencyKey)
  → 구매자: 새몰 결제 페이지 → PortOne TEST 결제창
  → 새몰 서버: 결제 ID·상점·채널·금액·KRW 확인 → 주문·권한
  → 판매자 서버: 새몰 서명 checkout.completed → 구매 적용
```

## 설정

- 새몰 관리자: PortOne V2 상점 ID, 일반결제 TEST 채널, 빌링키 TEST 채널, API Secret, PortOne 웹훅 서명 키를 준비한다. 파트너 정산 테스트는 별도 계약·모의 계좌가 필요하다.
- 판매자: 상품 수정 화면에서 호스티드 결제 아이템을 등록하고 새몰 **테스트 연동 키**·**새몰 웹훅 서명 키**·수신 주소를 설정한다.
- 구매자: 새몰 결제 링크에서 테스트 결제를 진행한다. 판매자 앱이 보낸 가격 대신 등록된 `itemCode`의 서버 가격을 사용한다.

SDK의 테스트 연동 키는 `test_`로 시작하며 생성 세션·권한을 테스트 자료로 구분한다. 이 키는 PortOne의 TEST 채널을 선택하는 설정이 아니다. 새몰 서버에서도 `PORTONE_PAYMENT_MODE=test` 및 테스트 채널을 별도로 설정해야 한다. 운영 PG 설정에 테스트 키만 넣고 모의 결제라고 판단하면 안 된다.

## 판매자 예제 실행

[checkout-service 안내](README.md)의 환경 변수를 넣고 실행한다. 로컬 새몰 검증은 `SAEMOL_BASE_URL=http://localhost:3000`을 쓰고, 새몰에서 예제 서버의 `/webhooks/saemol`에 접근할 수 있는 주소를 지정한다. 새몰 로컬 격리 테스트가 아닌 환경에서는 공개 HTTPS 수신 주소를 사용한다.

```bash
npm run build
npm run test
npm run test:example
node examples/checkout-service/server.mjs
```

`POST /checkout`은 서버가 저장한 구매 시도 ID로 호출한다. `checkout.completed` 서명 검증·이벤트 중복 기록·주문별 지급을 DB 트랜잭션으로 묶고, 커밋 뒤 `acknowledgeCheckout()`을 보낸다. 복귀 URL만으로 지급하지 않는다. 웹훅 유실 시 `getCheckout()`으로 재조회한다. 환불·권한 회수 이벤트가 먼저 도착한 뒤 늦은 완료 이벤트가 도착해도 재지급하지 않는다.

## 테스트 완료 기준

SDK 단위 테스트와 로컬 셀프 테스트는 실제 PG 승인·환불·정산의 증거가 아니다. PortOne 콘솔의 TEST 채널을 연결한 뒤 실제 TEST API 응답, 결제 금액·채널 검증, 중복 콜백, 환불 후 권한 회수, 웹훅 재전송을 각각 확인한다. 운영 전환에는 실제 계약·운영 키와 별도의 운영 검증이 필요하다.
