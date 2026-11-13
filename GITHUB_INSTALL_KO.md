# 루미모리 C.15 R4 — GitHub 설치 가이드 (루미버스 앱)

## 왜 별도 ZIP인가?
기존 `LocalImport` ZIP에는 `data/extensions/lumi_integrated_memory_proto_a/` 경로가 포함되어 있어 서버 폴더 배치용이었습니다. GitHub 설치기는 `git clone`한 저장소의 맨 위에 `spindle.json`이 있는지 확인합니다. **이 ZIP은 저장소 루트 구조로 재구성했습니다. 실행용 JS는 그대로입니다.**

## GitHub 저장소 만들기
1. GitHub 계정에서 새 공개 저장소를 만듭니다. 이름 예: `lumimory-spindle`.
2. 이 ZIP을 풀고 **ZIP 파일 자체가 아니라 안쪽 파일·`dist` 폴더**를 저장소 최상위에 올립니다.
3. GitHub에서 저장소 첫 화면에 `spindle.json`, `dist/backend.js`, `dist/frontend.js`가 보이는지 확인합니다. GitHub의 파일 업로드는 모바일에서 폴더 경로를 보존하기 어려울 수 있으므로 PC 브라우저/데스크톱 모드 또는 Git 클라이언트가 더 편리할 수 있습니다.
4. 루미버스 앱에서 `Spindle Panel` → `Add Extension` → `Install from Source`로 이동합니다.
5. `https://github.com/계정명/저장소명` 형태의 **저장소 URL**을 입력하고 설치합니다. ZIP 다운로드 주소나 `tree/main` 경로를 넣지 않습니다.
6. 권한을 확인한 뒤 활성화하고, 기존 RP가 아닌 새 시험 방에서 시작합니다.

## 사전 확인 및 문제 해결
- 기존 채팅과 저장된 기억을 백업하세요.
- 같은 `lumi_integrated_memory_proto_a` 식별자가 이미 설치되어 있으면 중복 설치 오류가 날 수 있습니다.
- 'No spindle.json found in repository'는 파일이 저장소 맨 위에 있는지 확인하세요.
- `git clone failed`라면 인터넷·GitHub 공개 여부·서버의 Git 실행 가능 여부를 확인하세요.
- 번들 보안 검사나 권한 오류는 메시지 원문을 기록해야 정확히 분석할 수 있습니다.
- **실제 Android 앱에서 설치 성공은 아직 검증되지 않았습니다.**

## 검증 범위
루미버스 1.2.5 호스트 소스의 API 계약 검사 + 기존 모의 통합 테스트 결과를 재사용합니다. 이번 GitHub 전용 변환은 `spindle.json`의 위치와 패키지 구조만 바꾸었으며 런타임 코드는 수정하지 않았습니다.
