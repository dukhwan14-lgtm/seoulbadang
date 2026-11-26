# 서울바당 운영노트 V2 — 실서버 배포 상태 및 기술 명세

- **배포 URL**: `https://seoulbadang.onrender.com`
- **GitHub 기준 커밋**: `fd97eec570038e733aa7388c9a75ed0442f9b7c5` (`main` 브랜치)
- **운영 환경**: Render Web Service (`Node.js`, `plan: free`) + Render PostgreSQL 18 (`plan: free`, 1GB 제한, 2026-12-27 만료)
- **환경 변수(값 제외)**: `DATABASE_URL`, `NODE_ENV=production`, `SESSION_SECRET`, `STAFF_PIN`(4자리), `ADMIN_PIN`(4자리)
- **기존 데이터 상태**: 배포 전 백업(`seoulbadang-backup-before-v2.json`) 기준 뚝섬점 `2026-11-20` `order` 1건(`돌멍게`) 그대로 보존

---

## 1. 파일 구조

```text
├── PROJECT_STATUS.md      (V1 기준 기존 문서)
├── PROJECT_STATUS_V2.md   (V2 실서버 배포·테스트 기준 최신 정리)
├── UPDATE_V2.md           (V2 변경 요약)
├── README.md
├── package.json
├── render.yaml
├── server.js
└── public/
    ├── extra.js           (마감장부 closing, 근무표 schedule/shift 월간·주간 UI)
    ├── icon.svg
    ├── index.html
    └── manifest.json
```

---

## 2. 데이터베이스 구조 (PostgreSQL)

기존 `records` 테이블 스키마와 인덱스를 그대로 사용합니다.

```sql
CREATE TABLE IF NOT EXISTS records (
  id BIGSERIAL PRIMARY KEY,
  store TEXT NOT NULL,      -- '뚝섬점' | '혜화점'
  day DATE NOT NULL,        -- 'YYYY-MM-DD'
  tab TEXT NOT NULL,        -- 'order' | 'resv' | 'stock' | 'shift' | 'closing' | 'schedule'
  data JSONB NOT NULL,      -- 탭별 데이터
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS records_scope ON records(store, day, tab);
```

### 탭별 `data` JSONB 구조
- `order` (발주/단가): `name`, `vendor`, `kg`, `qty`, `unit`(`마리|개|팩|봉`), `total`, `photo`(base64 jpeg/png/webp, 1.5MB 이하)
- `resv` (예약): `name`, `time`(`HH:MM`), `people`(정수 >= 1), `note`, `state`(`확정|대기|취소`)
- `stock` (마감재고): `name`, `vendor`, `qty`, `target`, `unit`(`마리|개|kg|g|팩|봉|통`), `note`, `photo`
- `shift` (기존 근무표): `name`, `start`(`HH:MM`), `end`(`HH:MM`), `note`
- `closing` (마감장부): `cash`, `transfer`, `card`, `float`, `high`, `low`, `tables`, `popularQty`, `popular`, `note`, `expenses[]` (`vendor`, `method`, `amount`, `items[]` (`name`, `qty`, `unit`, `amount`)), `memos[]` (`name`, `qty`, `unit`, `amount`, `type`)
- `schedule` (신규 월간/주간 근무표): `name`, `status`(`출근|확정 휴무|희망 휴무|기본 미근무|매장 휴무`), `actual`(`뚝섬점|혜화점`), `start`(`HH:MM`), `end`(`HH:MM`), `note`

---

## 3. API 명세 (`server.js`)

모든 `/api/*` 응답은 `Cache-Control: no-store`가 적용되며, `/api/login` 외 엔드포인트는 HMAC-SHA256 서명된 `session` HttpOnly 쿠키(유효기간 12시간)가 필요합니다.

