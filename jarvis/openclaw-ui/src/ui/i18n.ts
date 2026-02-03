export type Language = "ko" | "en";

export const DEFAULT_LANGUAGE: Language = "ko";

const STRINGS = {
  brandTitle: { ko: "몰툭 자비스", en: "Moltook Jarvis" },
  brandSubtitle: { ko: "에이전트 컨트롤 센터", en: "Agent Control Center" },
  health: { ko: "상태", en: "Health" },
  statusOk: { ko: "정상", en: "OK" },
  statusOffline: { ko: "오프라인", en: "Offline" },
  gatewayDisconnected: { ko: "게이트웨이에 연결되지 않았어요.", en: "Disconnected from gateway." },
  expandSidebar: { ko: "사이드바 펼치기", en: "Expand sidebar" },
  collapseSidebar: { ko: "사이드바 접기", en: "Collapse sidebar" },
  resources: { ko: "리소스", en: "Resources" },
  docs: { ko: "문서", en: "Docs" },
  docsTitle: { ko: "문서 (새 탭)", en: "Docs (opens in new tab)" },
  language: { ko: "언어", en: "Language" },
  languagePromptTitle: { ko: "언어를 선택해줘", en: "Choose your language" },
  languagePromptBody: {
    ko: "처음 한 번만 고르면 돼. 설정에서 언제든 바꿀 수 있어.",
    en: "Pick once to start. You can change it anytime in settings.",
  },
  languageKo: { ko: "한국어", en: "Korean" },
  languageEn: { ko: "영어", en: "English" },
  navGroupChat: { ko: "대화", en: "Chat" },
  navGroupControl: { ko: "관리", en: "Control" },
  navGroupAgent: { ko: "에이전트", en: "Agent" },
  navGroupSettings: { ko: "설정", en: "Settings" },
  tabChat: { ko: "대화", en: "Chat" },
  tabOverview: { ko: "요약", en: "Overview" },
  tabChannels: { ko: "채널", en: "Channels" },
  tabInstances: { ko: "접속 현황", en: "Instances" },
  tabSessions: { ko: "세션", en: "Sessions" },
  tabCron: { ko: "크론", en: "Cron Jobs" },
  tabAgents: { ko: "에이전트", en: "Agents" },
  tabSkills: { ko: "스킬", en: "Skills" },
  tabNodes: { ko: "노드", en: "Nodes" },
  tabConfig: { ko: "설정 파일", en: "Config" },
  tabDebug: { ko: "디버그", en: "Debug" },
  tabLogs: { ko: "로그", en: "Logs" },
  subtitleAgents: {
    ko: "에이전트 작업 공간, 도구, 정체성을 관리해.",
    en: "Manage agent workspaces, tools, and identities.",
  },
  subtitleOverview: {
    ko: "게이트웨이 상태와 핵심 지표를 빠르게 확인해.",
    en: "Gateway status, entry points, and a fast health read.",
  },
  subtitleChannels: { ko: "채널과 연결 상태를 관리해.", en: "Manage channels and settings." },
  subtitleInstances: {
    ko: "연결된 클라이언트와 노드의 존재 신호를 확인해.",
    en: "Presence beacons from connected clients and nodes.",
  },
  subtitleSessions: {
    ko: "활성 세션을 확인하고 기본값을 조정해.",
    en: "Inspect active sessions and adjust per-session defaults.",
  },
  subtitleCron: {
    ko: "에이전트 작업 예약과 주기 실행을 관리해.",
    en: "Schedule wakeups and recurring agent runs.",
  },
  subtitleSkills: {
    ko: "사용 가능한 스킬과 API 키 주입을 관리해.",
    en: "Manage skill availability and API key injection.",
  },
  subtitleNodes: {
    ko: "연결된 장치와 권한 범위를 확인해.",
    en: "Paired devices, capabilities, and command exposure.",
  },
  subtitleChat: {
    ko: "게이트웨이와 직접 대화해서 빠르게 조치해.",
    en: "Direct gateway chat session for quick interventions.",
  },
  subtitleConfig: {
    ko: "설정 파일을 안전하게 수정해.",
    en: "Edit ~/.openclaw/openclaw.json safely.",
  },
  subtitleDebug: {
    ko: "스냅샷, 이벤트, 수동 RPC를 확인해.",
    en: "Gateway snapshots, events, and manual RPC calls.",
  },
  subtitleLogs: { ko: "게이트웨이 로그를 실시간으로 확인해.", en: "Live tail of the gateway file logs." },
  theme: { ko: "테마", en: "Theme" },
  themeSystem: { ko: "시스템", en: "System theme" },
  themeLight: { ko: "라이트", en: "Light theme" },
  themeDark: { ko: "다크", en: "Dark theme" },
  refreshChat: { ko: "대화 새로고침", en: "Refresh chat data" },
  toggleThinking: {
    ko: "생각/작업 출력 토글",
    en: "Toggle assistant thinking/working output",
  },
  toggleFocus: { ko: "집중 모드 토글", en: "Toggle focus mode" },
  disabledDuringOnboarding: {
    ko: "온보딩 중에는 비활성화됨",
    en: "Disabled during onboarding",
  },
  sessionLabel: { ko: "세션", en: "Session" },
} as const;

export type I18nKey = keyof typeof STRINGS;

export function normalizeLanguage(value?: string | null): Language {
  return value === "en" ? "en" : "ko";
}

export function t(key: I18nKey, lang: Language): string {
  const entry = STRINGS[key];
  return entry?.[lang] ?? entry.ko;
}

export function languageLabel(lang: Language): string {
  return lang === "en" ? STRINGS.languageEn.en : STRINGS.languageKo.ko;
}
