import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_FORMAT_TEXT,
  canonicalMimeTypeForExtension,
  checkAttachmentFile,
  formatMegabytes,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/domain/attachment-file";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
  improvementRequestScreenshotRoomLeft,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 스크린샷 — 화면이 파일을 고르고 이름 짓고 미리 거르는 순수 도우미
 * ============================================================================
 * DOM 도 fetch 도 만지지 않는다(File · DataTransferItem · window 의 **모양**만 쓴다 —
 * 전역을 직접 집지 않고 받는다) — 시험이 브라우저 없이 전부 돌린다. 올리는 일 자체는
 * ImprovementRequestScreenshots.tsx 의 uploadImprovementRequestScreenshots 가 한다.
 *
 * 🔴 **여기의 판정은 편의일 뿐이다.** 형식 · 크기 · 다섯 장은 올리기 통로
 * (api/improvement-requests/[id]/attachments/route.ts)가 다시 본다 — 20MB 를 다
 * 보내고 거절당하기 전에 알려 주려는 것이다. 판정의 재료도 그 통로와 **같은 것**을
 * 부른다(domain/attachment-file.ts · domain/improvement-request.ts). 여기에 수나
 * 확장자를 따로 적으면 화면은 받는데 서버가 거절하는 날이 온다.
 *
 * 🔴 파일 이름은 사람이 붙인 것이라 개인정보가 섞일 수 있다(db/schema.ts 의 PII 절).
 * 화면에 보이는 것 말고는 어디로도 내보내지 않는다 — console 에도 싣지 않는다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 붙여넣기에서 이미지 고르기                                            */
/* ------------------------------------------------------------------ */

/**
 * 클립보드 항목에서 쓰는 것만. DataTransferItem 이 그대로 맞고, 시험은 흉내 낸
 * 객체를 넘긴다.
 */
export type ClipboardItemLike = {
  kind: string;
  type: string;
  getAsFile(): File | null;
};

export type ScreenshotPastePlan = {
  /** 붙여넣은 이미지들 — 이름은 아직 브라우저가 붙인 그대로다(nameScreenshotFile 로 짓는다). */
  images: File[];
  /**
   * 글자도 함께 왔는가. 왔으면 브라우저의 글자 붙여넣기를 그대로 두고 이미지만
   * 더한다. 안 왔으면 부르는 쪽이 기본 동작을 막는다(preventDefault).
   */
  hasText: boolean;
};

/**
 * 붙여넣기(`clipboardData.items`)에서 이미지와 「글자가 함께 왔는가」를 고른다.
 *
 * 이미지는 png · jpeg 만이 아니라 **image/\* 전부**를 고른다 — gif · webp 를
 * 붙여넣었을 때 조용히 무시하면 사람은 붙었는지 아닌지를 모른다. 고른 뒤
 * checkAttachmentFile 이 형식 까닭으로 거절해 알린다.
 *
 * 🔴 getAsFile 은 붙여넣기 이벤트 **안에서 곧바로** 불러야 한다 — 이벤트가 끝나면
 * 클립보드 항목이 비워지는 브라우저가 있다. 그래서 이 함수는 동기다.
 */
export function pickPastedScreenshots(items: ArrayLike<ClipboardItemLike>): ScreenshotPastePlan {
  const images: File[] = [];
  let hasText = false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "string" && item.type === "text/plain") {
      hasText = true;
      continue;
    }
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  return { images, hasText };
}

