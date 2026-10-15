import { ShopError, shop } from "@/lib/store";

export const runtime = "nodejs";

export function POST() {
  try { return Response.json(shop().checkout()); }
  catch (error) {
    if (error instanceof ShopError) {
      return Response.json({ error: error.code, message: error.message }, { status: 409 });
    }
    return Response.json({ error: "internal", message: "Checkout failed" }, { status: 500 });
  }
}
