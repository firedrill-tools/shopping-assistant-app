# Scenario set

The SQLite seed has six synthetic home products and a $150 demo cart. The linen bath towel starts out of stock; the cotton bath towel is its available same-category alternative.

1. **Ordinary basket:** add a mug and bottle, inspect remaining budget, then use the visible checkout button. Checkout creates a local order, decrements stock, increments product revisions and clears the cart.
2. **Unavailable item:** adding the linen towel fails. The assistant can use `suggestAlternatives` to recommend the cotton towel, but the shopper chooses whether to add it.
3. **Budget limit:** add a desk lamp and lantern ($142 total), then try to add a mug. The cart stays at $142 and shows an over-budget error.
4. **Changed inventory:** add two lamps, reduce lamp stock to one through the scenario helper, then checkout. It fails without changing inventory or clearing the cart. Restoring stock allows checkout.
5. **Stale product view:** a stock change increments the product revision; an add based on the old revision is rejected until refresh.

`npm test` covers the cart and checkout state. `npm run typecheck && npm run build` verifies the Next.js UI and AI SDK route. A live assistant conversation needs `OPENAI_API_KEY` and an enabled `OPENAI_MODEL`; offline tests do not claim one.