/* ------------------------------------------------------------------ */
/* 파일 찾기 창을 사진 폴더에서 열기                                      */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **고르는 창만 두 갈래다. 고른 뒤는 한 길이다.**
 *
 * `<input type="file">` 로는 창이 어느 폴더에서 열릴지 정할 수 없다 — 브라우저는
 * 「마지막에 쓴 폴더」에서 연다. 그 폴더가 OneDrive 면 목록을 받아오느라 창이 몇 초
 * 늦게 뜬다. 그래서 창을 여는 일만 showOpenFilePicker 로 바꾸고 사진 폴더를 시작점
 * 으로 준다(윈도 캡처 도구가 저장하는 자리다).
 *
 * 여기 있는 것은 **창을 여는 값과 판정**뿐이다. 고른 파일은 어느 갈래로 왔든 같은
 * onFiles 로 넘어가 screenScreenshotBatch 를 지난다 — 새 갈래 전용 검사는 없다.
 * (common/file-drop.ts 머리말의 「떨군 파일도 같은 함수를 지난다」와 같은 규칙이다.)
 *
 * ── 🔴 `id` 를 주지 않는 까닭 ───────────────────────────────────────────
 * 규격의 「창이 열릴 폴더를 정한다」 차례는 이렇다(wicg.github.io/file-system-access,
 * *determine the directory the picker will start in*):
 *
 *   1. startIn 이 손잡이(FileSystemHandle)면 그 폴더
 *   2. **id 가 비어 있지 않고** 그 id 로 기억해 둔 폴더가 있으면 **그 폴더**
 *   3. startIn 이 알려진 폴더 이름이면 그 폴더          ← 우리가 타는 자리
 *   4. id 가 없으면 기억해 둔 마지막 폴더
 *
 * 크로미움 구현도 같은 차례다 — content/browser/file_system_access/
 * file_system_access_manager_impl.cc 의 ResolveDefaultDirectory 에 주석이 그대로
 * 붙어 있다: `Prioritize an 'id' over a well-known directory.` 그리고
 * `Prioritize an explicitly stated well-known directory over an implicitly
 * remembered LastPicked directory.`
 *
 * 곧 **id 를 주면 두 번째 고르기부터 startIn 이 무시되고** 마지막 폴더에서 열린다.
 * 늘 사진 폴더에서 열려야 하므로 id 는 주지 않는다.
 */

/** showOpenFilePicker 의 `types` 한 칸. TS 의 dom 라이브러리에 이 API 가 없어 직접 적는다. */
export type FilePickerAcceptType = {
  description: string;
  /** MIME → 확장자 목록(점을 붙인다 — 규격이 그 모양을 받는다). */
  accept: Record<string, string[]>;
};

export type ScreenshotFilePickerOptions = {
  multiple: true;
  startIn: "pictures";
  types: FilePickerAcceptType[];
};

/**
 * 창에 걸 형식표를 도메인 상수에서 **만든다** — MIME 도 확장자도 여기에 새로 적지
 * 않는다. 재료는 고르기 칸의 accept(ATTACHMENT_FILE_ACCEPT)와 올리기 통로가 보는
 * 것과 같은 표다. 따로 적으면 창은 보여 주는데 서버가 거절하는 날이 온다.
 *
 * → `{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }`
 */
export function screenshotPickerAccept(): Record<string, string[]> {
  const accept: Record<string, string[]> = {};
  for (const extension of ATTACHMENT_EXTENSIONS) {
    const mimeType = canonicalMimeTypeForExtension(extension);
    if (mimeType === null) continue;
    const extensions = accept[mimeType] ?? [];
    extensions.push(`.${extension}`);
    accept[mimeType] = extensions;
  }
  return accept;
}

/**
 * 창을 열 때 주는 값. `excludeAcceptAllOption` 은 주지 않는다 — 지금 고르기 칸의
 * `accept` 도 「모든 파일」로 바꿀 수 있고, 거기서 이상한 것을 골라도
 * screenScreenshotBatch 와 서버가 거절한다. 두 갈래를 같게 두는 쪽이 낫다.
 */
export function screenshotFilePickerOptions(): ScreenshotFilePickerOptions {
  return {
    multiple: true,
    // 🔴 id 는 주지 않는다(위 머리말). 주는 순간 두 번째부터 사진 폴더가 아니다.
    startIn: "pictures",
    types: [{ description: ATTACHMENT_FORMAT_TEXT, accept: screenshotPickerAccept() }],
  };
}

/** 고른 결과 — 규격은 File 이 아니라 손잡이를 준다. 쓰는 것만 적는다. */
export type PickedFileHandle = { getFile(): Promise<File> };

export type OpenFilePicker = (
  options: ScreenshotFilePickerOptions,
) => Promise<readonly PickedFileHandle[]>;

/**
 * 이 브라우저에 새 갈래가 있는가. 있으면 **부를 수 있는 모양으로** 돌려주고, 없으면
 * null — 부르는 쪽은 null 이면 지금까지의 `<input type="file">` 로 간다.
 *
 * 없는 자리가 실제로 있다: 이 API 는 보안 컨텍스트(https · localhost)에만 있고
 * 크로미움 계열에만 있다. 개발 주소 `http://192.168.x.x:3500` 은 보안 컨텍스트가
 * 아니라 없다 — 거기서도 스크린샷을 붙일 수 있어야 한다.
 *
 * 🔴 window 에 묶어 돌려준다. 떼어 내 부르면 크로미움이 Illegal invocation 을
 * 던진다(전역 함수를 this 없이 부른 것이 된다).
 */
