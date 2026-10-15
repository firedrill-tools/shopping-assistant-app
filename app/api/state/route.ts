import { shop } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(shop().state(), { headers: { "Cache-Control": "no-store" } });
}
