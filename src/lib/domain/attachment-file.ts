/**
 * ============================================================================
 * 첨부 파일의 형식과 크기 — 바깥에서 들어오는 바이트를 판정하는 순수 규칙
 * ============================================================================
 * DB 도 서버도 next 도 만지지 않는다. 화면(사전 검사)과 올리기 통로(진짜 관문)가
 * **같은 함수**를 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적으면 화면은 받는데
 * 서버가 거절하는(또는 그 반대의) 날이 온다. 실제 파일 없이 전부 시험된다.
 *
 * ── 🔴 확장자도 Content-Type 도 증거가 아니다 ──────────────────────────
 * 둘 다 **사람이 마음대로 적을 수 있는 값**이다. `bad.exe` 를 `shot.png` 로 이름만
 * 바꾸면 확장자도 브라우저가 붙이는 MIME 도 「PNG 입니다」라고 말한다. 그래서 실제로
 * 저장하기 전에 **파일 앞머리 바이트**(magic bytes)를 확장자가 주장하는 형식과
 * 대조한다(isContentCompatibleWithExtension). 이것이 형식 관문의 본체이고, 확장자
 * 검사는 그 앞의 값싼 거르개일 뿐이다.
 *
 * 이것은 악성코드 검사가 아니다 — 여기서 막는 것은 「형식을 속인 파일」까지다.
 *
 * ── 셋만 받는다 ────────────────────────────────────────────────────────
 * png · jpg · jpeg. 개선요청에 붙는 것은 화면 사진뿐이라 문서·압축·펌웨어를 받을
 * 이유가 없다. 받는 형식이 적을수록 대조할 서명이 분명해지고, 「이 확장자는 어떤
 * 바이트로 시작하는가」를 모르는 채 통과시키는 일이 없다.
 *
 * webp 를 넣지 않은 것은 지금 필요가 없어서다. 넣을 일이 생기면 아래 두 곳(확장자
 * 목록과 서명표)을 함께 고쳐야 한다 — 한쪽만 고치면 이름은 받는데 내용 대조에서
 * 전부 거절되는(또는 그 반대의) 상태가 된다.
 *
 * ── 🔴 크기 상한은 여기 한 곳이다 ──────────────────────────────────────
 * 20MB. 이 수는 db/schema.ts 의 `improvement_request_attachments_file_size` CHECK 와
 * 같아야 하고, 시험(db/schema-domain-parity.test.ts)이 스키마 파일의 글자를 읽어
 * 대조한다. 실제로 세는 곳은 **디스크로 흘려보내며 센 바이트**다
 * (storage/attachment-storage.ts 의 writeTemp) — 브라우저가 보낸 Content-Length 는
 * 빠른 거절에만 쓴다.
 * ============================================================================
 */

/**
 * 한 장의 크기 상한(바이트).
 *
 * 🔴 db/schema.ts 의 `improvement_request_attachments_file_size` CHECK 와 같은
 * 수여야 한다. 스키마는 아무것도 import 하지 않으므로(그 파일 머리말) 수가 두 번
 * 적히고, 갈라지지 않는지는 시험이 대조한다.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * 받는 확장자 — 소문자, 점 없음. 차례는 사람에게 보이는 문구
 * (ATTACHMENT_FORMAT_TEXT)의 차례이기도 하다.
 */
export const ATTACHMENT_EXTENSIONS = ["png", "jpg", "jpeg"] as const;
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

/** 사람에게 보이는 형식 문구. 화면과 서버의 거절 문구가 같은 말을 하게 한다. */
export const ATTACHMENT_FORMAT_TEXT = "png · jpg · jpeg";

/** 파일 고르기 칸의 accept. 받는 셋의 MIME 이다(이것은 편의이지 관문이 아니다). */
export const ATTACHMENT_FILE_ACCEPT = "image/png,image/jpeg";

/** 원본 파일 이름의 길이 상한. DB 칸에만 들어가고 경로에는 쓰이지 않는다. */
export const MAX_ORIGINAL_FILE_NAME_LENGTH = 255;

/**
 * 대조에 쓰는 앞머리 바이트 수.
 *
 * PNG 서명이 8바이트, JPEG 가 3바이트라 그것만으로는 12면 넉넉하다. 64 로 넉넉히
 * 두는 것은 나중에 서명이 뒤쪽에 있는 형식(PDF 처럼)이 붙어도 이 상수를 고치느라
 * 저장소를 뒤지지 않게 하려는 것뿐이다 — 이 수를 줄이면 그때 조용히 판정이 바뀐다.
 */
export const CONTENT_SNIFF_BYTES = 64;

