import type { Metadata } from "next";
import "./scout.css";
export const metadata: Metadata = {
  title: "RIDE JOB | PMAスカウト",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function ScoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="scout-app">{children}</div>;
}
