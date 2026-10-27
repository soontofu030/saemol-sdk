# 0.5.0 (2026-10-27)

- KG이니시스 기준 판매 정책 조회와 외부 서비스 승인 주소를 추가했습니다.
- 판매 종료 뒤 기존 구매 권리와 환불 의무를 안내합니다.
- 실제 PG 계약·송금 동작은 SDK 발행과 별도로 검증합니다.

# Changelog

## Unreleased

- `checkout.completed`의 `CheckoutCompletedData` 타입을 보완합니다.
- PortOne 테스트 연결 안내를 추가합니다.
- 공개 저장소와 npm 파일 목록을 검사하고 환경 파일·개인 키·내부 보고서의 제외 규칙을 강화합니다.

## 0.4.0 · 2026-10-04

- 권한 응답 형식과 만료를 확인하고 손상된 응답을 거부합니다.
- 구매·사용량의 `idempotencyKey`를 지원하며 키 없는 쓰기는 자동 재시도하지 않습니다.
- `canAccess`, `customerPortal`, `acknowledgeCheckout`을 제공합니다.
- 응답의 `X-Request-Id`를 `SaemolApiError.requestId`와 `onResponse`로 확인합니다.
- OAuth 콜백에서 저장된 `expectedState`를 필수로 확인합니다. 기존 콜백은 서버 세션의 state를 전달하도록 수정해야 합니다.
- 웹훅 서명·이벤트 ID를 확인하고, 영구 이벤트 기록·환불 순서·커밋 이후 적용 확인 예제를 제공합니다.
- 추가 유료 서비스 없이 설정 생성 미리보기·환경 진단·로컬 셀프 테스트 CLI를 제공합니다.

PG 테스트 결제·실제 승인·환불·정산 완료를 의미하지 않습니다. 계약과 공급자 설정 후 해당 흐름을 검증해야 합니다.
