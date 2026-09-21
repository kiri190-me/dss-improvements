import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
/*
 * 머리말 **안**에 앉는 서비스 오가기 메뉴바(@dss/ui)의 생김새. 그 조각은 CSS 를
 * 스스로 부르지 않는다 — 그러면 번들러 없이는 부를 수 없게 되어 그쪽 시험이
 * 깨진다(그쪽 README 3절). 그래서 쓰는 쪽이 한 번 부른다.
 *
 * 규칙은 전부 .dss-menu 아래에만 있고, 메뉴바는 목록이 있을 때만 그려진다
 * ((app)/layout.tsx 가 AppHeader 의 serviceMenu 로 내려보낸다). 로그인 화면에
 * 이 줄이 닿아도 바뀌는 것은 없다.
 */
import "@dss/ui/styles.css";
/*
 * 머리말 오른쪽 끝에 앉는 알림 종(@dss/ui)의 생김새. 🔴 메뉴바의 styles.css 와
 * **다른 파일**이다 — 그 묶음은 조각마다 CSS 한 장이고, 한 장으로 묶으려면 CSS
 * 안에서 @import 를 해야 하는데 그것은 그쪽 시험이 막는다(README 7절).
 *
 * 규칙은 전부 .dss-bell 아래에만 있고, 종은 보여 줄 알림이 **있을 때만**
 * 그려진다(알림이 없으면 조각이 스스로 null 이다). 로그인 화면에 이 줄이 닿아도
 * 바뀌는 것은 없다 — 메뉴바 CSS 와 같은 자리·같은 이유다.
 */
import "@dss/ui/notification-bell.css";

export const metadata: Metadata = {
  // 포털 타일에 뜨는 이름과 같게 둔다 — 타일을 누르고 들어온 사람이
  // 탭 제목에서 같은 말을 봐야 같은 곳이라고 안다.
  title: "DSS 개선요청",
  description: "사내 시스템과 일하는 방식에 대한 개선 요청을 모으는 곳",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
