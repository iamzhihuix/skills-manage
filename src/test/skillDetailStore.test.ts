import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillDetail } from "../types";

const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
}));

// Mock Tauri core before importing the store
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import { invoke } from "@tauri-apps/api/core";
import { useSkillDetailStore } from "../stores/skillDetailStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockDetail: SkillDetail = {
  id: "frontend-design",
  row_id: "frontend-design",
  name: "frontend-design",
  description: "Build distinctive, production-grade frontend interfaces",
  file_path: "~/.agents/skills/frontend-design/SKILL.md",
  dir_path: "~/.agents/skills/frontend-design",
  canonical_path: "~/.agents/skills/frontend-design",
  is_central: true,
  source: "native",
  scanned_at: "2026-04-09T00:00:00Z",
  source_kind: null,
  source_root: null,
  is_read_only: false,
  conflict_group: null,
  conflict_count: 0,
  installations: [
    {
      skill_id: "frontend-design",
      agent_id: "claude-code",
      installed_path: "~/.claude/skills/frontend-design",
      link_type: "symlink",
      symlink_target: "~/.agents/skills/frontend-design",
      installed_at: "2026-04-09T12:00:00Z",
    },
  ],
};

const mockContent = "---\nname: frontend-design\n---\n\n# Frontend Design\n\nContent here.";

const mockDetailAfterInstall: SkillDetail = {
  ...mockDetail,
  installations: [
    ...mockDetail.installations,
    {
      skill_id: "frontend-design",
      agent_id: "cursor",
      installed_path: "~/.cursor/skills/frontend-design",
      link_type: "symlink",
      symlink_target: "~/.agents/skills/frontend-design",
      installed_at: "2026-04-09T12:05:00Z",
    },
  ],
};

