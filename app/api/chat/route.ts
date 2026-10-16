import { chatHandler } from "@/lib/chat";
import { shop } from "@/lib/store";

export const runtime = "nodejs";
export const POST = chatHandler(shop);
