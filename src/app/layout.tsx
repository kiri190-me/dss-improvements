import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

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