export function getOpenFilePicker(target: unknown): OpenFilePicker | null {
  if (typeof target !== "object" || target === null) return null;
  const picker = (target as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  if (typeof picker !== "function") return null;
  return (picker as OpenFilePicker).bind(target);
}

/**
 * 사람이 창을 그냥 닫았는가. 규격은 이때 `AbortError` 를 던진다 — **오류가 아니다.**
 * 조용히 아무 일도 없던 것처럼 끝내고 콘솔에도 남기지 않는다(창을 닫은 사람에게
 * 빨간 줄을 보여 줄 까닭이 없다).
 *
 * `instanceof DOMException` 으로 보지 않는 것은 그 이름이 브라우저마다 같지 않을 수
 * 있어서다 — 규격이 못 박는 것은 `name` 이다.
 */
export function isFilePickerAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { name?: unknown }).name === "AbortError";
}

/* ------------------------------------------------------------------ */
/* 이름 짓기                                                            */
/* ------------------------------------------------------------------ */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDD-HHmmss`(KST). 한국은 서머타임이 없어 +9시간을 더해 UTC 로 읽으면 된다. */
export function kstFileStamp(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return (
    `${kst.getUTCFullYear()}${pad2(kst.getUTCMonth() + 1)}${pad2(kst.getUTCDate())}` +
    `-${pad2(kst.getUTCHours())}${pad2(kst.getUTCMinutes())}${pad2(kst.getUTCSeconds())}`
  );
}

/**
 * 이미지 MIME → 확장자. png → `png`, jpeg → `jpg`(서버가 둘 다 받는다). 그 밖의
 * 이미지는 MIME 의 뒤쪽을 그대로 쓴다(`image/gif` → `gif`) — 사전 검사가 형식
 * 까닭으로 거절하도록 **이름에 무엇이었는지를 남긴다.**
 */
export function screenshotExtensionForMime(mimeType: string): string {
  const type = mimeType.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return "jpg";
  const subtype = type.startsWith("image/")
    ? type.slice("image/".length).replace(/[^a-z0-9]/g, "")
    : "";
  return subtype.length > 0 ? subtype.slice(0, 16) : "img";
}

/**
 * 브라우저가 붙인 자리표시 이름인가 — 비었거나 `image.png` 꼴. 화면을 캡처해
 * 붙여넣으면 브라우저는 이런 이름을 준다. 탐색기에서 파일을 복사해 붙여넣은
 * 경우처럼 **사람이 붙인 이름**이면 거짓이다 — 그 이름은 그대로 둔다.
 */
export function isPlaceholderPastedName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || /^image\.[a-z0-9]+$/i.test(trimmed);
}

/** 붙여넣은 이미지의 새 이름 — `스크린샷-YYYYMMDD-HHmmss-N.확장자`(KST, N 은 1부터). */
export function pastedScreenshotName(mimeType: string, now: Date, sequence: number): string {
  return `스크린샷-${kstFileStamp(now)}-${sequence}.${screenshotExtensionForMime(mimeType)}`;
}

/**
 * 붙여넣은 이미지 한 장에 이름을 붙인다. 자리표시 이름이면 새로 짓고(확장자는
 * MIME 으로), 사람이 붙인 이름이면 그 파일을 그대로 돌려준다. 바이트는 건드리지
 * 않는다.
 */
export function nameScreenshotFile(file: File, now: Date, sequence: number): File {
  if (!isPlaceholderPastedName(file.name)) return file;
  return new File([file], pastedScreenshotName(file.type, now, sequence), {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/* ------------------------------------------------------------------ */
/* 한 묶음 거르기                                                        */
/* ------------------------------------------------------------------ */

export type ScreenshotRejection = { fileName: string; reason: string };

export type ScreenshotBatch<T> = {
  /** 받은 것 — 고른 차례 그대로. */
  accepted: T[];
  /** 사전 검사에 걸린 것, 까닭과 함께. */
  rejected: ScreenshotRejection[];
  /** 검사는 통과했지만 다섯 장을 넘어 받지 못한 장 수. */
  overflowCount: number;
};

/**
 * 고르거나 붙여넣은 한 묶음을 거른다 — 한 장씩 사전 검사하고, 통과한 것 가운데
 * 남은 자리만큼만 앞에서부터 받는다. 검사에 걸린 장은 자리를 차지하지 않는다.
 *
 * 한 장이 틀렸다고 나머지까지 거절하지 않는다 — 다섯 장을 골랐는데 한 장이
 * 20MB 를 넘는다고 넷을 다시 고르게 하면 아무도 스크린샷을 붙이지 않는다.
 */
export function screenScreenshotBatch<T extends { name: string; size: number }>(
  files: readonly T[],
  liveCount: number,
): ScreenshotBatch<T> {
  const valid: T[] = [];
  const rejected: ScreenshotRejection[] = [];
  for (const file of files) {
    const reason = checkAttachmentFile(file);
    if (reason === null) valid.push(file);
    else rejected.push({ fileName: file.name, reason });
  }
  const room = improvementRequestScreenshotRoomLeft(liveCount);
  return {
    accepted: valid.slice(0, room),
    rejected,
    overflowCount: Math.max(0, valid.length - room),
  };
}

/**
 * `이름: 까닭 · 이름: 까닭`. 서버 문구는 마침표로 끝나므로 끝의 마침표를 떼어
 * 잇는다 — 그대로 두면 문장 안에서 「넘습니다. · …」, 끝에서 「넘습니다..」가 된다.
 */
export function formatScreenshotRejections(rejections: readonly ScreenshotRejection[]): string {
  return rejections
    .map((rejection) => `${rejection.fileName}: ${rejection.reason.trim().replace(/\.+$/, "")}`)
    .join(" · ");
}

/** 한 묶음에서 받지 못한 것을 한 문장으로. 다 받았으면 null. */
export function screenshotBatchNotice(batch: {
  rejected: readonly ScreenshotRejection[];
  overflowCount: number;
}): string | null {
  const parts: string[] = [];
  if (batch.rejected.length > 0) {
    parts.push(`받지 않은 파일 — ${formatScreenshotRejections(batch.rejected)}`);
  }
  if (batch.overflowCount > 0) {
    parts.push(
      `${IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE} ${batch.overflowCount}장은 넣지 못했습니다.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/* ------------------------------------------------------------------ */