const mockDetailAfterUninstall: SkillDetail = {
  ...mockDetail,
  installations: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("skillDetailStore", () => {
  beforeEach(() => {
    useSkillDetailStore.setState({
      detail: null,
      content: null,
      isLoading: false,
      installingAgentId: null,
      error: null,
      explanation: null,
      isExplanationLoading: false,
      isExplanationStreaming: false,
      explanationError: null,
      explanationErrorInfo: null,
    });
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useSkillDetailStore.getState();
    expect(state.detail).toBeNull();
    expect(state.content).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.installingAgentId).toBeNull();
    expect(state.error).toBeNull();
  });

  // ── loadDetail ────────────────────────────────────────────────────────────

  it("calls get_skill_detail with skillId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDetail).mockResolvedValueOnce(mockContent);
    await useSkillDetailStore.getState().loadDetail({ skillId: "frontend-design" });
    expect(invoke).toHaveBeenCalledWith("get_skill_detail", {
      skillId: "frontend-design",
    });
  });

  it("passes agentId and rowId when loading a source-aware Claude row", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDetail).mockResolvedValueOnce(mockContent);
    await useSkillDetailStore.getState().loadDetail({
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::marketplace::frontend-design",
    });
    expect(invoke).toHaveBeenCalledWith("get_skill_detail", {
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::marketplace::frontend-design",
    });
  });

  it("calls read_skill_content with skillId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDetail).mockResolvedValueOnce(mockContent);
    await useSkillDetailStore.getState().loadDetail({ skillId: "frontend-design" });
    expect(invoke).toHaveBeenCalledWith("read_skill_content", {
      skillId: "frontend-design",
    });
  });

  it("stores detail and content after successful load", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDetail).mockResolvedValueOnce(mockContent);
    await useSkillDetailStore.getState().loadDetail({ skillId: "frontend-design" });
    const state = useSkillDetailStore.getState();
    expect(state.detail).toEqual(mockDetail);
    expect(state.content).toBe(mockContent);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets loading to true while fetching", async () => {
    let resolveDetail!: (v: SkillDetail) => void;
    vi.mocked(invoke)
      .mockReturnValueOnce(new Promise<SkillDetail>((r) => (resolveDetail = r)))
      .mockResolvedValueOnce(mockContent);

    const fetchPromise = useSkillDetailStore.getState().loadDetail({ skillId: "frontend-design" });
    expect(useSkillDetailStore.getState().isLoading).toBe(true);

    resolveDetail(mockDetail);
    await fetchPromise;

    expect(useSkillDetailStore.getState().isLoading).toBe(false);
  });

  it("sets error and clears loading when load fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Skill not found"));
    await useSkillDetailStore.getState().loadDetail({ skillId: "nonexistent" });
    const state = useSkillDetailStore.getState();
    expect(state.error).toContain("Skill not found");
    expect(state.isLoading).toBe(false);
  });

  // ── installSkill ──────────────────────────────────────────────────────────

  it("calls install_skill_to_agent with skillId, agentId and method=symlink", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined) // install_skill_to_agent
      .mockResolvedValueOnce(mockDetailAfterInstall); // get_skill_detail refresh
    await useSkillDetailStore.getState().installSkill("frontend-design", "cursor");
    expect(invoke).toHaveBeenCalledWith("install_skill_to_agent", {
      skillId: "frontend-design",
      agentId: "cursor",
      method: "symlink",
    });
  });

  it("reloads detail after install", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockDetailAfterInstall);
    await useSkillDetailStore.getState().installSkill("frontend-design", "cursor");
    const state = useSkillDetailStore.getState();
    expect(state.detail?.installations).toHaveLength(2);
    expect(state.installingAgentId).toBeNull();
  });

  it("sets installingAgentId during install", async () => {
    let resolveInstall!: (v: undefined) => void;
    vi.mocked(invoke)
      .mockReturnValueOnce(new Promise<undefined>((r) => (resolveInstall = r)))
      .mockResolvedValueOnce(mockDetailAfterInstall);

    const installPromise = useSkillDetailStore
      .getState()
      .installSkill("frontend-design", "cursor");
    expect(useSkillDetailStore.getState().installingAgentId).toBe("cursor");

    resolveInstall(undefined);
    await installPromise;

    expect(useSkillDetailStore.getState().installingAgentId).toBeNull();
  });

  it("sets error when install fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Permission denied"));
    await useSkillDetailStore.getState().installSkill("frontend-design", "cursor");
    const state = useSkillDetailStore.getState();
    expect(state.error).toContain("Permission denied");
    expect(state.installingAgentId).toBeNull();
  });

  // ── uninstallSkill ────────────────────────────────────────────────────────

  it("calls uninstall_skill_from_agent with skillId and agentId", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockDetailAfterUninstall);
    await useSkillDetailStore.getState().uninstallSkill("frontend-design", "claude-code");
    expect(invoke).toHaveBeenCalledWith("uninstall_skill_from_agent", {
      skillId: "frontend-design",
      agentId: "claude-code",
    });
  });

  it("reloads detail after uninstall", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockDetailAfterUninstall);
    await useSkillDetailStore.getState().uninstallSkill("frontend-design", "claude-code");
    const state = useSkillDetailStore.getState();
    expect(state.detail?.installations).toHaveLength(0);
    expect(state.installingAgentId).toBeNull();
  });

  it("sets error when uninstall fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Not installed"));
    await useSkillDetailStore.getState().uninstallSkill("frontend-design", "claude-code");
    const state = useSkillDetailStore.getState();
    expect(state.error).toContain("Not installed");
    expect(state.installingAgentId).toBeNull();
  });

  it("refreshInstallations updates only the detail installation state", async () => {
    useSkillDetailStore.setState({
      detail: mockDetail,
      content: mockContent,
      isLoading: false,
      installingAgentId: null,
      error: null,
      explanation: null,
      isExplanationLoading: false,
      isExplanationStreaming: false,
      explanationError: null,
      explanationErrorInfo: null,
    });

    vi.mocked(invoke).mockResolvedValueOnce(mockDetailAfterInstall);

    await useSkillDetailStore.getState().refreshInstallations("frontend-design");

    const state = useSkillDetailStore.getState();
    expect(invoke).toHaveBeenCalledWith("get_skill_detail", {
      skillId: "frontend-design",
    });
    expect(state.detail?.installations).toHaveLength(2);
    expect(state.content).toBe(mockContent);
    expect(state.isLoading).toBe(false);
  });

  it("refreshInstallations reuses the active Claude row identity after a row-aware load", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockDetail)
      .mockResolvedValueOnce(mockContent)
      .mockResolvedValueOnce(mockDetailAfterInstall);

    await useSkillDetailStore.getState().loadDetail({
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::user::frontend-design",
    });
    await useSkillDetailStore.getState().refreshInstallations("frontend-design");

    expect(invoke).toHaveBeenLastCalledWith("get_skill_detail", {
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::user::frontend-design",
    });
  });

  it("reloads install mutations against the active Claude row identity", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockDetail)
      .mockResolvedValueOnce(mockContent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockDetailAfterInstall);

    await useSkillDetailStore.getState().loadDetail({
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::user::frontend-design",
    });
    await useSkillDetailStore.getState().installSkill("frontend-design", "cursor");

    expect(invoke).toHaveBeenLastCalledWith("get_skill_detail", {
      skillId: "frontend-design",
      agentId: "claude-code",
      rowId: "claude-code::user::frontend-design",
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it("resets store to initial state", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDetail).mockResolvedValueOnce(mockContent);
    await useSkillDetailStore.getState().loadDetail({ skillId: "frontend-design" });
    // Now reset
    useSkillDetailStore.getState().reset();
    const state = useSkillDetailStore.getState();
    expect(state.detail).toBeNull();
    expect(state.content).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // ── explanation streaming ────────────────────────────────────────────────

  it("appends streamed explanation chunks from backend text payloads", async () => {
    let chunkHandler!: (event: { payload: { skill_id: string; text: string } }) => void;
    let completeHandler!: (event: { payload: { skill_id: string; explanation?: string } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:chunk") {
        chunkHandler = handler as typeof chunkHandler;
      }
      if (eventName === "skill:explanation:complete") {
        completeHandler = handler as typeof completeHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    chunkHandler({ payload: { skill_id: "frontend-design", text: "第一段" } });
    chunkHandler({ payload: { skill_id: "frontend-design", text: "第二段" } });
    completeHandler({ payload: { skill_id: "frontend-design" } });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("第一段第二段");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(false);
    expect(state.explanationError).toBeNull();
  });

  it("accepts legacy chunk payloads that use chunk field", async () => {
    let chunkHandler!: (event: { payload: { skill_id: string; chunk: string } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:chunk") {
        chunkHandler = handler as typeof chunkHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    chunkHandler({ payload: { skill_id: "frontend-design", chunk: "兼容字段" } });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("兼容字段");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(true);
  });

  it("uses explanation from complete payload when provided", async () => {
    let completeHandler!: (event: { payload: { skill_id: string; explanation?: string } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:complete") {
        completeHandler = handler as typeof completeHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    completeHandler({
      payload: { skill_id: "frontend-design", explanation: "最终解释" },
    });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("最终解释");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(false);
  });

  it("surfaces explanation error events and stops streaming state", async () => {
    let errorHandler!: (event: { payload: { skill_id: string; error?: string } }) => void;
    const unlistenChunk = vi.fn();
    const unlistenComplete = vi.fn();
    const unlistenError = vi.fn();

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:error") {
        errorHandler = handler as typeof errorHandler;
        return unlistenError;
      }
      if (eventName === "skill:explanation:chunk") {
        return unlistenChunk;
      }
      if (eventName === "skill:explanation:complete") {
        return unlistenComplete;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    errorHandler({
      payload: { skill_id: "frontend-design", error: "API 返回错误 401" },
    });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBeNull();
    expect(state.explanationError).toBe("API 返回错误 401");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(false);
    expect(unlistenChunk).toHaveBeenCalledTimes(1);
    expect(unlistenComplete).toHaveBeenCalledTimes(1);
    expect(unlistenError).toHaveBeenCalledTimes(1);
  });

  it("receives structured error_info from explanation error events", async () => {
    let errorHandler!: (event: { payload: { skill_id: string; error?: string; error_info?: { message: string; details: string; kind: string; retryable: boolean; fallbackTried: boolean } } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:error") {
        errorHandler = handler as typeof errorHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    errorHandler({
      payload: {
        skill_id: "frontend-design",
        error: "代理连接失败",
        error_info: {
          message: "代理连接失败",
          details: "error sending request → tunnel error: unsuccessful",
          kind: "proxy",
          retryable: true,
          fallbackTried: true,
        },
      },
    });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBeNull();
    expect(state.explanationError).toBe("代理连接失败");
    expect(state.explanationErrorInfo).not.toBeNull();
    expect(state.explanationErrorInfo?.kind).toBe("proxy");
    expect(state.explanationErrorInfo?.retryable).toBe(true);
    expect(state.explanationErrorInfo?.fallbackTried).toBe(true);
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(false);
  });

  it("clears explanationErrorInfo on reset", async () => {
    let errorHandler!: (event: { payload: { skill_id: string; error?: string; error_info?: { message: string; details: string; kind: string; retryable: boolean; fallbackTried: boolean } } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:error") {
        errorHandler = handler as typeof errorHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    errorHandler({
      payload: {
        skill_id: "frontend-design",
        error: "timeout",
        error_info: {
          message: "请求超时",
          details: "timeout error",
          kind: "timeout",
          retryable: true,
          fallbackTried: false,
        },
      },
    });

    expect(useSkillDetailStore.getState().explanationErrorInfo).not.toBeNull();
    useSkillDetailStore.getState().reset();
    expect(useSkillDetailStore.getState().explanationErrorInfo).toBeNull();
  });

  it("keeps skill context and allows retry after a failed explanation request", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    let state = useSkillDetailStore.getState();
    expect(state.explanation).toBeNull();
    expect(state.explanationError).toContain("temporary failure");
    expect(state.isExplanationLoading).toBe(false);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    expect(invoke).toHaveBeenNthCalledWith(1, "explain_skill_stream", {
      skillId: "frontend-design",
      content: mockContent,
      lang: "zh",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "explain_skill_stream", {
      skillId: "frontend-design",
      content: mockContent,
      lang: "zh",
    });

    state = useSkillDetailStore.getState();
    expect(state.explanationError).toBeNull();
    expect(state.isExplanationLoading).toBe(true);
    expect(state.isExplanationStreaming).toBe(false);
  });

  it("enters loading state immediately for cached explanation lookup and ignores stale responses", async () => {
    let resolveFirst!: (value: string | null) => void;
    let resolveSecond!: (value: string | null) => void;

    vi.mocked(invoke)
      .mockReturnValueOnce(new Promise<string | null>((r) => (resolveFirst = r)))
      .mockReturnValueOnce(new Promise<string | null>((r) => (resolveSecond = r)));

    const firstRequest = useSkillDetailStore
      .getState()
      .loadCachedExplanation("frontend-design", "zh");

    expect(useSkillDetailStore.getState().isExplanationLoading).toBe(true);
    expect(useSkillDetailStore.getState().explanation).toBeNull();

    const secondRequest = useSkillDetailStore
      .getState()
      .loadCachedExplanation("frontend-design", "en");

    resolveFirst("旧缓存");
    await firstRequest;

    expect(useSkillDetailStore.getState().isExplanationLoading).toBe(true);
    expect(useSkillDetailStore.getState().explanation).toBeNull();

    resolveSecond("Fresh cache");
    await secondRequest;

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("Fresh cache");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.explanationError).toBeNull();
  });

  it("stays loading until the first streamed chunk arrives", async () => {
    let chunkHandler!: (event: { payload: { skill_id: string; text: string } }) => void;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:chunk") {
        chunkHandler = handler as typeof chunkHandler;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");

    expect(useSkillDetailStore.getState().isExplanationLoading).toBe(true);
    expect(useSkillDetailStore.getState().isExplanationStreaming).toBe(false);

    chunkHandler({ payload: { skill_id: "frontend-design", text: "第一段" } });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("第一段");
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(true);
  });

  it("ignores out-of-order explanation events from an older request", async () => {
    let firstChunkHandler!: (event: { payload: { skill_id: string; text: string } }) => void;
    let firstCompleteHandler!: (event: { payload: { skill_id: string; explanation?: string } }) => void;
    let secondChunkHandler!: (event: { payload: { skill_id: string; text: string } }) => void;
    let secondCompleteHandler!: (event: { payload: { skill_id: string; explanation?: string } }) => void;
    let listenerRound = 0;

    mockListen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === "skill:explanation:chunk") {
        if (listenerRound === 0) firstChunkHandler = handler as typeof firstChunkHandler;
        else secondChunkHandler = handler as typeof secondChunkHandler;
      }
      if (eventName === "skill:explanation:complete") {
        if (listenerRound === 0) firstCompleteHandler = handler as typeof firstCompleteHandler;
        else secondCompleteHandler = handler as typeof secondCompleteHandler;
      }
      if (eventName === "skill:explanation:error") {
        listenerRound += 1;
      }
      return vi.fn();
    });

    vi.mocked(invoke).mockResolvedValue(undefined);

    await useSkillDetailStore
      .getState()
      .generateExplanation("frontend-design", mockContent, "zh");
    await useSkillDetailStore
      .getState()
      .refreshExplanation("frontend-design", mockContent, "zh");

    secondChunkHandler({ payload: { skill_id: "frontend-design", text: "新请求" } });
    firstChunkHandler({ payload: { skill_id: "frontend-design", text: "旧请求" } });
    firstCompleteHandler({ payload: { skill_id: "frontend-design", explanation: "旧完成" } });
    secondCompleteHandler({ payload: { skill_id: "frontend-design", explanation: "新完成" } });

    const state = useSkillDetailStore.getState();
    expect(state.explanation).toBe("新完成");
    expect(state.explanation).not.toContain("旧请求");
    expect(state.explanationError).toBeNull();
    expect(state.isExplanationLoading).toBe(false);
    expect(state.isExplanationStreaming).toBe(false);
  });
});
