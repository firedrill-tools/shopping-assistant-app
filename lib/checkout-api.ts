import { z } from "zod";
import { ShopError, type ShopStore } from "./store";

const schema = z.strictObject({
  request_id: z.string().min(1).max(100),
  expected_cart_token: z.string().regex(/^[a-f0-9]{64}$/),
});

export function checkoutHandler(getStore: () => ShopStore) {
  return async function POST(request: Request) {
    let input: z.infer<typeof schema>;
    try {
      input = schema.parse(await request.json());
    } catch {
      return Response.json(
        {
          error: "invalid_request",
          message:
            "Checkout requires the reviewed bag token and a stable request ID",
        },
        { status: 400 },
      );
    }
    try {
      return Response.json(
        getStore().checkout(input, () => {
          if (request.signal.aborted)
            throw new ShopError(
              "cancelled",
              "Checkout request was cancelled; inspect its original request ID before retrying",
            );
        }),
      );
    } catch (error) {
      if (error instanceof ShopError)
        return Response.json(
          { error: error.code, message: error.message },
          {
            status:
              error.code === "invalid_request" || error.code === "invalid_value"
                ? 400
                : 409,
          },
        );
      return Response.json(
        {
          error: "internal",
          message:
            "Checkout result is uncertain; inspect the original request ID before retrying",
        },
        { status: 500 },
      );
    }
  };
}