| Method | Path | 권한 | 설명 |
| --- | --- | --- | --- |
| `POST` | `/api/login` | 공개 (15분당 10회 제한) | `{ pin }` 검증 후 `session` 쿠키 발급 및 `{ role: '직원' \| '관리자' }` 반환 |
| `GET` | `/api/session` | 로그인 사용자 | 현재 세션의 `{ role }` 반환 |
| `POST` | `/api/logout` | 로그인 사용자 | `session` 쿠키 삭제 |
| `GET` | `/api/range?month=YYYY-MM&tab=` | 로그인 사용자 | `tab` (`closing` \| `schedule` \| `shift`)의 월간 전체 지점 기록 조회 |
| `GET` | `/api/records?store=&day=&tab=` | 로그인 사용자 | 해당 지점/날짜/탭 기록 조회 (`id`, `version` 포함) |
| `POST` | `/api/records?store=&day=&tab=` | 로그인 사용자 (`shift`, `schedule`은 관리자만 `403`) | 신규 기록 저장 |
| `PUT` | `/api/records/:id?store=&day=&tab=` | 로그인 사용자 (`shift`, `schedule`은 관리자만 `403`) | `version` 일치 시 수정 (`version + 1`), 불일치 시 `409` 반환 |
| `DELETE` | `/api/records/:id?store=&day=&tab=` | 로그인 사용자 (`shift`, `schedule`은 관리자만 `403`) | `version` 일치 시 삭제, 불일치 시 `409` 반환 |
| `GET` | `/api/backup` | 관리자만 (`403` 차단) | 전체 `records` JSON 배열 반환 |

---

## 4. 실서버 테스트 결과 (`fd97eec` 배포본)

- **배포 상태**: Render Web Service `Live`, PostgreSQL 18 연결 정상, 서버 로그 오류 없음
- **테스트 과정 코드 변경**: 없음 (실서버 API 51개 항목 `51 PASS / 0 FAIL` + 브라우저 UI 검증 완료 후 테스트 데이터 전부 삭제해 기존 DB 1건 상태로 원복)
- **PIN·권한 분리**: 잘못된 PIN `401` 차단, 직원 PIN 로그인 시 `shift`/`schedule` 쓰기 및 `/api/backup` `403` 차단, 백업 버튼 숨김 확인
- **기존 기능 유지**: `order`(단가·판매가 계산/카톡 미리보기/버전 충돌 409/삭제), `stock`(부족 수량 자동 계산), `resv`(시간순 정렬/취소 제외 집계) 모두 정상
- **신규 기능 확인**: `closing`(일별 저장·수정·실시간 총매출/객단가/지출/미결제 계산·월간 `/api/range` 집계), `schedule`(월간/주간 표·지점별 인원 집계·관리자 수정·새로고침 유지) 모두 정상

---

## 5. 확인된 보완점 및 미구현 기능

### 테스트 중 확인된 보완점
1. **직원 근무표 안내 문구 미표시**: 직원 계정으로 근무표 탭을 열면 `extra.js` 경로에서 편집 불가 안내 문구가 보이지 않고 표만 출력됩니다(서버 API에서는 `403`으로 안전하게 차단됨).
2. **15초 폴링 시 클릭 빗나감**: `order`/`resv`/`stock` 탭에서 15초 자동 새로고침(`render()`)과 삭제 버튼 클릭이 겹치면 DOM이 다시 그려지며 클릭이 어긋날 수 있습니다.
3. **표기/문서 불일치**: `public/index.html` 헤더가 여전히 `운영노트 V1`으로 표기되어 있으며, 기존 `PROJECT_STATUS.md`는 V1 기준입니다.
4. **`GET /api/range` 지점 필터 없음**: 월간 집계 용도로 두 지점 데이터를 함께 반환하고 있습니다(지점별 격리가 필요할 경우 쿼리 파라미터 확장 필요).

### `UPDATE_V2.md` 기준 남은 후속 작업
- 기본 근무 자동 생성
- 개인 인증 및 휴무 신청
- 근무표 이미지 내보내기
- 대체인원 전용 관리
- 동시 신규 등록 중복 방지
- 미저장 이탈 방지
- 백업 복원 UI / 오프라인 저장 미구현
- **운영 주의**: Render 무료 Web Service 15분 미사용 슬립(재접속 시 50초+ 지연) 및 무료 PostgreSQL 1GB 용량·만료일(`2026-12-27`) 전 백업·이전 필요
