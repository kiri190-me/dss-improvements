import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { canViewImprovementRequests } from "@/lib/auth/improvement-request-authorization";
import { getImprovementRequestAttachmentFile } from "@/lib/db/queries/improvement-request-attachments";
import { AttachmentNotStoredError, getAttachmentStorage } from "@/lib/storage/attachment-storage";

/**
 * ============================================================================
 * GET /api/improvement-requests/{id}/attachments/{attachmentId} — 스크린샷 보기
 * ============================================================================
 * 화면의 `<img src>` 가 부르는 주소다. 썸네일을 따로 만들지 않으므로 목록의 작은
 * 그림도 크게 보기도 같은 통로를 탄다(아래 '썸네일을 만들지 않는다').
 *
 * ── 🔴 로그인한 사람만 ──────────────────────────────────────────────────
 * 이미지 주소는 브라우저 주소창에 그대로 붙여 넣을 수 있는 값이고, 화면 사진에는
 * 고객 이름·사내 자료가 그대로 찍혀 있다. 그래서 **매 요청 세션을 본다** — 첨부
 * id 를 아는 것은 권한이 아니다. 목록은 전 직원이 보므로(README 의 「정해진 것」)
 * 여기서 더 좁히지 않는다. 좁혀야 할 날이 오면 고칠 곳은 이 한 줄이다.
 *
 * ── 🔴 그 글의 것인지 DB 가 답한다 ─────────────────────────────────────
 * 주소에 글 id 와 첨부 id 가 함께 있고, 조회가 **둘을 짝으로** 찾는다
 * (queries/improvement-request-attachments.ts). 첨부 id 만으로 찾으면 남의 글의
 * 첨부를 아무 글 주소에 끼워 넣어도 열린다. 지워진 첨부와 지워진 글의 첨부도 같은
 * 조회가 함께 거른다.
 *
 * ── 🔴 응답 헤더는 서버가 정한다 ───────────────────────────────────────
 *  · Content-Type 은 DB 의 mime_type — **확장자에서 서버가 고른 정본**이지 올린
 *    쪽이 보낸 Content-Type 이 아니다(domain/attachment-file.ts).
 *  · `X-Content-Type-Options: nosniff` — 브라우저가 내용을 훔쳐보고 타입을 바꿔
 *    읽지 못하게. 이미지로 위장한 것이 스크립트로 실행되는 길을 막는다.
 *  · `Content-Disposition: inline` + `filename*` — 화면 안에 그리되, 저장할 때는
 *    원래 이름으로. 이름은 사람이 붙인 것이라 한글·공백이 섞이므로 RFC 5987 로
 *    적는다. 헤더에 줄바꿈이 섞이면 응답이 쪼개지므로 걷어 낸다.
 *  · `Cache-Control: private, no-store` — 로그인이 필요한 그림이라 공유 캐시나
 *    디스크에 남기지 않는다.
 *
 * ── 썸네일을 만들지 않는다 ──────────────────────────────────────────────
 * A/S 시스템은 브라우저가 줄인 JPEG 를 따로 올려 목록에 쓴다. 여기서는 원본을
 * 그대로 내려보내고 화면이 작게 그린다 — 한 글에 다섯 장, 상한 20MB 라 목록 한
 * 장이 감당할 수 있는 크기이고, 줄이는 통로를 더하면 「원본과 미리보기가 갈라지는」
 * 경우를 함께 다뤄야 한다. 목록이 무거워지면 그때 만들 일이다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 헤더에 넣을 수 있는 모양으로.
 *
 * 🔴 **거를 글자를 고르지 않고, 남길 글자를 고른다.** 줄바꿈 · 따옴표 · 역슬래시를
 * 하나씩 걷어 내는 방식은 빠뜨린 글자 하나가 그대로 구멍이 된다 — 줄바꿈이 섞이면
 * 응답이 쪼개지고, 따옴표는 `filename="…"` 의 울타리를 깬다. 그래서 옛 이름표
 * (`filename`)에는 영숫자와 `. _ -` 만 남긴다.
 *
 * 원래 이름은 뒤의 `filename*`(RFC 5987)이 들고 간다 — encodeURIComponent 가
 * 한글도, 위험한 글자도 전부 퍼센트 인코딩하므로 여기에는 그대로 넣어도 된다.
 * 요즘 브라우저는 `filename*` 쪽을 쓴다.
 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return fail(401, "로그인이 필요합니다.");
  if (!canViewImprovementRequests(actor.role)) return fail(403, "볼 권한이 없습니다.");

  const { id: improvementRequestId, attachmentId } = await context.params;
  // UUID 가 아니면 DB 에 묻지 않는다 — 형태가 아닌 값으로 질의하면 22P02 로 터진다.
  if (!UUID_PATTERN.test(improvementRequestId) || !UUID_PATTERN.test(attachmentId)) {
    return fail(404, "해당 스크린샷을 찾을 수 없습니다.");
  }

  const file = await getImprovementRequestAttachmentFile({ improvementRequestId, attachmentId });
  if (!file) return fail(404, "해당 스크린샷을 찾을 수 없습니다.");

  let stream;
  try {
    stream = await getAttachmentStorage().read(file.storedPath);
  } catch (error) {
    if (error instanceof AttachmentNotStoredError) {
      // 행은 있는데 파일이 없다. 사람에게는 「없다」가 맞는 말이고, 어디를 찾았는지는
      // 응답에 싣지 않는다.
      return fail(404, "파일을 찾을 수 없습니다.");
    }
    console.error("스크린샷 읽기 실패", { name: (error as Error)?.name });
    return fail(500, "파일을 읽는 중 문제가 발생했습니다.");
  }

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.fileSize),
      "Content-Disposition": contentDisposition(file.originalFileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
