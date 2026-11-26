# V2.7 데이터 이전 준비
- 전체 백업 파일명 날짜를 Asia/Seoul 기준으로 수정. exportedAt은 UTC 유지.
- 관리자 웹 복원 버튼 대신 신규 DB 전용 오프라인 복원 도구 추가. 운영 DB 덮어쓰기 방지 목적.
- `node restore-backup.js backup.json`은 구조/키 검증만 수행(DB 연결 없음).
- 신규 DB에 앱 스키마 초기화 후 앱 쓰기를 중지하고 `RESTORE_DATABASE_URL`을 신규 DB로 지정, `node restore-backup.js backup.json --apply` 실행. 기존 운영 DB에는 실행 금지. records/schedule_rules가 비어 있고 급여 설정이 기본값 또는 비어 있어야 함.
- 복원 후 3개 테이블 내용/건수, ID/version, 신규 등록 ID, PIN 및 권한을 확인한 뒤에만 서비스 연결 변경. 원본 DB와 백업은 유지. 백업에는 개인정보가 포함될 수 있으므로 비공개 보관.
- DB 스키마, 환경변수, 기존 API 변경 없음. 복원 전용 환경변수는 오프라인 실행에만 필요.
- 실제 DB 복원 및 배포 테스트는 미실행. 구조 검증은 업무 데이터의 의미적 정확성까지 보장하지 않음.
