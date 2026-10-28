# Apple Game Solver (사과게임 자동 풀기)

[Apple Game Plus](https://apple.oshizi.com/) 자동 풀이 도구. Playwright로 브라우저를 열고, 합이 10인 직사각형을 찾아 자동으로 제거합니다.

## 설치

```bash
npm install
npx playwright install chromium
```

## 사용법

### 솔로 모드

```bash
node solver.js
```

자동으로 혼자하기 모드로 진입하여 게임을 시작하고 풀이합니다.

### 방(Room) 참여

```bash
node solver.js <방코드> <닉네임>
```

예시:
```bash
node solver.js NEB4BR 나의닉네임
node solver.js ABC123 "스페이스 닉네임"
node solver.js XYZ789              # 닉네임 생략 시 랜덤 닉네임 사용
```

방 코드와 닉네임을 입력하면 자동으로 방에 접속하고 Ready 상태가 됩니다. 호스트가 게임을 시작하면 자동 풀이를 시작합니다.

## 동작 방식

### 솔로 모드
1. **보드 읽기**: React fiber tree를 통해 캔버스 컴포넌트의 `board` prop (170자 문자열, 17×10 격자)을 읽습니다.
2. **움직임 탐색**: 2D prefix sum을 사용해 모든 유효한 직사각형 (합=10, 빈 셀 없음)을 O(ROWS²×COLS²)에 탐색합니다.
3. **탐욕적 선택**: 가장 많은 사과를 제거하는 직사각형부터 실행합니다.
4. **실행**: React의 `onMove` 콜백을 직접 호출하여 게임에 움직임을 전달합니다.

### 방 모드
1. **접속**: Playwright로 메인 페이지 → 방 코드 입력 → 참여 → 닉네임 → Ready
2. **WebSocket 인터셉트**: 페이지 로드 전에 `WebSocket` 생성자를 패치하여 Socket.IO 연결을 캡쳐합니다.
3. **게임 대기**: `game:started` WebSocket 메시지를 감지하면 풀이 시작
4. **움직임 전송**: `game:action` 메시지를 WebSocket으로 직접 전송합니다.
5. **보드 갱신**: 서버 응답에 포함된 새 보드 문자열을 다음 수 계산에 사용합니다.

## 설정

`solver.js` 상단의 상수를 조정할 수 있습니다:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MOVE_DELAY_MS` | 80 | 움직임 사이 대기 시간 (ms) |
| `COLS` | 17 | 격자 열 수 |
| `ROWS` | 10 | 격자 행 수 |
| `TARGET_SUM` | 10 | 직사각형 합 목표값 |
