import {
  countImprovementRequestBodyChars,
  IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
} from "@/lib/domain/improvement-request";
import { isMenuKeyOf, isServiceKey } from "@/lib/domain/service-catalog";

/**
 * ============================================================================
 * 개선요청 입력 검증 — 형식만 본다
 * ============================================================================
 * **DB 도 세션도 여기서 만지지 않는다.** 누가 적고 옮길 수 있는가는 정책이라 서버
 * 액션이, 동시 수정(version)은 자료의 문제라 저장(mutation)이 맡는다.
 *
 * ── 🔴 여기가 유일한 문이다 ────────────────────────────────────────────
 * service_key · menu_key 에는 DB CHECK 가 없다(db/schema.ts 머리말의 '서비스·메뉴에
 * CHECK 도 참조 표도 두지 않는다'). 그래서 **적어 둔 목록에 없는 열쇠를 막는 곳은
 * 이 파일 하나**다. 서버 액션이 부르고, 저장(mutation)도 트랜잭션 전에 같은 함수를
 * 한 번 더 부른다 — 액션을 거치지 않는 길(시험 · 나중의 이관 스크립트)로 아무
 * 글자나 들어오지 않게.
 *
 * ── 메뉴는 고르지 않아도 된다 ──────────────────────────────────────────
 * 어느 화면인지 모를 수 있고(「로그인이 가끔 풀려요」), 메뉴가 아예 없는 서비스도
 * 있다(「일하는 방식」). 빈 값·없음·null 을 전부 「고르지 않았다」(null)로 본다 —
 * HTML `<select>` 의 첫 칸은 빈 문자열로 오고, 서버 액션이 JSON 으로 받을 때는
 * undefined 로 온다. 셋을 다르게 다루면 같은 뜻이 다른 결과를 낸다.
 *
 * ── 🔴 메뉴는 **고른 서비스와 짝으로** 본다 ─────────────────────────────
 * 메뉴 열쇠는 서비스 안에서만 유일하다(service-catalog.ts). 짝으로 보지 않으면
 * A/S 의 `users` 를 고른 채 서비스만 계측기로 바꾼 값이 통과한다.
 *
 * 서비스가 틀렸으면 메뉴는 **판정하지 않는다** — 어느 목록으로 봐야 할지 모르는
 * 상태에서 「고를 수 있는 메뉴가 아닙니다」라고 말하면, 고친 뒤에도 같은 말을 한
 * 번 더 듣게 된다. 서비스 오류만 돌려주고 메뉴는 그대로 둔다.
 *
 * ── 본문은 비울 수 없고 2000자를 넘을 수 없다 ────────────────────────────
 * 앞뒤 공백을 걷은 뒤에 센다. 상한은 도메인의 IMPROVEMENT_REQUEST_BODY_MAX_CHARS
 * 하나이고, 스키마의 CHECK 와 같은 수인지는 시험이 대조한다. 글자는 코드 포인트로
 * 센다 — DB 의 char_length 와 같은 방식이다.
 *
 * ── 줄바꿈은 LF 로 통일한다 ─────────────────────────────────────────────
 * 폼으로 보낸 여러 줄 글은 줄바꿈이 CRLF 로 온다. 입력칸은 줄바꿈을 한 글자로
 * 세는데 CRLF 그대로 저장하면 두 글자가 되어, 화면에서 2000자에 맞춘 글이 서버에서
 * 넘친다고 거절된다. 그래서 세기 전에 LF 로 바꾼다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 필드명 그대로이고, 화면은 그 키로 입력칸 밑에 문장을 붙인다.
 * 🔴 **오류 문장에 받은 값을 싣지 않는다** — 본문은 자유 입력이라 PII 가 섞일 수
 * 있고(db/schema.ts 의 PII 절), 열쇠는 무엇이 올지 모르는 값이다.
 *
 * ── 오류는 한꺼번에 돌려준다 ────────────────────────────────────────────
 * 하나씩 알려 주면 고쳐 보낸 뒤에 한 번 더 거절된다.
 * ============================================================================
 */

export type ImprovementRequestFields = {
  /** 앞뒤 공백을 걷고 줄바꿈을 LF 로 통일한 본문. 비어 있지 않다. */
  body: string;
  /** 적어 둔 목록에 있는 서비스 열쇠. */
  serviceKey: string;
  /** 그 서비스에 속한 메뉴 열쇠, 또는 null(고르지 않음). */
  menuKey: string | null;
};

export type ValidateImprovementRequestResult =
  | { ok: true; data: ImprovementRequestFields }
  | { ok: false; fieldErrors: Record<string, string> };

/** 빈 값·없음·null 은 모두 「고르지 않았다」(파일 머리말). */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function validateImprovementRequestFields(
  raw: Record<string, unknown>
): ValidateImprovementRequestResult {
  const fieldErrors: Record<string, string> = {};

  // ── 본문 ────────────────────────────────────────────────────────────
  let body = "";
  const bodyRaw = raw.body;
  if (typeof bodyRaw !== "string") {
    fieldErrors.body = "내용을 확인할 수 없습니다.";
  } else {
    body = bodyRaw.replace(/\r\n?/g, "\n").trim();
    if (body === "") {
      fieldErrors.body = "내용을 입력해 주세요.";
    } else if (countImprovementRequestBodyChars(body) > IMPROVEMENT_REQUEST_BODY_MAX_CHARS) {
      fieldErrors.body = `내용은 ${IMPROVEMENT_REQUEST_BODY_MAX_CHARS}자를 넘을 수 없습니다.`;
    }
  }

  // ── 서비스 ──────────────────────────────────────────────────────────
  const serviceKeyRaw = raw.serviceKey;
  const serviceOk = isServiceKey(serviceKeyRaw);
  if (isBlank(serviceKeyRaw)) {
    fieldErrors.serviceKey = "어느 시스템 이야기인지 골라 주세요.";
  } else if (!serviceOk) {
    fieldErrors.serviceKey = "고를 수 있는 시스템이 아닙니다. 다시 골라 주세요.";
  }

  // ── 메뉴 (고르지 않아도 된다) ────────────────────────────────────────
  const menuKeyRaw = raw.menuKey;
  let menuKey: string | null = null;
  if (!isBlank(menuKeyRaw)) {
    // 서비스를 모르면 메뉴를 판정할 목록이 없다 — 파일 머리말의 '서비스가
    // 틀렸으면 메뉴는 판정하지 않는다'.
    if (serviceOk) {
      if (isMenuKeyOf(serviceKeyRaw, menuKeyRaw)) {
        menuKey = menuKeyRaw;
      } else {
        fieldErrors.menuKey = "그 시스템의 메뉴가 아닙니다. 다시 골라 주세요.";
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // serviceOk 가 참이므로 문자열이다. 타입 좁히기를 위해 한 번 더 확인한다.
  return {
    ok: true,
    data: { body, serviceKey: serviceKeyRaw as string, menuKey },
  };
}
