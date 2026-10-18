<div align="center">

# Inkwell

**연구는 당신의 것. Agent는 협력자. 최종 결정도 당신의 것.**

논문 작성, 수정 검토, 버전 관리를 연결하는 로컬 우선 AI 네이티브 LaTeX 데스크톱 워크스페이스.

[![Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Weifeng2Wu/inkwell?style=flat)](https://github.com/Weifeng2Wu/inkwell)

[English](README.md) | [简体中文](README_zh.md) | **한국어**

[다운로드](https://github.com/Weifeng2Wu/inkwell/releases/latest) · [주요 기능](#논문-중심의-워크스페이스) · [시작하기](#시작하기) · [데스크톱 빌드](#데스크톱-빌드) · [문서](#문서)

</div>

![Inkwell의 밝은 테마와 어두운 테마 및 Agent 인라인 수정 검토](assets/readme/theme-preview.jpg)

<p align="center"><sub>밝은 테마와 어두운 테마, Agent 수정 사항의 인라인 검토.</sub></p>

---

## 왜 Inkwell인가요?

하나의 데스크톱 워크스페이스에서 LaTeX 작성, Agent 수정 검토, PDF 미리보기, Git 버전 관리를 수행합니다. 수정을 요청하고, 원문에서 변경 사항을 확인하고, 필요한 부분을 수락한 뒤 컴파일하고 커밋하세요.

논문은 일반 폴더에 보관되므로 기존 도구로도 계속 작업할 수 있습니다.

> **개발 진행 중.** 설치 파일은 [GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest), 플랫폼별 빌드 상태는 [Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)에서 확인하세요.

## 논문 중심의 워크스페이스

| 작업 | 기능 |
| --- | --- |
| 작성 | Monaco 편집기, LaTeX 구문 강조, 참고문헌 자동 완성, 파일 탭, 분할 레이아웃 |
| 검토 | 같은 위치의 빨간색 원문과 초록색 제안, 변경별 수락·거절 |
| 컴파일 | 컴파일러 감지, 메인 파일 선택, TeX 설치 지원, 빌드 출력, 보조 파일 정리 |
| 읽기 | 내장 PDF 미리보기와 동기화 데이터가 있을 때의 SyncTeX 소스/PDF 이동 |
| 협업 | Git 상태, 이력, 스테이징, 커밋, push/pull, GitHub 저장소 게시 |
| 맞춤 설정 | 내장·외부 Agent, 재사용 가능한 Skills, 터미널, 글꼴, 단축키, 다양한 밝은·어두운 테마 |
| 발표 | 편집 가능한 학술 포스터와 PPTX, SVG, PDF, PNG, JPEG 내보내기 |

## 검토할 수 있는 AI 수정

Agent의 원고 수정은 원본 파일을 조용히 덮어쓰는 대신 검토용 작업 사본에서 이루어집니다.

```text
사용자: “주장은 바꾸지 말고 이 문단을 더 간결하게 다듬어 줘.”
Agent: 검토용 사본에 변경 사항을 제안합니다.
사용자: 같은 편집기에서 빨간색 원문과 바로 아래 초록색 제안을 확인합니다.
        변경별로 수락하거나 거절한 뒤 논문을 컴파일합니다.
```

- 별도의 좌우 비교 페이지가 아니라 원문과 제안을 같은 위치에서 확인합니다.
- 전체 재작성을 한꺼번에 승인하지 않고 변경 단위로 결정합니다.
- 파일 탭을 전환했다 돌아와도 미결정 제안을 계속 검토할 수 있습니다.
- 내장·외부 Agent에 공통 사전 프롬프트로 검토 절차와 응답 선호를 전달합니다.

이 기능은 원고 검토 절차이며 **운영체제 수준의 샌드박스가 아닙니다**. 외부 도구는 부여받은 권한을 유지하므로 신뢰할 수 있는 도구를 사용하고 권한 요청을 확인하세요.

## 원하는 Agent 선택

**Inkwell Agent**에 OpenAI·Anthropic·Gemini 호환 API를 설정하거나 ACP(Agent Client Protocol)로 외부 Agent를 연결할 수 있습니다.

카탈로그에는 **Pi, OpenCode, Claude Code, Codex, Antigravity, Qoder CLI, Grok Build, DeepSeek Harness, Kimi Code, ZCode**가 포함됩니다. 기본 선택에는 내장 Agent와 설치가 감지된 Agent가 표시되며, 설치와 어댑터 설정은 별도로 관리합니다.

지원되는 백엔드 간에 응답 선호와 프로젝트에서 활성화한 Skills를 재사용합니다. 내장 Agent의 엔드포인트, 모델, API 키는 설정에서 관리하고, 외부 Agent는 자체 CLI나 지원되는 어댑터 절차로 인증합니다. 연결에 실패해도 다른 Agent로 자동 전환하지 않습니다.

어댑터마다 인증, 권한, 도구 지원이 다릅니다. 카탈로그 등록이 모든 상위 버전의 종단 간 검증 완료를 뜻하지는 않습니다. 앱의 외부 Agent 설정을 확인하세요.

## 학술 작업을 위한 Skills

하나의 라이브러리에서 탐색, 설치, 프로젝트 활성화를 관리합니다.

- 하나의 가져오기 메뉴에서 **폴더, ZIP, Markdown Skill 파일, GitHub URL**을 지원합니다.
- 설치된 Skills만 필터링하고 현재 프로젝트에 필요한 항목만 활성화합니다.
- 카드에서 GitHub 원본 링크와 축약된 Star 수를 확인합니다.
- 지원되는 GitHub 항목은 라이브러리 새로고침 시 확인 주기에 따라 상위 리비전을 검사합니다. 설치된 스냅샷을 갱신할 수 있지만 네트워크와 검사 결과에 좌우되며, 카탈로그 전체를 자동 설치하지는 않습니다.
- 투고 요건과 지원되는 저자 도구 모음 파일을 재사용 가능한 서식 지침으로 정리합니다.

다음 모음을 선택할 수 있으며 **기본적으로 설치되지 않습니다**.

| 모음 | 주요 내용 | 출처 |
| --- | --- | --- |
| Research Paper Writing | 연구 논문 작성 지침 | [Master-cai/Research-Paper-Writing-Skills](https://github.com/Master-cai/Research-Paper-Writing-Skills) |
| Nature Academic Writing Suite | 작성, 윤문, 연구계획, 인용, 데이터 공개 문구, 통계 보고, 모의 심사, 심사 답변, 참고문헌 검증 | [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) |

Skills는 지침을 제공할 뿐 없는 도구를 만들어 내지는 않습니다. 검색, 인용 검증, 문서 처리에는 해당 기능이 필요합니다. 텍스트 리소스 통합은 상위 Skill 스크립트를 실행하지 않으며, 학술지 스타일 지침은 공식 정책이나 게재 보장이 아닙니다.

## LaTeX, PDF, Git을 한곳에서

컴파일러 감지와 설치 지원으로 수동 설정을 줄이고, 지원 엔진으로 컴파일하고 오류를 확인하며, SyncTeX로 소스와 PDF 사이를 이동하세요. Unicode/CJK 문서는 엔진, 글꼴, 패키지에 따라 달라지며 일반적으로 XeLaTeX 또는 LuaLaTeX에서 시작하는 것이 적절합니다.

Git은 열린 워크스페이스 단위로 작동하므로 논문 폴더마다 별도 저장소와 이력을 가질 수 있습니다. 로컬 상태, diff, 커밋에는 GitHub 로그인이 필요하지 않습니다. 원격 작업에는 해당 인증 정보가 필요하며, GitHub 게시에는 GitHub CLI 인증을 사용하고 비공개 저장소도 지원합니다. 내장 터미널에서 일반 CLI 작업도 수행할 수 있습니다.

## 편집 가능한 학술 포스터

파일 트리의 컨텍스트 메뉴에서 새 학술 포스터를 만드세요. 텍스트를 편집하고 요소를 이동하거나 크기를 조절하며, 세 가지 스타일과 가로·세로 레이아웃을 선택할 수 있습니다. 편집 가능한 PPTX·SVG 또는 공유용 PDF·PNG·JPEG로 내보내세요. Academic Poster Skill을 설치하면 Agent가 논문을 바탕으로 포스터를 만들 수도 있습니다.

## 로컬 우선

원고는 워크스페이스에, 대화는 로컬 JSONL 파일에 저장됩니다. 설정과 인덱스는 SQLite로 이전 중입니다. Inkwell 클라우드 계정이나 호스팅 백엔드가 필요하지 않습니다.

API 키는 프로젝트 설정과 분리된 로컬 앱 데이터베이스(`academic-agent/inkwell.sqlite`)에 **암호화 없이** 저장됩니다. macOS/Linux에서는 현재 사용자만 데이터베이스 파일에 접근할 수 있습니다. 이전 시스템 자격 증명 저장소 버전을 사용했다면 키를 한 번 다시 입력하세요.

AI 요청은 선택한 제공자나 Agent에 문맥을 전송합니다. Git 원격 작업, 업데이트, 다운로드에도 네트워크를 사용합니다.

## 시작하기

### 데스크톱 앱

[GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest)에서 플랫폼에 맞는 설치 파일을 다운로드하세요.

**macOS 첫 실행 전:** DMG를 열고 Inkwell을 응용 프로그램 폴더로 드래그하세요. 현재 빌드는 Apple 개발자 인증서 서명과 공증이 없어 macOS에서 앱이 손상되었다는 메시지가 나타날 수 있습니다. 위 공식 Release에서 다운로드한 파일인지 확인한 뒤 터미널에서 실행하세요:

```sh
sudo xattr -dr com.apple.quarantine "/Applications/Inkwell.app"
open "/Applications/Inkwell.app"
```

요청 시 Mac 로그인 암호를 입력하세요. 입력하는 동안 터미널에는 문자가 표시되지 않습니다.

1. 논문 프로젝트 폴더를 열고 LaTeX 컴파일러를 설정합니다.
2. Inkwell Agent를 설정하거나 설치된 외부 Agent를 연결합니다.
3. 필요하면 Skills를 설치하고 프로젝트에 활성화합니다.
4. 수정을 요청하고, 제안을 검토하고, 컴파일한 뒤 커밋합니다.

### 소스에서 실행

필수 도구: **Node.js 24.x, pnpm 11.5.0, Rust stable, Git**, 그리고 플랫폼별 [Tauri 의존성](https://v2.tauri.app/start/prerequisites/). 논문 컴파일에는 TeX 배포판이 필요합니다. 외부 Agent 설치에는 npm, uv 또는 제공자 설치 프로그램이 필요할 수 있습니다.

```sh
git clone https://github.com/Weifeng2Wu/inkwell.git
cd inkwell
pnpm install
pnpm agent:setup  # 현재 운영체제와 아키텍처용 내장 SDK 준비
pnpm tauri:dev
```

pnpm이 없으면 `npm install -g pnpm@11.5.0`을 사용하세요. Agent 준비는 고정 리비전의 런타임을 다운로드하고 빌드하며 네트워크가 필요하지만 모델 생성 요청은 보내지 않습니다. Windows 앱은 WSL이 아닌 Windows Node.js로 준비하세요.

프런트엔드만 실행: `pnpm --filter @inkwell/desktop dev`. 네이티브 파일 시스템, 컴파일, Git, Agent 기능에는 Tauri 앱이 필요합니다.

## 데스크톱 빌드

| 대상 | 설치 파일 | 참고 |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | WebView2 필요; 구성된 설치 프로그램에서 부트스트래퍼 다운로드 가능 |
| macOS Apple Silicon / Intel | `.dmg` | 구성된 최소 버전: macOS 13.5 |
| Linux x64 | `.deb`, `.AppImage` | CI는 Ubuntu 22.04 사용; 배포판별 검증 필요 |

대상 플랫폼에서 `pnpm tauri:build`를 실행하거나 **Actions → Desktop build → Run workflow**를 선택하세요. 패키징은 Agent SDK와 Node sidecar를 준비합니다. **개발자 인증서 서명과 공증은 구성하지 않았습니다.** 테스트 설치 파일에 보안 경고가 나타날 수 있으며, 플랫폼별 설치·실행 검증이 필요합니다. [빌드 워크플로](.github/workflows/desktop-build.yml)를 참고하세요.

## 개발

| 명령 | 용도 |
| --- | --- |
| `pnpm tauri:dev` | 핫 리로드 데스크톱 개발 |
| `pnpm build` | 프런트엔드/워크스페이스 프로덕션 빌드 |
| `pnpm tauri:build` | 런타임 준비 및 네이티브 설치 파일 생성 |
| `pnpm --filter @inkwell/desktop typecheck` | 프런트엔드 TypeScript 검사 |
| `pnpm --filter @inkwell/desktop test` | 프런트엔드 테스트 |
| `pnpm agent:test` | Agent 테스트 |
| `node --test scripts/test/*.test.mjs` | 패키징 도우미 테스트 |
| `cd apps/desktop/src-tauri && cargo check` | Rust 백엔드 검사 |
| `pnpm exec biome check .` | 린트와 형식 검사 |

기술 스택은 **Tauri v2 + Rust**, **Next.js 정적 내보내기 + React**, **Monaco**입니다. 기능 모듈은 `apps/desktop/src/features`, 네이티브 명령은 `apps/desktop/src-tauri/src/commands`에 있습니다. 데스크톱 구조에는 Next.js 서버 컴포넌트나 호스팅 백엔드가 없습니다.

## 문서

- [데스크톱 빌드 워크플로](.github/workflows/desktop-build.yml)
- [프런트엔드 기능 모듈](apps/desktop/src/features)
- [네이티브 명령](apps/desktop/src-tauri/src/commands)
- [Agent 런타임](packages/academic-agent)

## 라이선스와 감사의 말

Inkwell은 [MIT 라이선스](LICENSE)를 사용합니다. 외부 런타임, Skills, 에셋에는 각자의 라이선스가 적용됩니다. [외부 구성 요소 고지](packages/academic-agent/THIRD_PARTY_NOTICES.md)와 [Agent 로고 출처](apps/desktop/public/agent-logos/LICENSE.txt)를 확인하세요.
