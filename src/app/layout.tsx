import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
/*
 * 머리말 위 서비스 오가기 띠(@dss/ui)의 생김새. 그 조각은 CSS 를 스스로 부르지
 * 않는다 — 그러면 번들러 없이는 부를 수 없게 되어 그쪽 시험이 깨진다(그쪽
 * README 3절). 그래서 쓰는 쪽이 한 번 부른다.
 *
 * 규칙은 전부 .dss-menu 아래에만 있고, 띠는 목록이 있을 때만 그려진다
 * ((app)/layout.tsx). 로그인 화면에 이 줄이 닿아도 바뀌는 것은 없다.
 */
import "@dss/ui/styles.css";

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