/**
 * 사람이 올린 이름에서 확장자만 뽑아 소문자로 정규화한다. 뽑을 수 없으면 null.
 *
 * 🔴 **여기가 경로 조작이 막히는 첫 자리다.** 점이 없거나, 마지막 점 뒤가 비었거나,
 * 영숫자가 아닌 글자가 섞였으면 null 이다. 그래서 `..`, `/`, `\`, 널 바이트, 윈도우
 * 예약 문자가 확장자로 둔갑해 디스크 경로를 만드는 일이 **애초에 불가능**하다.
 * 이름의 나머지는 어디에도 쓰이지 않는다(domain/attachment-path.ts 머리말).
 *
 * 소문자로 눕히는 것은 NAS 이식 때문이다 — Windows 는 `A.PNG` 와 `a.png` 를 같은
 * 파일로 보지만 Linux 컨테이너는 다른 파일로 본다. 섞인 채로 옮기면 **일부만**
 * 안 열린다.
 */
export function normalizeFileExtension(fileName: string): string | null {
  if (typeof fileName !== "string") return null;
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  // lastDot === 0 은 `.png` 같은 숨김 파일이다 — 이름이 없는 것과 같아 받지 않는다.
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return null;
  const extension = trimmed.slice(lastDot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) return null;
  return extension;
}

/** 받는 확장자인가. */
export function isAttachmentExtension(value: unknown): value is AttachmentExtension {
  return (
    typeof value === "string" && (ATTACHMENT_EXTENSIONS as readonly string[]).includes(value)
  );
}

/**
 * DB 의 mime_type 칸에 적을 값. **브라우저가 보낸 Content-Type 을 쓰지 않는다** —
 * 그 값은 올리는 쪽이 마음대로 정할 수 있어서, 그대로 저장하면 나중에 내려받기
 * 응답의 헤더가 올린 사람이 고른 타입으로 나간다. 확장자는 이미 셋으로 좁혀져
 * 있으므로 그 확장자의 정본 MIME 을 서버가 직접 고른다.
 */
export function canonicalMimeTypeForExtension(extension: string): string | null {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 앞머리 바이트 대조                                                    */
/* ------------------------------------------------------------------ */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** JPEG 는 SOI(FFD8) 다음 바이트가 언제나 마커 시작(FF)이다. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

/**
 * 🔴 **형식 관문의 본체.** 이 확장자의 파일이라면 앞머리가 이렇게 생겨야 한다 —
 * 아니면 거절한다. 받지 않는 확장자는 여기서도 거짓이다(앞 단계에서 이미 걸리지만,
 * 이 함수만 따로 불러도 열리지 않아야 한다).
 *
 * `header` 는 실제로 디스크로 흘려보낸 바이트의 앞부분이다 — 브라우저가 알려 준
 * 값이 아니다(storage/attachment-storage.ts 의 writeTemp 가 모은다).
 */
export function isContentCompatibleWithExtension(extension: string, header: Uint8Array): boolean {
  if (!isAttachmentExtension(extension)) return false;
  if (header.length === 0) return false;
  if (extension === "png") return startsWith(header, PNG_MAGIC);
  return startsWith(header, JPEG_MAGIC);
}

/* ------------------------------------------------------------------ */
/* 사람이 읽는 거절 문구                                                 */
/* ------------------------------------------------------------------ */

export const FORMAT_REJECTION_TEXT = `${ATTACHMENT_FORMAT_TEXT} 만 올릴 수 있습니다`;
export const CONTENT_MISMATCH_TEXT =
  "파일 내용이 확장자와 맞지 않습니다. 이름만 바꾼 파일은 올릴 수 없습니다.";
export const EMPTY_FILE_TEXT = "빈 파일";

export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)}MB`;
}

export const TOO_LARGE_TEXT = `파일이 ${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)}를 넘습니다.`;

/**
 * 한 장을 보내기 전에 거른다 — 형식 → 빈 파일 → 크기. 틀리면 사람이 읽을 까닭,
 * 맞으면 null.
 *
 * 🔴 **이것은 편의이지 관문이 아니다.** 여기서 보는 것은 이름의 확장자와 브라우저가
 * 알려 준 크기뿐이라 둘 다 속일 수 있다. 진짜 판정은 올리기 통로가 **파일 내용과
 * 흘려보낸 바이트**로 다시 한다. 이 함수의 값은 20MB 를 다 보내고 나서 거절당하지
 * 않게 해 주는 것뿐이다.
 */
export function checkAttachmentFile(file: { name: string; size: number }): string | null {
  const extension = normalizeFileExtension(file.name);
  if (!extension || !isAttachmentExtension(extension)) return FORMAT_REJECTION_TEXT;
  if (file.size === 0) return EMPTY_FILE_TEXT;
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)} 초과 (${formatMegabytes(file.size)})`;
  }
  return null;
}
