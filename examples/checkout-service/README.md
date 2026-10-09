# 결제 연결 예제

Node 서버에서 결제 링크 생성 → 구매 적용 → 환불 회수 → 고객 관리 주소까지 연결하는 예제입니다. Node 24 이상과 상품에 등록한 아이템 코드, 테스트 연동 키, 웹훅 서명 키가 필요합니다. 키는 서버의 환경 변수에만 넣습니다.

저장소 루트에서 `npm install`, `npm run build`, `npm run test:example`을 실행하세요. 테스트 키를 설정한 뒤 `node scripts/doctor.mjs`를 실행하면 비밀값 없이 설정 존재와 새몰 접속을 확인합니다.

| 환경 변수 | 입력값 |
|---|---|
| SAEMOL_TEST_SECRET | 상품 설정의 테스트 연동 키 |
| SAEMOL_WEBHOOK_SECRET | 상품 설정의 웹훅 서명 키 |
| SAEMOL_ITEM_CODE | 저장한 판매 아이템 코드 |
| DEMO_USER_ID | 테스트할 내 앱 계정 ID |
| DEMO_APP_TOKEN | 이 예제 서버에 접속할 임의의 긴 테스트 토큰 |
| PURCHASE_DB_PATH | 쓰기 가능한 SQLite 파일 경로, 기본 ./purchases.sqlite |
| SAEMOL_BASE_URL | 기본 https://saemol.com, 격리 검증 시 로컬 새몰 주소 |

`node examples/checkout-service/server.mjs`로 실행합니다. `/health`는 상태 확인, `POST /checkout`은 결제 링크 생성, `POST /webhooks/saemol`은 구매 적용, `GET /customer-portal`은 본인 로그인 관리 주소입니다. 결제/포털 요청에 `Authorization: Bearer <DEMO_APP_TOKEN>`을 넣으세요. 결제 본문은 `{"itemCode":"등록한 코드","purchaseAttemptId":"한 번 생성해 저장한 구매 시도 ID"}`입니다. 응답을 못 받았다면 같은 본문과 시도 ID를 사용하세요.

로컬 서버는 127.0.0.1에서 실행됩니다. 새몰이 웹훅을 보낼 수 있는 공개 HTTPS 서버에 연결하고, 상품 설정의 웹훅 주소를 `/webhooks/saemol`로 지정하세요. 테스트 구매는 테스트 결제 링크에서 합니다. 유료 운영에는 실제 판매 자격·결제 운영 조건이 갖춰져야 합니다.

실제 앱에서는 `createHandlers()`의 `resolveUserId(req)`를 내 앱의 서버 세션 검증으로 교체합니다. 브라우저가 전달한 사용자 ID·가격을 믿지 않습니다. `allowedItemCodes`는 서버에서 판매할 코드만 등록합니다. `store.forUser()`를 호출할 때도 서버에서 확인한 계정 ID를 쓰세요.

Next.js App Router에서는 서버 모듈에서 `PurchaseStore`와 `createHandlers()`를 한 번 만들고 `nextRoutes()`가 반환한 `checkoutPOST`, `webhookPOST`, `portalGET`을 해당 `route.ts`의 POST/GET으로 내보냅니다. Node 런타임과 영구 저장 경로가 필요합니다. Express는 `mountExpressRoutes(app, express, handlers)`를 `express.json()`보다 먼저 호출하면 원문 서명을 보존합니다. 두 방식은 같은 검증·DB 적용 로직을 사용합니다.

이벤트 고유 기록과 지급은 같은 트랜잭션입니다. 주문 ID도 고유하여 다른 이벤트 ID로 재전송돼도 중복 지급하지 않습니다. 환불이 먼저 도착하면 회수 기록을 남겨 늦게 도착한 완료 이벤트가 다시 활성화하지 않습니다. 적용 확인은 커밋 뒤 보고하고, 응답 유실 시 다시 보고합니다. 새몰 조회가 회수된 권한을 반환하면 지급하지 않습니다.

SQLite는 실행 가능한 단일 서버 예제용 저장소입니다. 서버리스·다중 서버에서는 공유 DB의 트랜잭션과 고유 제약으로 옮기고, 작업 큐·권한 재조회·내 서비스의 실제 기능/크레딧 원장과 연결하세요. `/checkout`의 시도 ID는 내 앱에서 주문 의도를 생성할 때 저장해야 하며 클라이언트가 매번 새 값을 만들게 해서는 안 됩니다. 소비·구독 갱신·분쟁 정책은 각 서비스의 원장 규칙으로 구현해야 합니다.
