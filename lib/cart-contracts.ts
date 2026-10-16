import { z } from "zod";
const exactId = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value.trim() === value, "Exact ID required");
const base = {
  request_id: exactId,
  expected_shop_token: z.string().regex(/^[a-f0-9]{64}$/),
  product_id: exactId,
};
export const cartCommandInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("add"),
    ...base,
    quantity: z.number().int().min(1).max(10),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({ action: z.literal("remove"), ...base }),
]);
export type CartCommand = z.infer<typeof cartCommandInput>;
export function cartCommandKey(input: CartCommand) {
  return JSON.stringify(
    input.action === "add"
      ? {
          action: input.action,
          request_id: input.request_id,
          expected_shop_token: input.expected_shop_token,
          product_id: input.product_id,
          quantity: input.quantity,
          revision: input.revision,
        }
      : {
          action: input.action,
          request_id: input.request_id,
          expected_shop_token: input.expected_shop_token,
          product_id: input.product_id,
        },
  );
}

const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const cartEffect = z.strictObject({
  request_id: exactId,
  action: z.enum(["add", "remove"]),
  product_id: exactId,
  state_id: exactId,
  cart_id: z.literal("demo"),
  before_revision: nonnegative.min(1),
  after_revision: nonnegative.min(1),
  before_quantity: nonnegative,
  after_quantity: nonnegative,
});
