import type { ReactNode } from "react";

import { logoutAction } from "@/app/actions/auth";
import type { WebUser } from "@/lib/db/schema";

/**
 * 머리말.
 *
 * 서버 컴포넌트다 — "use client" 를 붙이지 않는다. 로그아웃은 서버 액션을
 * 부르는 평범한 <form> 이라 자바스크립트 없이도 동작한다. 사내망에서
 * 스크립트가 늦게 붙는 동안 눌러도 제대로 나가진다.
 *
 * 「통합 로그인으로」 버튼은 포털 앱 런처로 간다. 로그아웃과 다르다 —
 * 세션을 끊지 않으므로 돌아오면 그대로 들어와 있다.
 *
 * ── 🔴 이 한 줄에 무엇이 들어가나 (2026-09-18) ───────────────────────────
 * 한때 사내 시스템 오가기 메뉴바는 이 머리말 **위**에 회색 띠로 따로 앉아
 * 있었다. 화면 맨 위가 두 층이 되어 답답하고 본문이 한 줄만큼 줄어든다는
 * 사용자 지적으로 그 띠를 이 줄 **안**으로 들였다(@dss/ui README 3절의
 * variant="inline"). 그래서 이 줄은 이제 넷을 담는다:
 *
 *   시스템 이름 · 오가기 메뉴바 · 사용자명(+관리자) · 나가는 단추 둘
 *
 * 🔴 폰(360px)에서 그 넷이 다 들어가지 않는다. 실제 폭(글자 14px, 한글은
 * 한 자가 1em):
 *
 *   바깥 여백 px-4 를 뺀 속폭                                    328px
 *   ─────────────────────────────────────────────────────────────────
 *   시스템 이름 "DSS 개선요청" (16px)                          ~101px
 *   사용자명 3글자 + 「관리자」 뱃지                             ~96px
 *   「통합 로그인으로」  글자 102 + px-3 24 + 테두리 2          ~128px
 *   「로그아웃」          글자  56 + px-3 24 + 테두리 2          ~82px
 *   사이 여백 gap-4 + gap-3 두 번                                 40px
 *   ─────────────────────────────────────────────────────────────────
 *   합                                                          ~447px
 *
 * 메뉴바를 넣기 **전에 이미** 119px 넘친다 — 지금은 단추 글자가 두 줄로
 * 접혀 머리말이 두꺼워지는 것으로 버티고 있을 뿐이다. 여기에 메뉴바를 그냥
 * 끼우면 남는 자리가 0 이라 **폰에서 메뉴가 아예 보이지 않는다.**
 *
 * 그래서 폰에서는 **글자만 알려 주는 두 덩이**를 눈에서 감춘다 — 시스템
 * 이름과 사용자명이다. 둘 다 눌러서 갈 곳이 없는 정보고, 감추면 ~101 + 96 +
 * 여백 = ~213px 이 메뉴바 몫으로 돌아와 **~90px** 이 된다(아이콘 칸 하나가
 * ~40px 이니 둘이 온전히 보이고 나머지는 그 안에서 굴러간다).
 *
 * 🔴 「통합 로그인으로」와 「로그아웃」은 감추지 않는다 — 그 둘 말고 이
 * 사이트를 떠날 길이 없다. 폰에서 가장 넓은 자리를 먹는 것이 그 둘이지만,
 * 나가는 길을 화면 밖으로 밀어내는 것보다 메뉴가 굴러가는 편이 낫다.
 *
 * 🔴 감추는 방식은 `sr-only` 이지 `hidden` 이 **아니다** — 마크업에 그대로
 * 남아 화면 낭독기는 여전히 "DSS 개선요청" 과 사용자명을 읽는다. 게다가
 * sr-only 는 position:absolute 라 flex 항목에서 통째로 빠진다 — 폭뿐 아니라
 * 앞뒤 여백까지 함께 메뉴바로 간다.
 *
 * 🔴 감춰도 어디인지 알 수 있다: 본문 맨 위에 화면 이름이
 * <h1 class="text-2xl"> 로 크게 있고(ImprovementRequestsScreen), 메뉴바의
 * 「지금 여기」 2px 밑줄은 폰에서도 그대로 남는다.
 *
 * 🔴 기준점은 `md:`(=768px) 하나다 — @dss/ui 가 칸에서 이름을 감추는 기준과
 * 같은 값이라야 그 사이 폭에서 「이름은 없는데 메뉴는 글자」인 어정쩡한
 * 상태가 생기지 않는다(service-menu.css 의 `not all and (min-width: 768px)`).
 */
export function AppHeader({
  user,
  portalUrl,
  serviceMenu = null,
}: {
  user: WebUser;
  portalUrl: string;
  /**
   * 사내 시스템 오가기 목록(@dss/ui 의 ServiceMenuBar). (app)/layout.tsx 가
   * 서버에서 만들어 내려보내고, 이 머리말이 **이름과 사용자명 사이**에 그린다.
   *
   * 조각이 아니라 **다 그려진 노드**를 받는 이유: 이 파일이 @dss/ui 도, 목록을
   * 어디서 구하는지도 몰라야 한다. 그리는 자리만 여기가 정한다(아래
   * `min-w-0 flex-1` 한 겹 — 그것이 이 줄의 선을 지키는 장치다).
   * 목록이 비면 그 조각이 스스로 null 이라 빈 칸만 남고 아무것도 안 보인다.
   */
  serviceMenu?: ReactNode;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 py-3">
        {/*
          시스템 이름. 폰(<768px)에서는 **눈에서만** 감춘다 — 왜인지는 이 파일
          머리말의 폭 계산에 있다. 낭독기에는 그대로 남고, 본문 맨 위에는 화면
          이름이 큰 글씨로 따로 있다.
        */}
        <h1 className="sr-only text-base font-semibold text-slate-900 md:not-sr-only">
          DSS 개선요청
        </h1>

        {/*
          사내 시스템 오가기 목록. 이름 다음, 사용자명 앞 — 넓은 화면에서
          통째로 비어 있던 가운데 자리다.

          🔴 `min-w-0 flex-1` 두 낱말이 이 줄의 선을 지킨다: `flex-1` 은 기준
          폭 0 + 남는 자리 다 갖기라, 이름·사용자명·단추 둘이 제 폭을 먼저
          가져간 **뒤에 남은 만큼만** 차지한다. `min-w-0` 은 안의 목록이 길어도
          이 칸이 제 내용 폭까지 부풀지 못하게 막는다 — 그 둘이 없으면 목록이
          길어질 때 오른쪽 「로그아웃」부터 화면 밖으로 밀려난다. 목록은 제
          안에서 가로로 굴러간다(@dss/ui 의 `.dss-menu__list { overflow-x: auto }`).
        */}
        <div className="min-w-0 flex-1">{serviceMenu}</div>

        <div className="flex items-center gap-3 text-sm">
          {/*
            누구로 들어와 있는지. 폰에서는 **눈에서만** 감춘다(위와 같은 이유) —
            눌러서 갈 곳이 없는 정보라 좁은 화면에서 가장 먼저 내줄 자리다.
            낭독기는 그대로 읽으므로 「내가 누구로 들어와 있나」를 확인할 길은
            남는다.
          */}
          <span className="sr-only text-slate-600 md:not-sr-only">
            {user.displayName}
            {user.role === "ADMIN" && (
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                관리자
              </span>
            )}
          </span>

          {/* 🔴 아래 둘은 폰에서도 감추지 않는다 — 이 사이트를 떠나는 유일한 길이다. */}
          <a
            href={portalUrl}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            통합 로그인으로
          </a>

          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
