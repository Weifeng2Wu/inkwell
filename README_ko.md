<div align="center">

# Inkwell

**연구 논문 작성을 위한 로컬 우선 LaTeX 워크스페이스.**

Inkwell은 논문 편집, PDF 미리보기, Agent 협업, Git 버전 관리를 하나의 데스크톱 앱에 모았습니다. 초안 작성부터 수정 검토, 컴파일, 동기화까지 논문 작성의 각 단계를 연결합니다.

논문은 로컬의 일반 파일로 보관됩니다. 기존 도구를 계속 사용하면서 모델 서비스와 Agent를 직접 선택할 수 있습니다.

[![Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Weifeng2Wu/inkwell?style=flat)](https://github.com/Weifeng2Wu/inkwell)

[다운로드](https://github.com/Weifeng2Wu/inkwell/releases/latest) · [핵심 기능](#핵심-기능) · [시작하기](#시작하기)

[English](README.md) | [简体中文](README_zh.md) | **한국어**

</div>

![Inkwell의 밝은 테마와 어두운 테마 및 Agent 인라인 수정 검토](assets/readme/theme-preview.jpg)

## 핵심 기능

### 컴파일 엔진 자동 선택으로 설정 간소화

프로젝트 소스와 설치된 컴파일러를 확인하여 적합한 LaTeX 엔진을 자동으로 선택합니다. 컴파일 환경 감지와 설치 지원으로 수동 설정을 줄입니다.

같은 워크스페이스에서 컴파일 결과와 오류를 확인하고 SyncTeX로 PDF와 소스 사이를 이동하세요. 다국어 문서는 XeLaTeX 또는 LuaLaTeX를 사용할 수 있으며, 필요한 글꼴과 패키지는 프로젝트에 따라 달라집니다.

### Git으로 논문 버전 관리와 동기화

워크스페이스에서 파일 변경과 차이를 확인하고, 스테이징과 커밋을 수행하며, push와 pull로 원격 저장소와 동기화합니다.

수정 이력을 남기고 다른 기기에서 작업을 이어 가거나 Git으로 공동 연구자와 프로젝트를 공유하세요. 비공개 저장소를 포함한 GitHub 프로젝트 게시도 지원합니다.

### 내장 Agent 사용 또는 로컬 Agent 연결

내장 **Inkwell Agent**에 OpenAI·Anthropic·Gemini 호환 API를 설정하면 논문 워크스페이스에서 바로 대화하고 수정을 요청할 수 있습니다.

**ACP(Agent Client Protocol)**를 통해 Claude Code, Codex, OpenCode, Antigravity 등의 로컬 Agent를 연결하고 해당 도구의 계정과 설정을 그대로 사용할 수도 있습니다.

연결 전에 프로젝트 접근과 데이터 사용에 대한 안내를 확인하고 연결 여부를 결정하세요.

![ACP로 로컬 Agent를 연결하기 전의 확인 대화 상자](assets/readme/acp-connection.jpg)

### 원문에서 Agent 수정 검토

Agent의 수정 제안은 인라인 diff로 표시됩니다. 원문은 빨간색, 제안은 초록색으로 표시되며 변경 사항을 개별적으로 수락·거절하거나 한꺼번에 처리할 수 있습니다.

수정 제안, 소스, PDF 미리보기를 같은 워크스페이스에 두고 표현, 수식, 레이아웃을 확인하세요.

### Agent에 학술 작성 Skills 추가

Skills로 논문 구성, 문장 다듬기, 투고 서식, 심사 답변 등의 작업에 재사용할 수 있는 지침을 Agent에 제공합니다.

폴더, ZIP, Markdown 파일 또는 GitHub 링크에서 가져오고 프로젝트에 필요한 Skills만 활성화하세요. 내장 Agent와 지원되는 ACP Agent는 프로젝트에서 활성화한 지침을 공유할 수 있습니다.

### 다양한 테마와 워크스페이스 레이아웃

여러 밝은 테마와 어두운 테마를 제공하며 글꼴, 단축키, 분할 레이아웃을 조정할 수 있습니다.

작업에 맞게 소스, PDF, Agent, 터미널을 배치하고 집중 작성과 대조 검토 사이를 전환하세요.

## 시작하기

### 1. 다운로드 및 설치

[GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest)에서 운영체제에 맞는 설치 파일을 다운로드하세요.

**macOS 첫 실행**

DMG를 열고 Inkwell을 응용 프로그램 폴더로 드래그하세요.

현재 버전은 Apple 개발자 인증서 서명과 공증이 없어 macOS에서 앱이 손상되었다는 메시지가 나타날 수 있습니다. 공식 Release에서 다운로드한 파일인지 확인한 뒤 터미널에서 실행하세요:

```sh
sudo xattr -dr com.apple.quarantine "/Applications/Inkwell.app"
open "/Applications/Inkwell.app"
```

요청 시 Mac 로그인 암호를 입력하세요. 입력하는 동안 터미널에는 문자가 표시되지 않습니다.

### 2. 논문 프로젝트 열기

기존 LaTeX 프로젝트 폴더를 여세요. Inkwell이 컴파일 환경을 감지하며, 필요한 도구가 없으면 앱의 안내에 따라 설치할 수 있습니다.

### 3. Agent 설정

다음 중 하나를 선택하세요:

- **내장 Agent:** API 주소, 모델, API 키를 입력합니다.
- **로컬 Agent:** 해당 Agent와 필요한 ACP 어댑터를 설치하고, 설정에서 선택한 뒤 연결을 확인합니다.

필요한 Skills를 가져와 현재 프로젝트에 학술 작성 지침을 활성화하세요.

### 4. 작성 시작

논문을 편집하거나 Agent에 수정을 요청하고, 제안을 검토·수락한 뒤 컴파일하여 PDF를 확인하세요. 진행 상황을 저장하거나 동기화하려면 Git으로 커밋하고 원격 저장소에 push하세요.

---

[MIT 라이선스](LICENSE) · [외부 구성 요소 고지](packages/academic-agent/THIRD_PARTY_NOTICES.md) · [Agent 로고 출처](apps/desktop/public/agent-logos/LICENSE.txt)
