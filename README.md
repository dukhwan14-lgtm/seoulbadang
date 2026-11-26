# 서울바당 운영노트 배포
1. 압축 해제 후 전체 파일을 비공개 GitHub 저장소에 업로드합니다.
2. Render에서 New > Blueprint를 선택하고 저장소를 연결합니다.
3. STAFF_PIN, ADMIN_PIN에 서로 다른 4자리 숫자를 설정합니다. SESSION_SECRET과 DATABASE_URL은 Blueprint에서 연결합니다.
4. 유료 서비스 및 DB 비용을 확인하고 배포합니다. 플랜 이름은 Render에서 변경될 수 있습니다.
5. 생성된 HTTPS 주소에서 두 PIN으로 각각 로그인하고 두 휴대폰에서 같은 매장/날짜를 조회합니다.
6. iPhone Safari 공유 > 홈 화면에 추가. Android Chrome 메뉴 > 홈 화면에 추가. 오프라인 저장은 지원하지 않습니다.

로컬 실행: Node 22, PostgreSQL 준비 후 DATABASE_URL, STAFF_PIN, ADMIN_PIN, SESSION_SECRET(32자 이상)을 환경변수로 설정하고 npm install, npm start 실행. http://localhost:3000 접속.

DB 테이블은 시작 시 자동 생성됩니다. 직원은 근무표 조회만 가능하고 관리자는 수정 가능합니다. 다른 탭은 양쪽 모두 편집 가능합니다. 동시 수정 충돌은 버전으로 감지합니다. 화면 전환 시 최신 기록을 조회하며 입력하지 않는 상태에서는 15초마다 조회합니다. 사진은 압축하여 DB에 저장합니다. 관리자 JSON 백업 다운로드 가능, 복원 UI는 미구현입니다. PIN은 공용이므로 개인별 변경 이력은 제공하지 않습니다. 실제 배포 전 PIN 변경, 개인정보 접근 범위, DB 백업 정책을 확인하세요. 실제 PostgreSQL 연동 및 모바일 브라우저 테스트는 별도로 필요합니다.
