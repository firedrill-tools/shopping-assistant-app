import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nook | Shopping assistant",
  description: "Synthetic home goods shopping assistant with a guarded cart",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
