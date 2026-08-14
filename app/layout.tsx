import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURA：双核协议",
  description: "以实体 AURA 机器人为棋子的开放式桌游数字孪生控制台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
