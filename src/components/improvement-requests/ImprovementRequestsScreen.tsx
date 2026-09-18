"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";

import type { ImprovementRequestListItem } from "@/lib/db/queries/improvement-requests";
import type { ImprovementRequestScreenshot } from "@/lib/db/queries/improvement-request-attachments";
import {
  arrangeImprovementRequestList,
  canChangeImprovementRequestScreenshots,
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  countImprovementRequestBodyChars,
  filterImprovementRequests,
  hasImprovementRequestScreenshotRoom,
  IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
  IMPROVEMENT_REQUEST_FILTER_ALL,
  IMPROVEMENT_REQUEST_STATUS_LABELS,
  IMPROVEMENT_REQUEST_STATUSES,
  improvementRequestCopyText,
  isImprovementRequestStatus,
  listImprovementRequestMenuFilterOptions,
  listImprovementRequestServiceFilterOptions,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";
import {
  isMenuKeyOf,
  isServiceKey,
  listMenusOf,
  listServices,
  menuLabel,
  serviceLabel,
} from "@/lib/domain/service-catalog";
import {
  changeImprovementRequestStatusAction,
  createImprovementRequestAction,
  deleteImprovementRequestAction,
  deleteImprovementRequestAttachmentAction,
  updateImprovementRequestAction,
  type ImprovementRequestActionResult,
} from "@/lib/server/actions/improvement-requests";
import {
  createdWithScreenshotFailuresText,
  formatScreenshotRejections,
  nameScreenshotFile,
  pickPastedScreenshots,
  SCREENSHOT_HINT_TEXT,
  screenScreenshotBatch,
  screenshotBatchNotice,
  screenshotCountText,
  screenshotUploadProgressText,
} from "./improvement-request-screenshot-files";
import {
  ImprovementRequestScreenshotStrip,
  ScreenshotAddButton,
  ScreenshotDeleteDialog,
  ScreenshotTrashNote,
  StagedScreenshotList,
  uploadImprovementRequestScreenshots,
  type StagedScreenshot,
} from "./ImprovementRequestScreenshots";

/**
 * ============================================================================
 * 개선 요청 — 적고, 보고, 고치고, 옮기고, 지운다
 * ============================================================================
 *
 * ── 🔴 서비스를 고르면 그 서비스의 메뉴가 나온다 ────────────────────────
 * 이 화면의 핵심 동작이다(사용자 요구). 메뉴 목록은 고른 서비스로부터
 * `listMenusOf(serviceKey)` 가 만든다 — 목록을 여기에 한 벌 더 적지 않는다.
 * 서비스를 바꾸면 **골라 둔 메뉴를 비운다.** 안 비우면 A/S 의 「견적서」를 고른 채
 * 서비스만 계측기로 바꾼 값이 남아, 저장이 「그 시스템의 메뉴가 아닙니다」로
 * 거절한다. 사람은 메뉴 칸을 건드리지도 않았는데.
 *
 * 목록 위 거르개도 같은 짝이다 — **시스템을 고르기 전에는 메뉴 칸이 비활성**이다.
 * 메뉴 열쇠가 서비스 안에서만 유일하기 때문이고, 까닭은 도메인의
 * filterImprovementRequests 주석에 있다.
 *
 * ── 화면은 규칙을 따로 적지 않는다 ─────────────────────────────────────
 * 누가 어느 글을 고치고 지우고 스크린샷을 바꿀 수 있는가는 domain/improvement-request.ts
 * 의 canEditImprovementRequestBody · canDeleteImprovementRequest ·
 * canChangeImprovementRequestScreenshots 를 줄마다 그대로 부른다 — 저장(mutation)이
 * 잠근 행으로 부르는 바로 그 함수다. 여기에 조건을
 * 따로 적으면 화면은 단추를 열어 주는데 저장이 거절하는 날이 온다. 목록 차례(진행중
 * → 접수 → 해결)도 같은 파일의 arrangeImprovementRequestList 다.
 *
 * ── 🔴 canWrite · canManage 는 편의다 ──────────────────────────────────
 * 단추를 그릴지 말지에만 쓴다. **막는 것은 서버 액션과 올리기 통로**이고, 그쪽은
 * 화면이 넘긴 값이 아니라 살아 있는 계정의 역할로 다시 판정한다.
 *
 * ── 스크린샷 ────────────────────────────────────────────────────────────
 * 형식 · 빈 파일 · 20MB · 다섯 장의 사전 검사
 * (improvement-request-screenshot-files.ts)는 20MB 를 다 보내고 거절당하지 않게
 * 하는 **편의**이고, 막는 것은 올리기 통로다 — 그쪽은 글 행을 잠그고 판정과 장수를
 * 다시 본다. 새 글의 스크린샷은 글을 먼저 만들고 받은 id 로 한 장씩 올린다. 한
 * 요청에 묶지 않으므로 일부만 실패할 수 있고, 그때 글은 **이미 등록된 것**이다
 * (입력칸을 비우고 무엇이 빠졌는지 알린다).
 *
 * ── 버전 충돌은 덮어쓰지 않는다 ────────────────────────────────────────
 * 그 사이 누가 글을 바꿨으면 서버가 CONFLICT 로 돌려준다. 그때는 다시 보내지 않고
 * 안내한 뒤 `router.refresh()` 로 새로 불러온다 — 낡은 화면에서 누른 조작이 방금
 * 바뀐 글에 닿으면 안 된다. 이미 지워진 글(NOT_FOUND)도 같은 길이다.
 *
 * ── 날짜는 KST 로 못 박는다 ────────────────────────────────────────────
 * 서버와 브라우저가 같은 글자를 그려야 하이드레이션이 어긋나지 않는다. 시간대를
 * 적지 않으면 서버는 컨테이너의 시간대로, 브라우저는 사람의 시간대로 그린다.
 *
 * 🔴 본문은 자유 입력이다(db/schema.ts 의 PII 절). 화면에 그리는 것 말고는 어디로도
 * 내보내지 않는다 — console 에도 싣지 않는다. 스크린샷의 파일 이름과 이미지도 같다.
 * [복사]는 누른 사람의 클립보드로만 간다.
 * ============================================================================
 */

/** 메뉴 선택칸의 「고르지 않음」. 빈 문자열이라 검증이 null 로 읽는다. */
const NO_MENU_VALUE = "";

const STATUS_BADGE: Record<ImprovementRequestStatus, string> = {
  OPEN: "border-slate-300 bg-slate-100 text-slate-700",
  IN_PROGRESS: "border-amber-300 bg-amber-100 text-amber-800",
  RESOLVED: "border-emerald-300 bg-emerald-100 text-emerald-800",
};

const SELECT_CLASS =
  "rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400";
const FILTER_SELECT_CLASS =
  "max-w-full min-w-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900 disabled:bg-slate-50 disabled:text-slate-400";
const SMALL_BUTTON_CLASS =
  "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const SMALL_DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50";
const FIELD_ERROR_CLASS = "text-xs text-red-600";

const CONFLICT_NOTICE =
  "다른 사람이 이 개선요청을 먼저 바꿨습니다. 새로 불러왔습니다 — 확인한 뒤 다시 해 주세요.";
const NOT_FOUND_NOTICE = "그 사이 지워진 개선요청입니다. 목록을 새로 불러왔습니다.";
const COPY_FAILED_TEXT = "복사하지 못했습니다. 글을 직접 선택해 복사해 주세요.";
const COPY_DONE_MS = 1500;

/** 날짜만 그리는 KST 포매터(파일 머리말의 '날짜는 KST 로 못 박는다'). */
const KST_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // ko-KR 는 「2026. 09. 17.」로 그린다 — 하이픈으로 눕혀 목록에서 폭을 아낀다.
  return KST_DATE_FORMATTER.format(date).replace(/\.\s?/g, "-").replace(/-$/, "");
}

