import { NextRequest, NextResponse } from "next/server";
import { hybridSearch } from "@/lib/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  return NextResponse.json(await hybridSearch(q));
}
