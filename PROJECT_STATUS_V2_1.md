# 서울바당 운영노트 V2.1 — 실서버 배포 상태 및 수정 포인트

- **배포 URL**: `https://seoulbadang.onrender.com`
- **GitHub 기준 커밋**: `055dd4a0475ab6ac5427ee0ac8c0778128a37906` (`main` 브랜치)
- **운영 환경**: Render Web Service (`Node.js`, `plan: free`) + Render PostgreSQL 18 (`plan: free`, 1GB 제한, 2026-12-27 만료)
- **기존 데이터**: 뚝섬점 `2026-11-20` `order` 1건(`돌멍게`) 그대로 보존

---

## 1. V2.1 반영 및 실서버 테스트 결과 (`055dd4a`)

- **정상 동작 확인(PASS)**:
  - 상단·탭·로그인 화면 `V2.1` 표기
  - 기존 5개 탭(`발주/단가`, `예약`, `마감재고`, `근무표`, `마감장부`) 정상 작동
  - 미저장 상태 탭·날짜·매장 변경 시 이탈 경고(`confirm`) 및 취소 시 입력 내용 유지
  - 수동 `새로고침` 및 `입력 취소` 버튼 정상 작동
  - 저장(`busy`/Enter 연타 차단) 및 작성 중 삭제 차단 정상 작동
  - 직원 PIN 로그인 시 근무표 조회 전용 안내 문구 표시 및 쓰기 `403` 차단 유지
  - 관리자 PIN 로그인 시 근무표(`schedule`) 저장·수정 정상 작동

---

## 2. 확인된 수정 필요 사항 (V2.2 대상)

1. **근무표 보기 옵션 전환 시 불필요한 이탈 경고**:
   - 입력한 내용이 없는데도 `전체/매장별/개인별`이나 `월간/주간` select를 바꾸면 `"저장하지 않은 내용이 사라집니다. 이동할까요?"` 경고가 뜸
   - 원인: `public/index.html`의 `$('form').addEventListener('input', () => dirty = true)`가 보기 옵션 select 변경에도 `dirty = true`를 설정하고, `public/extra.js`의 `change` 핸들러가 `canLeave()`로 막기 때문
   - 조치: 보기 옵션 select 변경은 `dirty` 처리에서 제외 필요

2. **근무표(`schedule`) UI 삭제 버튼 없음**:
   - 현재 관리자 계정으로 근무표 등록·수정은 가능하나 화면에 삭제 버튼이 없음 (`DELETE /api/records/:id?store=&day=&tab=schedule` API는 정상 작동)
   - 조치: 관리자 화면에서 등록된 근무 일정을 삭제할 수 있는 버튼 추가 필요