/**
 * 클립보드에 넣는다.
 *
 * navigator.clipboard 는 https 나 localhost 에서만 동작한다. 이 사이트는 사내망
 * **http** 로 열리므로 거기서는 쓸 수 없다 — 그래서 옛 방식(숨긴 textarea +
 * execCommand)을 둘째 갈래로 둔다. 이것을 빼면 「복사가 안 되는데 아무 말도 없는」
 * 상태가 된다.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // https 가 아니거나 권한이 막힌 경우 — 아래 옛 방식으로 넘어간다.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // 화면 밖에 두되 focus 가 가야 하므로 display:none 은 쓸 수 없다.
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 서버가 준 실패를 한 문장으로 — 칸 오류가 있으면 그것이 더 구체적이다. */
function failureText(result: Extract<ImprovementRequestActionResult, { ok: false }>): string {
  const fieldErrors = result.fieldErrors ?? {};
  return (
    fieldErrors.body ??
    fieldErrors.serviceKey ??
    fieldErrors.menuKey ??
    fieldErrors.to ??
    fieldErrors.id ??
    fieldErrors.expectedVersion ??
    result.message
  );
}

export function ImprovementRequestsScreen({
  items,
  actingUserId,
  canWrite,
  canManage,
}: {
  items: ImprovementRequestListItem[];
  /** 「자기 글인가」를 줄마다 판정하는 재료. 페이지가 세션에서 구해 넘긴다. */
  actingUserId: string;
  /** 적기·지우기 단추를 그릴지. 막는 것은 서버다(파일 머리말). */
  canWrite: boolean;
  /** 상태 선택칸을 그릴지. 막는 것은 서버다. */
  canManage: boolean;
}) {
  const router = useRouter();
  const services = useMemo(() => listServices(), []);
  const [isPending, startTransition] = useTransition();
  /** 지금 서버에 가 있는 조작 — 단추 글자를 「…중」으로 바꿀 자리를 고른다. */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  /* ── 새 글 ─────────────────────────────────────────────────────── */
  const [serviceKey, setServiceKey] = useState("");
  const [menuKey, setMenuKey] = useState<string>(NO_MENU_VALUE);
  const [body, setBody] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState<string | null>(null);
  const [createReport, setCreateReport] = useState<string | null>(null);

  /* ── 등록 전 스크린샷 ──────────────────────────────────────────── */
  const [staged, setStaged] = useState<StagedScreenshot[]>([]);
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  /**
   * 미리보기로 만든 주소 전부 — 화면이 사라질 때 놓는다. 바꿔 끼우지 않고 한 Set 을
   * 계속 쓴다(정리 함수가 처음 잡은 그 Set 을 비운다).
   */
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const stagedKeySeqRef = useRef(0);

  /* ── 목록 ──────────────────────────────────────────────────────── */
  const [notice, setNotice] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [serviceFilter, setServiceFilter] = useState(IMPROVEMENT_REQUEST_FILTER_ALL);
  const [menuFilter, setMenuFilter] = useState(IMPROVEMENT_REQUEST_FILTER_ALL);
  const [copyResult, setCopyResult] = useState<{ id: string; state: "copied" | "failed" } | null>(
    null,
  );

  /* ── 고치기 ────────────────────────────────────────────────────── */
  /**
   * 지금 고치는 중인 글. 한 번에 하나만 연다 — 여러 줄을 동시에 열어 두면 어느
   * 초안이 어느 글의 것인지 사람도 화면도 헷갈린다.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editServiceKey, setEditServiceKey] = useState("");
  const [editMenuKey, setEditMenuKey] = useState<string>(NO_MENU_VALUE);
  const [editBody, setEditBody] = useState("");
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});

  /* ── 지우기 ────────────────────────────────────────────────────── */
  const [deleteTarget, setDeleteTarget] = useState<ImprovementRequestListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [screenshotDeleteTarget, setScreenshotDeleteTarget] = useState<{
    requestId: string;
    screenshot: ImprovementRequestScreenshot;
  } | null>(null);
  /** 목록 줄에 곧바로 올리는 중인 글과 그 진행 문구. */
  const [rowUpload, setRowUpload] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // 걷는 타이머는 결과가 바뀌거나 화면이 사라질 때 이 정리 함수가 치운다.
  useEffect(() => {
    if (copyResult?.state !== "copied") return;
    const timer = setTimeout(() => setCopyResult(null), COPY_DONE_MS);
    return () => clearTimeout(timer);
  }, [copyResult]);

  /** 🔴 고른 서비스의 메뉴만. 목록은 카탈로그가 만든다. */
  const menus = useMemo(() => listMenusOf(serviceKey), [serviceKey]);
  const bodyChars = countImprovementRequestBodyChars(body);
  const bodyOver = bodyChars > IMPROVEMENT_REQUEST_BODY_MAX_CHARS;

  // 고치기 폼도 같은 짝이다 — 고른 시스템의 메뉴만, 같은 글자 세기로.
  const editMenus = useMemo(() => listMenusOf(editServiceKey), [editServiceKey]);
  const editBodyChars = countImprovementRequestBodyChars(editBody);
  const editBodyOver = editBodyChars > IMPROVEMENT_REQUEST_BODY_MAX_CHARS;

  // 거르고 → 차례를 세우고 → 해결된 것을 감춘다. 그래서 「(N건 숨김)」과 빈 목록
  // 안내도 고른 칸 안의 수를 말한다.
  const { rows, resolvedCount, hiddenResolvedCount } = arrangeImprovementRequestList(
    filterImprovementRequests(items, { serviceFilter, menuFilter }),
    { showResolved },
  );
  const serviceFilterOptions = listImprovementRequestServiceFilterOptions(items, {
    showResolved,
    selected: serviceFilter,
  });
  const menuFilterOptions = listImprovementRequestMenuFilterOptions(items, {
    serviceFilter,
    showResolved,
    selected: menuFilter,
  });
  const isFiltered = serviceFilter !== IMPROVEMENT_REQUEST_FILTER_ALL;

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  function onServiceChange(next: string) {
    setServiceKey(next);
    // 서비스가 바뀌면 메뉴는 성립하지 않는다 — 파일 머리말의 첫 절.
    setMenuKey(NO_MENU_VALUE);
    setFieldErrors({});
  }

  function onServiceFilterChange(next: string) {
    setServiceFilter(next);
    // 거르개도 같은 짝이다 — 시스템을 바꾸면 고른 메뉴는 성립하지 않는다.
    setMenuFilter(IMPROVEMENT_REQUEST_FILTER_ALL);
  }

  /**
   * 조작 하나를 보내고 결과를 셋으로 가른다 — 성공(새로 그린다) · 새로 불러와야
   * 하는 실패(충돌 · 이미 지워짐) · 그 자리에 적을 실패.
   */
  function run(
    key: string,
    send: () => Promise<ImprovementRequestActionResult>,
    handlers: { onOk: () => void; onFailure: (text: string, errors: Record<string, string>) => void },
  ) {
    setNotice(null);
    setPendingKey(key);
    startTransition(async () => {
      const result = await send();
      setPendingKey(null);
      if (result.ok) {
        handlers.onOk();
        router.refresh();
        return;
      }
      if (result.code === "CONFLICT" || result.code === "NOT_FOUND") {
        setNotice(result.code === "CONFLICT" ? CONFLICT_NOTICE : NOT_FOUND_NOTICE);
        setDeleteTarget(null);
        // 🔴 열려 있던 고치기 폼도 닫는다. 새로 불러온 글은 그 사이 상태가 옮겨졌을
        // 수도, 내용이 바뀌었을 수도 있는데 폼이 그 위를 덮고 있으면 사람은 무엇이
        // 바뀌었는지 보지 못한 채 [저장]을 한 번 더 누르게 된다.
        setEditingId(null);
        router.refresh();
        return;
      }
      handlers.onFailure(failureText(result), result.fieldErrors ?? {});
    });
  }

  /* ── 등록 전 스크린샷 모으기 ──────────────────────────────────── */

  function releasePreviewUrls(entries: readonly StagedScreenshot[]) {
    for (const entry of entries) {
      URL.revokeObjectURL(entry.previewUrl);
      objectUrlsRef.current.delete(entry.previewUrl);
    }
  }

  function stageScreenshots(files: File[]) {
    const batch = screenScreenshotBatch(files, staged.length);
    setStagedNotice(screenshotBatchNotice(batch));
    setCreateReport(null);
    if (batch.accepted.length === 0) return;
    const added = batch.accepted.map((file): StagedScreenshot => {
      stagedKeySeqRef.current += 1;
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return { key: `staged-${stagedKeySeqRef.current}`, file, previewUrl };
    });
    setStaged((prev) => [...prev, ...added]);
  }

  function unstageScreenshot(key: string) {
    const entry = staged.find((candidate) => candidate.key === key);
    if (entry) releasePreviewUrls([entry]);
    setStaged((prev) => prev.filter((candidate) => candidate.key !== key));
    setStagedNotice(null);
  }

  /**
   * 붙여넣기에서 이미지만 떼어 이름을 붙인다. 글자와 섞였으면 글자 붙여넣기는
   * 그대로 두고, 이미지만 왔으면 기본 동작을 막는다. `firstSequence` 는 이름 끝
   * 번호의 시작 — 이미 모아 둔(또는 붙은) 장 다음 번호로 이어 짓는다.
   */
  function takePastedScreenshots(
    event: ClipboardEvent<HTMLTextAreaElement>,
    firstSequence: number,
  ): File[] {
    const { images, hasText } = pickPastedScreenshots(event.clipboardData.items);
    if (images.length === 0) return [];
    if (!hasText) event.preventDefault();
    const now = new Date();
    return images.map((file, index) => nameScreenshotFile(file, now, firstSequence + index));
  }

  /* ── 조작들 ────────────────────────────────────────────────────── */

  function submitNew() {
    setCreateError(null);
    setFieldErrors({});
    setCreateReport(null);
    setStagedNotice(null);
    const toUpload = staged;
    run(
      "create",
      async () => {
        const result = await createImprovementRequestAction({
          fields: { serviceKey, menuKey, body },
        });
        if (!result.ok || toUpload.length === 0) return result;
        // 글은 등록됐다 — 받은 id 로 한 장씩 차례로 올린다.
        const outcome = await uploadImprovementRequestScreenshots(
          result.id,
          toUpload.map((entry) => entry.file),
          (current, total) => setCreateProgress(screenshotUploadProgressText(current, total)),
        );
        setCreateProgress(null);
        if (outcome.failures.length > 0) {
          setCreateReport(createdWithScreenshotFailuresText(toUpload.length, outcome.failures));
        }
        return result;
      },
      {
        onOk: () => {
          // 서비스 선택은 남긴다 — 한 시스템에 대해 연달아 적는 일이 잦다.
          setBody("");
          setMenuKey(NO_MENU_VALUE);
          releasePreviewUrls(toUpload);
          setStaged((prev) => prev.filter((entry) => !toUpload.includes(entry)));
          setNotice("등록했습니다.");
        },
        onFailure: (text, errors) => {
          setFieldErrors(errors);
          setCreateError(text);
        },
      },
    );
  }

  /**
   * 고치기 폼을 연다 — 지금 저장돼 있는 값을 그대로 담아서.
   *
   * 🔴 목록에서 빠진 시스템·메뉴의 옛 글은 **빈 값으로 연다.** 없는 열쇠를
   * `<select>` 의 value 로 주면 브라우저가 첫 칸을 고른 것처럼 보여 주는데, 사람은
   * 자기가 고르지도 않은 시스템으로 글이 옮겨 간 것을 모른 채 저장하게 된다.
   * 빈 값이면 [저장]이 꺼져 있어 다시 고르게 된다.
   */
  function startEdit(item: ImprovementRequestListItem) {
    const serviceOk = isServiceKey(item.serviceKey);
    setEditingId(item.id);
    setEditBody(item.body);
    setEditServiceKey(serviceOk ? item.serviceKey : "");
    setEditMenuKey(
      serviceOk && item.menuKey !== null && isMenuKeyOf(item.serviceKey, item.menuKey)
        ? item.menuKey
        : NO_MENU_VALUE,
    );
    setEditFieldErrors({});
    setRowError(item.id, null);
  }

  function cancelEdit(item: ImprovementRequestListItem) {
    setEditingId(null);
    setEditFieldErrors({});
    setRowError(item.id, null);
  }

  function onEditServiceChange(next: string) {
    setEditServiceKey(next);
    // 새 글과 같은 이유다 — 시스템이 바뀌면 골라 둔 메뉴는 성립하지 않는다.
    setEditMenuKey(NO_MENU_VALUE);
    setEditFieldErrors({});
  }

  /**
   * 고친 내용을 보낸다. 「접수 상태인 자기 글인가」는 **서버가** 잠근 행으로 다시
   * 판정한다 — 이 화면이 단추를 그렸다는 사실은 근거가 아니다(파일 머리말).
   */
  function saveEdit(item: ImprovementRequestListItem) {
    setRowError(item.id, null);
    setEditFieldErrors({});
    run(
      `edit:${item.id}`,
      () =>
        updateImprovementRequestAction({
          id: item.id,
          expectedVersion: item.version,
          fields: { serviceKey: editServiceKey, menuKey: editMenuKey, body: editBody },
        }),
      {
        onOk: () => {
          setEditingId(null);
          setNotice("고쳤습니다.");
        },
        onFailure: (text, errors) => {
          setEditFieldErrors(errors);
          setRowError(item.id, text);
        },
      },
    );
  }

  function changeStatus(item: ImprovementRequestListItem, to: string) {
    if (!isImprovementRequestStatus(to) || to === item.status) return;
    setRowError(item.id, null);
    run(
      `status:${item.id}`,
      () =>
        changeImprovementRequestStatusAction({
          id: item.id,
          expectedVersion: item.version,
          to,
        }),
      {
        onOk: () => undefined,
        onFailure: (text) => setRowError(item.id, text),
      },
    );
  }

  async function copyBody(item: ImprovementRequestListItem) {
    const ok = await copyText(improvementRequestCopyText(item));
    setCopyResult({ id: item.id, state: ok ? "copied" : "failed" });
  }

  function confirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    setDeleteError(null);
    run(
      `delete:${item.id}`,
      () => deleteImprovementRequestAction({ id: item.id, expectedVersion: item.version }),
      {
        onOk: () => setDeleteTarget(null),
        onFailure: (text) => setDeleteError(text),
      },
    );
  }

  /**
   * 목록 줄의 글에 곧바로 올린다 — 글이 이미 있으므로 미리보기 없이. 사전 검사는 새
   * 글과 같고, 서버가 거절한 문구는 그 줄의 오류 자리에 그대로 보인다. 글이 그 사이
   * 지워졌으면 다른 조작처럼 새로 불러온다.
   */
  function addRowScreenshots(item: ImprovementRequestListItem, files: File[]) {
    const batch = screenScreenshotBatch(files, item.screenshots.length);
    const batchNotice = screenshotBatchNotice(batch);
    setRowError(item.id, batchNotice);
    if (batch.accepted.length === 0) return;
    setNotice(null);
    setPendingKey(`shots:${item.id}`);
    startTransition(async () => {
      const outcome = await uploadImprovementRequestScreenshots(
        item.id,
        batch.accepted,
        (current, total) =>
          setRowUpload({ id: item.id, text: screenshotUploadProgressText(current, total) }),
      );
      setRowUpload(null);
      setPendingKey(null);
      if (outcome.failureCodes.includes("IMPROVEMENT_REQUEST_NOT_FOUND")) {
        setNotice(NOT_FOUND_NOTICE);
        setRowError(item.id, null);
        router.refresh();
        return;
      }
      if (outcome.failures.length > 0) {
        const failed = `올리지 못한 스크린샷 — ${formatScreenshotRejections(outcome.failures)}`;
        setRowError(item.id, batchNotice ? `${batchNotice} ${failed}` : failed);
      }
      router.refresh();
    });
  }

  function confirmScreenshotDelete() {
    const target = screenshotDeleteTarget;
    if (!target) return;
    setNotice(null);
    setRowError(target.requestId, null);
    setPendingKey(`shot-delete:${target.screenshot.id}`);
    startTransition(async () => {
      const result = await deleteImprovementRequestAttachmentAction({
        improvementRequestId: target.requestId,
        attachmentId: target.screenshot.id,
      });
      setPendingKey(null);
      setScreenshotDeleteTarget(null);
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.code === "NOT_FOUND" || result.code === "ALREADY_DELETED") {
        // 그 사이 누가 먼저 지웠다 — 목록에서 걷히도록 새로 불러온다.
        setNotice(result.message);
        router.refresh();
        return;
      }
      setRowError(target.requestId, result.message);
    });
  }

  /* ── 그리기 ────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">개선 요청</h1>
        <p className="mt-2 text-sm text-slate-600">
          사내 시스템을 쓰다가 불편했던 점, 바뀌었으면 하는 점을 적어 주세요. 관리자가 접수 →
          진행중 → 해결로 옮깁니다.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {notice}
        </p>
      )}

      {/* ───── 새 개선 요청 ───── */}
      {canWrite ? (
        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">새 개선 요청</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-700">
                어느 시스템 <span className="text-red-600">*</span>
              </span>
              <select
                value={serviceKey}
                onChange={(event) => onServiceChange(event.target.value)}
                disabled={isPending}
                className={`mt-1 w-full ${SELECT_CLASS}`}
              >
                <option value="">— 고르세요 —</option>
                {services.map((service) => (
                  <option key={service.key} value={service.key}>
                    {service.label}
                  </option>
                ))}
              </select>
              {fieldErrors.serviceKey && (
                <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>{fieldErrors.serviceKey}</p>
              )}
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">어느 메뉴 (몰라도 됩니다)</span>
              <select
                value={menuKey}
                onChange={(event) => setMenuKey(event.target.value)}
                // 서비스를 아직 안 골랐거나 메뉴가 없는 서비스면 고를 것이 없다.
                // 감추지 않는 것은, 칸이 사라졌다 나타나면 폼의 높이가 흔들려
                // 누르려던 단추가 움직이기 때문이다.
                disabled={isPending || menus.length === 0}
                className={`mt-1 w-full ${SELECT_CLASS}`}
              >
                <option value={NO_MENU_VALUE}>모름 · 해당 없음</option>
                {menus.map((menu) => (
                  <option key={menu.key} value={menu.key}>
                    {menu.label}
                  </option>
                ))}
              </select>
              {fieldErrors.menuKey && (
                <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>{fieldErrors.menuKey}</p>
              )}
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-slate-700">
              내용 <span className="text-red-600">*</span>
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onPaste={(event) => {
                const files = takePastedScreenshots(event, staged.length + 1);
                if (files.length > 0 && !isPending) stageScreenshots(files);
              }}
              disabled={isPending}
              rows={4}
              aria-invalid={createError || bodyOver ? true : undefined}
              placeholder="무엇이 불편한지, 어떻게 되면 좋겠는지 적어 주세요."
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            {fieldErrors.body && <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>{fieldErrors.body}</p>}
          </label>

          <StagedScreenshotList staged={staged} disabled={isPending} onRemove={unstageScreenshot} />

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {hasImprovementRequestScreenshotRoom(staged.length) && (
              <ScreenshotAddButton onFiles={stageScreenshots} disabled={isPending} />
            )}
            <span>
              <span className="tabular-nums">{screenshotCountText(staged.length)}</span> ·{" "}
              {SCREENSHOT_HINT_TEXT}
            </span>
          </div>

          {stagedNotice && (
            <p role="alert" className={FIELD_ERROR_CLASS}>
              {stagedNotice}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={bodyOver ? "text-xs text-red-600" : "text-xs text-slate-400"}>
              <span className="tabular-nums">{bodyChars}</span> /{" "}
              {IMPROVEMENT_REQUEST_BODY_MAX_CHARS}
            </span>
            <button
              type="button"
              onClick={submitNew}
              disabled={isPending || serviceKey === "" || body.trim() === "" || bodyOver}
              aria-busy={pendingKey === "create"}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:bg-slate-300"
            >
              {pendingKey === "create" ? "등록 중…" : "등록"}
            </button>
          </div>

          {createError && (
            <p role="alert" className={FIELD_ERROR_CLASS}>
              {createError}
            </p>
          )}
          {createProgress && (
            <p role="status" className="text-xs text-slate-700">
              {createProgress}
            </p>
          )}
          {createReport && (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              {createReport}
            </p>
          )}
        </section>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          읽기 권한만 있어 새 개선 요청을 적을 수 없습니다.
        </p>
      )}

      {/* ───── 목록 ───── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            목록 <span className="font-normal text-slate-500">({rows.length}건)</span>
          </h2>

          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-slate-700">
              <span className="shrink-0">시스템</span>
              <select
                value={serviceFilter}
                onChange={(event) => onServiceFilterChange(event.target.value)}
                className={FILTER_SELECT_CLASS}
              >
                {serviceFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-slate-700">
              <span className="shrink-0">메뉴</span>
              <select
                value={menuFilter}
                onChange={(event) => setMenuFilter(event.target.value)}
                // 시스템을 고르기 전에는 고를 것이 없다 — 메뉴 열쇠가 서비스
                // 안에서만 유일하기 때문이다(도메인의 filterImprovementRequests).
                disabled={!isFiltered}
                className={FILTER_SELECT_CLASS}
              >
                {menuFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(event) => setShowResolved(event.target.checked)}
                className="h-4 w-4"
              />
              해결된 것도 보기
              {hiddenResolvedCount > 0 && (
                <span className="text-slate-500">({hiddenResolvedCount}건 숨김)</span>
              )}
            </label>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            {resolvedCount > 0 && !showResolved
              ? `${isFiltered ? "여기에는 " : ""}지금 열려 있는 개선 요청이 없습니다. 해결된 ${resolvedCount}건은 「해결된 것도 보기」로 볼 수 있습니다.`
              : isFiltered
                ? "이 조건으로 적힌 개선 요청이 없습니다."
                : "아직 적힌 개선 요청이 없습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((item) => {
              const mayEdit =
                canWrite &&
                canEditImprovementRequestBody({
                  status: item.status,
                  createdBy: item.createdByUserId,
                  actorUserId: actingUserId,
                });
              const mayDelete =
                canWrite &&
                canDeleteImprovementRequest({
                  createdBy: item.createdByUserId,
                  actorUserId: actingUserId,
                  canManage,
                });
              const mayChangeScreenshots =
                canWrite &&
                canChangeImprovementRequestScreenshots({
                  createdBy: item.createdByUserId,
                  actorUserId: actingUserId,
                  canManage,
                });
              const isEditing = editingId === item.id;
              const rowError = rowErrors[item.id];
              const copyState = copyResult?.id === item.id ? copyResult.state : null;

              return (
                <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[item.status]}`}
                    >
                      {IMPROVEMENT_REQUEST_STATUS_LABELS[item.status]}
                    </span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
                      {serviceLabel(item.serviceKey)}
                    </span>
                    <span
                      className={
                        item.menuKey === null
                          ? "rounded border border-dashed border-slate-200 px-1.5 py-0.5 text-xs text-slate-400"
                          : "rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600"
                      }
                    >
                      {menuLabel(item.serviceKey, item.menuKey)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {item.createdByName ?? "(알 수 없음)"} · {formatDate(item.createdAt)}
                    </span>
                  </div>

                  {isEditing ? (
                    /*
                     * 고치기 폼은 **본문이 있던 자리**에 그린다. 팝업으로 띄우지 않는
                     * 것은, 고치는 사람이 위의 이름표(상태·시스템·메뉴)와 아래의
                     * 스크린샷을 함께 보면서 고쳐야 하기 때문이다.
                     */
                    <div className="mt-2 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="text-slate-700">
                            어느 시스템 <span className="text-red-600">*</span>
                          </span>
                          <select
                            value={editServiceKey}
                            onChange={(event) => onEditServiceChange(event.target.value)}
                            disabled={isPending}
                            className={`mt-1 w-full ${SELECT_CLASS}`}
                          >
                            <option value="">— 고르세요 —</option>
                            {services.map((service) => (
                              <option key={service.key} value={service.key}>
                                {service.label}
                              </option>
                            ))}
                          </select>
                          {editFieldErrors.serviceKey && (
                            <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>
                              {editFieldErrors.serviceKey}
                            </p>
                          )}
                        </label>

                        <label className="block text-sm">
                          <span className="text-slate-700">어느 메뉴 (몰라도 됩니다)</span>
                          <select
                            value={editMenuKey}
                            onChange={(event) => setEditMenuKey(event.target.value)}
                            disabled={isPending || editMenus.length === 0}
                            className={`mt-1 w-full ${SELECT_CLASS}`}
                          >
                            <option value={NO_MENU_VALUE}>모름 · 해당 없음</option>
                            {editMenus.map((menu) => (
                              <option key={menu.key} value={menu.key}>
                                {menu.label}
                              </option>
                            ))}
                          </select>
                          {editFieldErrors.menuKey && (
                            <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>{editFieldErrors.menuKey}</p>
                          )}
                        </label>
                      </div>

                      <label className="block text-sm">
                        <span className="text-slate-700">
                          내용 <span className="text-red-600">*</span>
                        </span>
                        <textarea
                          value={editBody}
                          onChange={(event) => setEditBody(event.target.value)}
                          disabled={isPending}
                          rows={4}
                          aria-invalid={rowError || editBodyOver ? true : undefined}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        />
                        {editFieldErrors.body && (
                          <p className={`mt-1 ${FIELD_ERROR_CLASS}`}>{editFieldErrors.body}</p>
                        )}
                      </label>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={
                            editBodyOver ? "text-xs text-red-600" : "text-xs text-slate-400"
                          }
                        >
                          <span className="tabular-nums">{editBodyChars}</span> /{" "}
                          {IMPROVEMENT_REQUEST_BODY_MAX_CHARS}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => cancelEdit(item)}
                            disabled={isPending}
                            className={SMALL_BUTTON_CLASS}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(item)}
                            disabled={
                              isPending ||
                              editServiceKey === "" ||
                              editBody.trim() === "" ||
                              editBodyOver
                            }
                            aria-busy={pendingKey === `edit:${item.id}`}
                            className="rounded-md bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:bg-slate-300"
                          >
                            {pendingKey === `edit:${item.id}` ? "저장 중…" : "저장"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 줄바꿈을 그대로 보인다. 본문은 자유 입력이라 HTML 로 해석하지 않는다. */
                    <p className="mt-2 text-sm break-words whitespace-pre-wrap text-slate-900">
                      {item.body}
                    </p>
                  )}

                  <ImprovementRequestScreenshotStrip
                    improvementRequestId={item.id}
                    screenshots={item.screenshots}
                    canChange={mayChangeScreenshots}
                    disabled={isPending}
                    progressText={rowUpload?.id === item.id ? rowUpload.text : null}
                    onAddFiles={(files) => addRowScreenshots(item, files)}
                    onRequestDelete={(screenshot) => {
                      setRowError(item.id, null);
                      setScreenshotDeleteTarget({ requestId: item.id, screenshot });
                    }}
                  />

                  {(item.inProgressAt || item.resolvedAt) && (
                    <div className="mt-2 flex flex-col gap-0.5 text-xs text-slate-500">
                      {item.inProgressAt && (
                        <span>
                          진행중 — {item.inProgressByName ?? "알 수 없음"} ·{" "}
                          {formatDate(item.inProgressAt)}
                        </span>
                      )}
                      {item.resolvedAt && (
                        <span>
                          해결 — {item.resolvedByName ?? "알 수 없음"} ·{" "}
                          {formatDate(item.resolvedAt)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 단추 줄은 늘 그린다 — [복사]는 보는 권한만 있어도 쓴다. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canManage && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        상태
                        <select
                          value={item.status}
                          onChange={(event) => changeStatus(item, event.target.value)}
                          disabled={isPending}
                          aria-busy={pendingKey === `status:${item.id}`}
                          className={FILTER_SELECT_CLASS}
                        >
                          {IMPROVEMENT_REQUEST_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {IMPROVEMENT_REQUEST_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        {pendingKey === `status:${item.id}` && <span>옮기는 중…</span>}
                      </label>
                    )}
                    <div className="ml-auto flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void copyBody(item)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {copyState === "copied" ? "복사했습니다" : "복사"}
                      </button>
                      {mayEdit && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          disabled={isPending}
                          className={SMALL_BUTTON_CLASS}
                        >
                          고치기
                        </button>
                      )}
                      {mayDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(item);
                          }}
                          disabled={isPending}
                          className={SMALL_DANGER_BUTTON_CLASS}
                        >
                          지우기
                        </button>
                      )}
                    </div>
                  </div>

                  {copyState === "failed" && (
                    <p role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`}>
                      {COPY_FAILED_TEXT}
                    </p>
                  )}
                  {rowError && (
                    <p role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`}>
                      {rowError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {deleteTarget && (
        <DeleteImprovementRequestDialog
          target={deleteTarget}
          isSubmitting={pendingKey === `delete:${deleteTarget.id}`}
          errorMessage={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}

      {screenshotDeleteTarget && (
        <ScreenshotDeleteDialog
          improvementRequestId={screenshotDeleteTarget.requestId}
          screenshot={screenshotDeleteTarget.screenshot}
          isSubmitting={pendingKey === `shot-delete:${screenshotDeleteTarget.screenshot.id}`}
          onConfirm={confirmScreenshotDelete}
          onCancel={() => setScreenshotDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * 글 지우기 확인창.
 *
 * 열려 있는 동안만 그린다 — 줄마다 닫힌 `<dialog>` 를 늘어놓지 않으려고. Esc 는
 * onCancel 로 부모 상태를 걷는다(브라우저에만 맡기면 부모 상태와 엇갈려 다음에
 * 열리지 않는다).
 */
function DeleteImprovementRequestDialog({
  target,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  target: ImprovementRequestListItem;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="improvement-request-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 text-slate-900 backdrop:bg-black/40"
    >
      <h2 id="improvement-request-delete-title" className="text-sm font-semibold">
        이 개선 요청을 지우시겠습니까?
      </h2>
      <p className="mt-2 line-clamp-4 text-sm break-words whitespace-pre-wrap text-slate-600">
        {target.body}
      </p>
      <ScreenshotTrashNote count={target.screenshots.length} />
      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {errorMessage}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "지우는 중…" : "지우기"}
        </button>
      </div>
    </dialog>
  );
}
