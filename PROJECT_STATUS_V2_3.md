# 서울바당 운영노트 V2.3 — 실서버 배포 상태 및 기술 정리

- **배포 URL**: `https://seoulbadang.onrender.com`
- **GitHub 기준 커밋**: `a9877fdeb7f808e990589347cec85d6b3c7a5ed3` (`main` 브랜치)
- **운영 환경**: Render Web Service (`Node.js`, `plan: free`) + Render PostgreSQL 18 (`plan: free`, 1GB 제한, 2026-12-27 만료)
- **기존 데이터**: 뚝섬점 `2026-11-20` `order` 1건(`돌멍게`) 그대로 보존, `schedule_rules` 0건

---

## 1. DB 변경사항 (`server.js`)

기존 `records` 테이블은 변경 없이 유지하며, 아래 테이블만 추가되었습니다.

```sql
CREATE TABLE IF NOT EXISTS schedule_rules (
  name TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
```

### 추가 API (모두 `adminOnly` — 직원 계정 403 차단)
- `GET /api/schedule-rules` — 기본 근무 설정 목록 조회
- `PUT /api/schedule-rules` — 기본 근무 설정 등록/수정 (`ON CONFLICT(name) DO UPDATE`)
- `DELETE /api/schedule-rules` — 기본 근무 설정 삭제 (기존 `records` 일정은 유지)
- `POST /api/schedule-generate` — 선택 월 근무표 자동 생성 (`LOCK TABLE records IN SHARE ROW EXCLUSIVE MODE`, 기존 `schedule`/`shift` 보존, 중복 방지, 뚝섬점 일요일 매장 휴무 적용)

---

## 2. 실서버 테스트 결과 (`a9877fd` — 10/10 PASS)

1. 관리자 기본 근무 등록·수정·삭제: **PASS**
2. 선택 월 근무표 자동 생성 (preview 및 실제 생성): **PASS**
3. 기존 개별 근무 및 휴무 일정 덮어쓰기 방지 유지: **PASS**
4. 같은 월 반복 생성 시 중복 등록 방지(0건): **PASS**
5. 뚝섬점 일요일 매장 휴무 자동 적용: **PASS**
6. 직원 계정 기본 근무 설정 UI 숨김 및 API 403 차단: **PASS**
7. 기존 5개 탭 및 `돌멍게` 1건 데이터 정상 유지: **PASS**
8. 브라우저 탭·상단 헤더 `서울바당 운영노트 V2.3` 표기: **PASS**
9. 입력 중 새로고침·미저장 이탈 경고 및 취소 시 유지: **PASS**
10. 기본 근무 설정 저장 후 전체 새로고침 시 DB 로드 유지: **PASS**

---

## 3. 참고 및 후속 작업 후보

- **레이아웃 참고**: 현재 관리자 "기본 근무 설정" 패널이 근무 현황 카드(`#items`) 상단에 들어가 있어, 추후 별도 섹션으로 분리하면 UI가 더 깔끔해집니다.
- **미구현 후속 작업**: 개인 인증 및 휴무 신청, 근무표 이미지 내보내기, 대체인원 전용 관리, 백업 복원 UI, Render 무료 DB 만료(`2026-12-27`) 전 이전.
