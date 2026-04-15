import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UIPE — See the web the way humans do",
  description:
    "A perception layer for autonomous agents. Fuse DOM, accessibility, vision, and time into a single scene graph. Drop into any MCP-native agent.",
  metadataBase: new URL("https://uipe.dev"),
  openGraph: {
    title: "UIPE — See the web the way humans do",
    description:
      "A perception layer for autonomous agents. Drop into any MCP-native agent.",
    url: "https://uipe.dev",
    siteName: "UIPE",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
