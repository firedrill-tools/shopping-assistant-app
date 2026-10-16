import { cartCommandInput } from "./cart-contracts";
import { ShopError, type ShopStore } from "./store";

export function cartHandler(getStore: () => ShopStore) {
  return async (request: Request) => {
    let input;
    try {
      input = cartCommandInput.parse(await request.json());
    } catch {
      return Response.json(
        {
          error: "invalid_request",
          message:
            "A bag update requires an exact reviewed shop token and stable request ID",
        },
        { status: 400 },
      );
    }
    try {
      return Response.json(
        getStore().command(input, () => {
          if (request.signal.aborted)
            throw new ShopError(
              "cancelled",
              "Bag request was cancelled; recover its original request ID before another update",
            );
        }),
      );
    } catch (error) {
      if (error instanceof ShopError)
        return Response.json(
          { error: error.code, message: error.message },
          {
            status:
              error.code === "not_found"
                ? 404
                : error.code === "invalid_request" ||
                    error.code === "invalid_value"
                  ? 400
                  : 409,
          },
        );
      return Response.json(
        {
          error: "internal",
          message:
            "Bag update is uncertain; recover the original request before another update",
        },
        { status: 500 },
      );
    }
  };
}
