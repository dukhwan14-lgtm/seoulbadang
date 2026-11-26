# 서울바당 운영노트 V1 — 현재 배포 상태 및 기술 정리

- **배포 URL**: `https://seoulbadang.onrender.com`
- **GitHub 기준 커밋**: `57e4151` (`main` 브랜치, `render.yaml` `free` 플랜 반영본)
- **운영 환경**: Render Web Service (`Node.js`, `plan: free`) + Render PostgreSQL 18 (`plan: free`, 1GB 제한, 2026-12-27 만료)
- **환경 변수(값 제외)**: `DATABASE_URL`, `NODE_ENV=production`, `SESSION_SECRET`(자동 생성), `STAFF_PIN`(4자리), `ADMIN_PIN`(4자리)

---

## 1. 파일 구조

```text
├── PROJECT_STATUS.md
├── README.md
├── package.json
├── render.yaml
├── server.js
└── public/
    ├── icon.svg
    ├── index.html
    └── manifest.json
```

---

## 2. 데이터베이스 구조 (PostgreSQL)

`server.js` 기동 시 아래 테이블과 인덱스를 자동 생성합니다.

```sql
CREATE TABLE IF NOT EXISTS records (
  id BIGSERIAL PRIMARY KEY,
  store TEXT NOT NULL,      -- '뚝섬점' | '혜화점'
  day DATE NOT NULL,        -- 'YYYY-MM-DD'
  tab TEXT NOT NULL,        -- 'order' | 'resv' | 'stock' | 'shift'
  data JSONB NOT NULL,      -- 탭별 입력 데이터 (photo 포함 가능)
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS records_scope ON records(store, day, tab);
```

### 탭별 `data` JSONB 필드
- `order` (발주/단가): `name`, `vendor`, `kg`, `qty`, `unit`(`마리|개|팩|봉`), `total`, `photo`(base64 jpeg/png/webp, 1.5MB 이하)
- `resv` (예약): `name`, `time`(`HH:MM`), `people`(정수 >= 1), `note`, `state`(`확정|대기|취소`)
- `stock` (마감재고): `name`, `vendor`, `qty`, `target`, `unit`(`마리|개|kg|g|팩|봉|통`), `note`, `photo`
- `shift` (근무표): `name`, `start`(`HH:MM`), `end`(`HH:MM`), `note`

---

## 3. API 목록 (`server.js`)

모든 `/api/*` 응답은 `Cache-Control: no-store`가 적용되며, `/api/login` 외 엔드포인트는 HMAC-SHA256 서명된 `session` HttpOnly 쿠키(유효기간 12시간)가 필요합니다.

| Method | Path | 권한 | 설명 |
| --- | --- | --- | --- |
| `POST` | `/api/login` | 공개 (15분당 10회 제한) | `{ pin }` 검증 후 `session` 쿠키 발급 및 `{ role: '직원' \| '관리자' }` 반환 |
| `GET` | `/api/session` | 로그인 사용자 | 현재 세션의 `{ role }` 반환 |
| `POST` | `/api/logout` | 로그인 사용자 | `session` 쿠키 삭제 |
| `GET` | `/api/records?store=&day=&tab=` | 로그인 사용자 | 해당 지점/날짜/탭 기록 조회 (`id`, `version` 포함) |
| `POST` | `/api/records?store=&day=&tab=` | 로그인 사용자 (`shift`는 관리자만) | 신규 기록 저장 |
| `PUT` | `/api/records/:id?store=&day=&tab=` | 로그인 사용자 (`shift`는 관리자만) | `version` 일치 시 수정 (`version + 1`), 불일치 시 `409` 반환 |
| `DELETE` | `/api/records/:id?store=&day=&tab=` | 로그인 사용자 (`shift`는 관리자만) | `version` 일치 시 삭제, 불일치 시 `409` 반환 |
| `GET` | `/api/backup` | 관리자만 (`403` 차단) | 전체 `records` JSON 배열 반환 |

---

## 4. 현재 구현된 기능

- **인증 및 권한**: 4자리 PIN 로그인, 잘못된 PIN 차단(401 + rate limit), 직원/관리자 역할 분리 (`shift` 등록/수정/삭제 및 `/api/backup`은 관리자만 허용)
- **지점·날짜·탭 분리**: `뚝섬점` / `혜화점`, 날짜(`YYYY-MM-DD`), 4개 탭(`발주/단가`, `예약`, `마감재고`, `근무표`)별 독립 저장 및 과거 날짜 조회
- **발주/단가**: `kg당`, `100g당`, `수량 단위당` 원가 계산 및 `×3` / `×4` 판매가 참고 계산, 거래처별 그룹핑 카톡 미리보기
- **예약**: 시간순 정렬, 취소 제외 팀 수 및 총 인원 집계, 상태(`확정|대기|취소`) 관리
- **마감재고**: 현재 재고 vs 목표 재고 비교로 부족 수량(`발주 N단위`) 자동 계산 및 빨간색 강조, 거래처별 발주 목록 정리
- **근무표**: 관리자만 등록·수정·삭제 가능, 직원은 조회 전용
- **사진 첨부**: 브라우저 `canvas`로 최대 1000px 리사이즈 + JPEG 0.65 압축 후 Base64로 DB `JSONB`에 저장
- **동기화/충돌 방지**: 15초 주기 폴링 및 `version` 기반 낙관적 잠금(동시 수정 충돌 시 409 안내)
- **카톡 공유**: 노란색 미리보기 박스 + 클립보드 복사(미지원 환경용 `execCommand` / `prompt` 폴백 포함)

---

## 5. 알려진 오류·주의사항 및 미구현 기능

1. **백업 복원 UI 미구현**: 관리자용 JSON 다운로드(`/api/backup`)만 구현되어 있고, 백업 파일을 다시 업로드해 복원하는 기능/UI는 없습니다.
2. **오프라인 저장 미지원**: PWA `manifest.json`은 있으나 Service Worker 오프라인 캐시나 로컬 큐는 없습니다.
3. **개인별 수정 이력 없음**: 공용 PIN 구조이므로 누가 언제 수정/삭제했는지 감사 로그가 남지 않습니다.
4. **15초 폴링 시 폼 재렌더링 주의**: `public/index.html`에서 15초마다 `render()`가 돌 때, 모든 입력칸이 비어 있고 포커스가 밖에 있으면 폼이 다시 그려집니다.
5. **CSS 정리 여지**: `public/index.html`의 `<style>` 안에 초안 스타일과 미사용 클래스(`.card`, `.pin-screen` 등)가 일부 혼재되어 있으나 현재 화면은 정상 렌더링됩니다.
6. **무료 플랜 운영 제약**: 웹 서비스는 15분 미사용 시 슬립(재접속 시 50초 이상 지연), 무료 Postgres DB는 2026-12-27 만료 및 1GB 용량 제한(사진 Base64 누적 시 용량 주의)이 있습니다.
