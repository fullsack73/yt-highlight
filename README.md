# yt-highlight
 
유튜브 영상에서 하이라이트 클립을 추출

# 개발 환경에서 실행 하는법

## 프론트엔드

1. node.js 설치
2. 폴더를 생성 후 IDE로 열기
3. 터미널에서 git clone https://github.com/fullsack73/yt-highlight .
4. 터미널에서 `npm install`
5. 터미널에서 `npm run dev`

## 백엔드 (Audio Highlight Detection)

1. Python 3.8+ 설치
2. 필요한 패키지 설치:
   ```
   pip install -r requirements.txt
   ```
3. 백엔드 서버 실행:
   ```
   python src/audio.py
   ```
   서버는 기본적으로 http://localhost:5000 에서 실행됩니다.

## Audio Highlight Detection 사용법

1. 프론트엔드와 백엔드 서버를 모두 실행합니다.
2. YouTube 동영상 URL을 입력하여 비디오를 로드합니다.
3. "Audio Highlight Detection" 섹션에서 오디오 파일을 업로드합니다.
4. 시스템이 오디오를 분석하여 하이라이트 지점을 자동으로 감지합니다.
5. 감지된 하이라이트를 클릭하여 비디오 플레이어에서 해당 지점으로 이동할 수 있습니다.

# TODO

- [x] Audio Highlight Detection 백엔드 구현
- [ ] 자연어 처리 기술 스택 조사
- [ ] UI 디자인 수정
- [ ] 타임스탬프 proximity 알고리즘 수정
- [ ] Extension 완성 및 통합
- [ ] 한글화