import { ShopStore } from "../../lib/store";
const store = new ShopStore(process.argv[2]);
process.once("message", (message: any) => {
  try {
    const result =
      message.kind === "checkout"
        ? store.checkout(message.intent)
        : store.command(message.intent);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    store.close();
    process.disconnect();
  }
});
process.send?.({ ready: true });
