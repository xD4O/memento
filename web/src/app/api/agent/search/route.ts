import { NextRequest, NextResponse } from "next/server";
import { hybridSearch } from "@/lib/search";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { hits } = await hybridSearch(String(body.query ?? ""));
  return NextResponse.json({
    results: hits.slice(0, 8).map((h) => ({
      sol: h.sol,
      title: h.title,
      when: h.recorded_at,
      at_seconds: Math.floor(h.t_start),
      text: h.text,
    })),
  });
}
