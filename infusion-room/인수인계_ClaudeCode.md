# Claude Code 인수인계 — 수액실 앱 (맥북에서 이어서 작업)

> 이 문서는 **맥북의 Claude Code**가 컨텍스트 없이 바로 이어받도록 쓴 것이다.
> 함께 있는 `작업보고서_UI리디자인.md`(무엇을 왜 했는지)와 `배포보고서_7d7e.md`(윈도우 배포)도 참고.

---

## 0. 한 줄 요약
이비인후과(벗이비인후과) **수액실 상황판** 웹앱. 벽걸이 모니터 + 아이패드에서 베드별 수액 진행상황을 본다. 현재 **iOS 감성 리디자인**을 진행 중이며, 실제 운영은 **윈도우 서버 PC**에 배포돼 있다(맥은 개발용).

## 1. 스택 / 구조
- **프론트**: React 19 + Vite 8. `src/App.jsx`(≈3900줄, 최상위 `App()` 하나에 서브컴포넌트들), `src/App.css`(≈50KB, 앱 전체 스타일), `src/index.css`(부트스트랩+#root+테마 페이지배경), `src/main.jsx`.
- **백엔드**: Express 5 + better-sqlite3(WAL). `server/index.js`(정적 dist 서빙 + /api), `server/db.js`, `server/seed.js`, `server/schema.sql`, `server/routes/*`, `server/middleware/`, `server/lib/`.
- **저장소**: `github.com/gang912-dotcom/infusion-room`, 브랜치 **`server-migration`**.
  - ⚠️ **저장소 루트 안에 `infusion-room/` 서브폴더가 앱 루트**다(package.json 위치). clone하면 `infusion-room/infusion-room/`.

## 2. 맥북 셋업
```bash
git clone https://github.com/gang912-dotcom/infusion-room.git
cd infusion-room/infusion-room
git checkout server-migration
npm ci                     # better-sqlite3가 네이티브 → 맥용으로 새로 컴파일됨
ADMIN_INITIAL_PASSWORD=dev1234 npm run db:seed   # 개발용 DB 생성(env로 비번 전달)
npm run dev                # vite dev (5173), /api는 4000으로 프록시 (vite.config.js)
#   또는  npm start        # build + node server/index.js (4000에서 앱까지 통짜 서빙)
```
- **seed 명령은 `npm run db:seed`** (지시서 등에 나오는 `npm run seed` 아님).
- **dotenv/--env-file 안 씀** → env는 프로세스 환경변수로 넘긴다. seed엔 `ADMIN_INITIAL_PASSWORD` 필수, 런타임 `PORT` 기본 4000.
- 맥에선 Claude Code가 앱을 직접 띄우고 스크린샷 확인이 가능하니, 윈도우에서 하던 "정적 HTML 미리보기" 없이 실제 화면으로 검증하면 된다.

## 3. 작업 규칙 (중요)
- **한 번에 한 기계에서만 편집** → commit → push. 다른 기계는 pull 먼저. (맥에서 작업 중엔 윈도우 서버 코드 건드리지 말 것 — 갈라지면 머지 지옥)
- **단계별 커밋**, 커밋/UI 문구는 **한국어**. 커밋 메시지 끝에 `Co-Authored-By: Claude ...` 트레일러 유지.
- push는 이제 열려 있음(자격증명 저장됨). 단, 맥에서도 같은 GitHub 계정 로그인 필요.
- **윈도우 전용 파일 규칙**: `*.bat`(admin-setup/deploy/backup/check-server)은 cmd 코드페이지 때문에 **ASCII만**. 맥에서 이 파일들 건드릴 일 없지만 수정 시 주의.
- DB(`server/data`)·`.env`·`node_modules`·`dist`·`tools/`·`logs/`는 gitignore → 동기화 안 됨. **환자 실데이터는 윈도우 서버에만** 있다.

## 4. 디자인 시스템 (지금 상태)
- **테마**: 라이트/다크. `data-theme`를 `documentElement`에 건다(`main.jsx`가 최초값=localStorage `iv-theme` 우선, 없으면 기기설정). 헤더 ☀/☾ 토글(`App.jsx` `theme` 상태).
  - **다크가 기본**: `.app`에 다크 토큰. **라이트는 `:root[data-theme='light'] .app`에서만 오버라이드**. 페이지 배경은 `index.css`의 `--page-bg`.
- **색 원칙(iOS 신호등)**: 색은 "의미"에만, 크롬은 중성.
  - 진행중=**초록**(`--status-occupied`) / **곧 완료(남은<30분)=주황**(`--status-warning`) / 완료=**빨강**(`--status-completed`) / 배정·미도착=**보라**(`--status-reserved`) / 빈=회색.
  - 발열은 테두리 아님 → **체온 숫자 색**으로만(미열=주황/고열=빨강 톤). 카드 경고 테두리는 오직 "곧 완료(30분)".
- **토큰 위치**: `.app { ... }`(다크 기본) + `:root[data-theme='light'] .app { ... }`(라이트). 세그먼트탭 `--seg-*`, 카드그림자 `--card-shadow*`, 글래스 `--glass*`.
- **로고**: 라이트=원본 컬러(`logo-icon.png`), 다크=흰색(`logo-icon-white.png`) — `App.jsx`에서 `theme`로 분기.
- **아이콘**: `App.jsx`의 `Icon` 컴포넌트(currentColor·1em, clock/bell/alert/droplet). 카드 이모지만 교체됨.
- **모달**: 프로스티드 글래스(`--glass`, `backdrop-filter`) + 열림 팝(`@keyframes modal-in`). **닫힘 애니메이션은 아직 없음**.
- **탭 전환**: `App.jsx` effect가 `activeTab` 바뀔 때 `.tab-view`를 WAAPI로 좌/우 슬라이드(재마운트 없음). `body { overflow-x: hidden }`.

## 5. 남은 일 / 다음 후보
- **이모지→SVG 나머지**: 카드만 됨. 모달/기타(＋, ⚠ 라벨 등)는 `Icon`으로 확장 가능.
- **모달 닫힘 모션**: React가 닫을 때 즉시 언마운트 → 8개 모달 각각 "닫히는 동안 잠깐 유지" 필요. 미구현.
- **라지 타이틀 축소(스크롤)**: 미구현(벽 상황판이라 우선순위 낮음).
- **카드 특이사항 줄 수**: 사용자가 "4줄 유지"로 결정 → `getCardNoteLines` 그대로.
- (윈도우 운영 숙제, 맥과 무관) admin 임시비번 `gmlqnd78!!` 변경, 실제 계정 생성 등 — `배포보고서_7d7e.md` 5단계.

## 6. 코드 지형 (자주 만질 곳)
- 베드 카드 렌더/상태: `App.jsx` `renderBedCard`(≈2790~2890), `getBedProgress`(30분 warning 판정), `getCardNoteLines`(카드 특이사항+라운딩 줄), `Icon`.
- 특이사항(노트): `patientNotes`(차트번호별 영구, category warning/caution/info, active/deleted) + `sessionNotes`(금일 라운딩). 추가 `createPatientNote`, 삭제·복원 `togglePatientNoteDeleted`(데이터관리 → 특이사항 데이터 관리). 이미 다 동작함.
- 테마/탭: `App.jsx` `App()` 상단(`theme`, `tabViewRef`, `activeTab` effect).

## 7. 되돌리기 / 서버 반영
- 맥에서 commit→push 후, **윈도우 서버**에서 `deploy.bat`(관리자): `git pull → npm ci → npm run build → nssm restart iv-app`.
- 문제 생기면 `git log`/`git revert`. 커밋이 작게 쪼개져 있어 되돌리기 쉽다.
