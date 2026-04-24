export type RegionId = "cn" | "intl";

export type ApiProtocol = "anthropic" | "openai";

export interface AiProvider {
  id: string;
  name: { zh: string; en: string };
  regions: RegionId[]; // which regions are supported
  endpoints: Partial<Record<RegionId, string>>; // API base URL per region
  defaultModel: string;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "claude",
    name: { zh: "Claude", en: "Claude" },
    regions: ["intl"],
    endpoints: {
      intl: "https://api.anthropic.com/v1/messages",
    },
    defaultModel: "claude-sonnet-4-20250514",
  },
  {
    id: "glm",
    name: { zh: "智谱 GLM", en: "Zhipu GLM" },
    regions: ["cn", "intl"],
    endpoints: {
      cn: "https://open.bigmodel.cn/api/anthropic/v1/messages",
      intl: "https://api.z.ai/api/anthropic/v1/messages",
    },
    defaultModel: "glm-5",
  },
  {
    id: "minimax",
    name: { zh: "MiniMax", en: "MiniMax" },
    regions: ["cn", "intl"],
    endpoints: {
      cn: "https://api.minimaxi.com/anthropic/v1/messages",
      intl: "https://api.minimax.io/anthropic/v1/messages",
    },
    defaultModel: "MiniMax-M2.7",
  },
  {
    id: "kimi",
    name: { zh: "Kimi", en: "Kimi" },
    regions: ["cn"],
    endpoints: {
      cn: "https://api.moonshot.cn/anthropic/v1/messages",
    },
    defaultModel: "kimi-k2.5",
  },
  {
    id: "deepseek",
    name: { zh: "DeepSeek", en: "DeepSeek" },
    regions: ["cn"],
    endpoints: {
      cn: "https://api.deepseek.com/anthropic/v1/messages",
    },
    defaultModel: "deepseek-v4-flash",
  },
  {
    id: "openrouter",
    name: { zh: "OpenRouter", en: "OpenRouter" },
    regions: ["intl"],
    endpoints: {
      intl: "https://openrouter.ai/api/v1/messages",
    },
    defaultModel: "anthropic/claude-sonnet-4.6",
  },
  {
    id: "custom",
    name: { zh: "自定义", en: "Custom" },
    regions: ["intl"],
    endpoints: {},
    defaultModel: "",
  },
];

export const API_PROTOCOLS: {
  id: ApiProtocol | "";
  label: { zh: string; en: string };
  desc: { zh: string; en: string };
}[] = [
  {
    id: "",
    label: { zh: "自动", en: "Auto" },
    desc: { zh: "根据 URL 自动检测", en: "Auto-detect from URL" },
  },
  {
    id: "anthropic",
    label: { zh: "Anthropic", en: "Anthropic" },
    desc: { zh: "x-api-key 认证", en: "x-api-key auth" },
  },
  {
    id: "openai",
    label: { zh: "OpenAI", en: "OpenAI" },
    desc: { zh: "Bearer Token 认证", en: "Bearer token auth" },
  },
];

export const REGION_LABELS: Record<RegionId, { zh: string; en: string }> = {
  cn: { zh: "国内", en: "China" },
  intl: { zh: "国际", en: "International" },
};