/* 문구 · 주소                                                          */
/* ------------------------------------------------------------------ */

/** 입력 상자 밑에 늘 보이는 안내. 수와 형식은 전부 도메인에서 온다. */
export const SCREENSHOT_HINT_TEXT = `${ATTACHMENT_FORMAT_TEXT}, 장당 ${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)} · 내용 칸에 Ctrl+V 로 붙여넣어도 됩니다`;

/** 「스크린샷 올리는 중 2/3…」 — `current` 는 지금 보내는 장의 차례(1부터). */
export function screenshotUploadProgressText(current: number, total: number): string {
  return `스크린샷 올리는 중 ${current}/${total}…`;
}

export function screenshotCountText(count: number): string {
  return `스크린샷 ${count}/${IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT}`;
}

/**
 * 새 글은 등록됐는데 스크린샷 일부를 못 올렸을 때 남기는 문구. 글은 이미 목록에
 * 있으므로 입력칸은 비우고, 무엇을 왜 못 올렸는지와 다시 붙이는 길을 알린다.
 */
export function createdWithScreenshotFailuresText(
  total: number,
  failures: readonly ScreenshotRejection[],
): string {
  return (
    `글은 등록됐습니다. 스크린샷 ${total}장 중 ${failures.length}장을 올리지 못했습니다 — ` +
    `${formatScreenshotRejections(failures)}. 목록의 [스크린샷 추가]로 다시 붙일 수 있습니다.`
  );
}

/** 글 지우기 확인창에 더하는 한 줄. 스크린샷이 없으면 null. */
export function deleteRequestScreenshotNotice(count: number): string | null {
  return count > 0 ? `붙은 스크린샷 ${count}장도 함께 지워집니다.` : null;
}

/**
 * 스크린샷 하나를 보는 주소. 글 id 와 첨부 id 가 **함께** 들어간다 — 통로가 그
 * 짝으로 찾기 때문이다(api/…/attachments/[attachmentId]/route.ts).
 */
export function screenshotUrl(improvementRequestId: string, attachmentId: string): string {
  return `/api/improvement-requests/${encodeURIComponent(improvementRequestId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** 올리기 통로. 본문은 파일 바이트 그대로이고 이름은 쿼리 문자열이다(multipart 아님). */
export function screenshotUploadUrl(improvementRequestId: string, fileName: string): string {
  const query = new URLSearchParams({ fileName });
  return `/api/improvement-requests/${encodeURIComponent(improvementRequestId)}/attachments?${query.toString()}`;
}
