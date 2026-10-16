import { cartHandler } from "@/lib/cart-api";
import { shop } from "@/lib/store";
export const runtime = "nodejs";
export const POST = cartHandler(shop);
