import { z } from "zod";
import { ShopError, shop } from "@/lib/store";

export const runtime = "nodejs";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), product_id: z.string(), quantity: z.number().int(), revision: z.number().int() }),
  z.object({ action: z.literal("remove"), product_id: z.string() }),
]);

export async function POST(request: Request) {
  try {
    const input = command.parse(await request.json());
    const state = input.action === "add" ? shop().add(input.product_id, input.quantity, input.revision)
      : shop().remove(input.product_id);
    return Response.json(state);
  } catch (error) {
    if (error instanceof ShopError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 409 });
    }
    return Response.json({ error: "invalid_request", message: "Invalid cart request" }, { status: 400 });
  }
}
