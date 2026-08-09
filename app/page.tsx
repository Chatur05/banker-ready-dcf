import type { Metadata } from "next";
import { DcfWorkbench } from "./components/DcfWorkbench";

export const metadata: Metadata = {
  title: "Banker Ready DCF",
  description: "A provenance-first public-equity DCF engine built for audit, not applause.",
};

export default function Home() {
  return <DcfWorkbench />;
}
