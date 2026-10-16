import { checkoutHandler } from "@/lib/checkout-api";
import { shop } from "@/lib/store";

export const runtime = "nodejs";
export const POST = checkoutHandler(shop);
