import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount, tool } from "ai";
import {
  chatInput,
  instructions,
  toolArguments,
  type ChatInput,
} from "./chat-contracts";
import { ChatReceipt, publish } from "./chat-evidence";
import {
  aggregateUsage,
  endpoint,
  errorInfo,
  hash,
  NativeEvidence,
} from "./chat-native";
import type { ShopStore } from "./store";

class ChatConfigurationError extends Error {
  readonly code = "chat_configuration";
}

export type ChatOptions = {
  model?: string;
  key?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  outputRoot?: string;
  publish?: typeof publish;
};
export async function runChat(
  store: ShopStore,
  input: ChatInput,
  options: ChatOptions = {},
) {
  input = chatInput.parse(input);
  const timeout = options.timeoutMs ?? 120000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120000)
    throw new Error("Chat timeout must be positive and no more than 120000 ms");
  const model = options.model ?? process.env.OPENAI_MODEL ?? null;
  const controller = new AbortController(),
    deadline = performance.now() + timeout;
  const timer = setTimeout(
    () => controller.abort(new Error("Shopping chat deadline exceeded")),
    timeout,
  );
  const cancel = () =>
    controller.abort(
      options.signal?.reason ?? new Error("Shopping chat cancelled"),
    );
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let active = true,
    receipt: ChatReceipt | null = null,
    result: unknown = null,
    failure: unknown = null;
  let native: NativeEvidence | null = null;
  let tools = 0;
  let executionFailure: Error | null = null;
  const guard = () => {
    receipt?.guard();
    if (executionFailure) throw executionFailure;
    if (!active) throw new Error("Shopping chat run is closed");
    if (performance.now() >= deadline)
      throw new Error("Shopping chat deadline exceeded");
    controller.signal.throwIfAborted();
  };
  try {
    receipt = await ChatReceipt.create(
      store,
      input,
      model,
      options.outputRoot ?? process.env.SHOP_CHAT_OUTPUT_ROOT,
      options.publish,
    );
    guard();
    const key = options.key ?? process.env.OPENAI_API_KEY;
    if (typeof key !== "string" || !key.trim())
      throw new ChatConfigurationError(
        "OPENAI_API_KEY is required for live chat",
      );
    if (
      typeof model !== "string" ||
      !model.trim() ||
      model.length > 200 ||
      /\s/.test(model)
    )
      throw new ChatConfigurationError(
        "OPENAI_MODEL must name an enabled model",
      );
    const versions = receipt.data.versions as Record<string, string>;
    if (versions.ai !== "7.0.141" || versions["@ai-sdk/openai"] !== "4.0.94")
      throw new Error("Native shopping SDK versions need requalification");
    const baseURL = endpoint(
      options.baseURL ??
        process.env.OPENAI_BASE_URL ??
        "https://api.openai.com/v1",
    );
    native = new NativeEvidence(baseURL, () => receipt!.save(), guard);
    receipt.native = native;
    Object.assign(receipt.data, {
      execution_kind: "native_ai_sdk_responses",
      endpoint: baseURL,
      instructions_sha256: hash(instructions),
      timeout_ms: timeout,
    });
    await receipt.save();
    guard();
    const provider = createOpenAI({
      apiKey: key,
      baseURL,
      fetch: native.fetch(options.fetch ?? globalThis.fetch, controller.signal),
    });
    const read = async (
      name: string,
      arguments_: unknown,
      operation: () => unknown,
    ) => {
      guard();
      native!.check();
      if (++tools > 24) {
        executionFailure = new Error(
          "Shopping read-tool invocation limit (24) reached",
        );
        throw executionFailure;
      }
      let value: unknown;
      try {
        value = operation();
      } catch (error) {
        value = { error: errorInfo(error) };
      }
      guard();
      (receipt!.data.tools as unknown[]).push({
        name,
        arguments: arguments_,
        result: value,
      });
      await receipt!.save();
      guard();
      return value;
    };
    const generated = await generateText({
      model: provider.responses(model),
      system: instructions,
      messages: input.messages,
      maxRetries: 0,
      maxOutputTokens: 2048,
      abortSignal: controller.signal,
      stopWhen: isStepCount(4),
      providerOptions: { openai: { store: false } },
      telemetry: {
        isEnabled: false,
        recordInputs: false,
        recordOutputs: false,
        integrations: [],
      },
      tools: {
        searchProducts: tool({
          description:
            "Search current synthetic products by name, category or description",
          inputSchema: toolArguments.searchProducts,
          execute: ({ query }) =>
            read("searchProducts", { query }, () =>
              store
                .products()
                .filter((product) =>
                  `${product.name} ${product.category} ${product.description}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ),
            ),
        }),
        viewCart: tool({
          description:
            "Read the current cart, actual budget, totals and remaining budget; this never changes the cart",
          inputSchema: toolArguments.viewCart,
          execute: () => read("viewCart", {}, () => store.state()),
        }),
        suggestAlternatives: tool({
          description:
            "Read in-stock products in the same category as a known product",
          inputSchema: toolArguments.suggestAlternatives,
          execute: ({ product_id }) =>
            read("suggestAlternatives", { product_id }, () =>
              store.alternatives(product_id),
            ),
        }),
      },
      onStepEnd: async (step) => {
        guard();
        (receipt!.data.normalized_sdk_steps as unknown[]).push({
          finish_reason: step.finishReason,
          raw_finish_reason: step.rawFinishReason,
          usage: step.usage,
          response_id: step.response.id,
          response_model: step.response.modelId,
          text: step.text,
          tool_calls: step.toolCalls,
          tool_results: step.toolResults,
        });
        await receipt!.save();
        guard();
      },
    });
    Object.assign(receipt.data, {
      normalized_sdk: {
        finish_reason: generated.finishReason,
        usage: generated.usage,
        total_usage: generated.totalUsage,
        steps: generated.steps.length,
      },
    });
    await receipt.save();
    guard();
    native.check();
    if (
      generated.finishReason !== "stop" ||
      !generated.text.trim() ||
      generated.text.length > 64000 ||
      generated.steps.at(-1)?.toolCalls.length ||
      !native.terminal
    )
      throw new Error(
        "Shopping assistant did not produce a completed final answer",
      );
    result = {
      reply: generated.text,
      reported_usage: aggregateUsage(native.observations),
      normalized_sdk_usage: generated.usage,
      cost_usd: null,
      tools: generated.steps.flatMap((step) =>
        step.toolResults.map((tool) => tool.toolName),
      ),
      run_id: receipt.runId,
      receipt_path: receipt.path,
    };
  } catch (error) {
    failure = error;
  } finally {
    active = false;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    controller.abort(new Error("Shopping chat owner closed"));
    if (receipt) {
      receipt.data.lifecycle = {
        run_closed: true,
        timer_cleared: true,
        parent_listener_removed: true,
        provider_operations_aborted: true,
        fetch_pool_owner: "runtime_or_injected_caller",
      };
      try {
        await receipt.finish(result, failure);
      } catch (error) {
        failure = failure ?? error;
      }
    }
  }
  if (failure) {
    const error =
      failure instanceof Error ? failure : new Error(String(failure));
    if (receipt)
      Object.assign(error, {
        evidence: receipt.data,
        receiptPath: receipt.path,
      });
    throw error;
  }
  return result as {
    reply: string;
    reported_usage: ReturnType<typeof aggregateUsage>;
    normalized_sdk_usage: unknown;
    cost_usd: null;
    tools: string[];
    run_id: string;
    receipt_path: string;
  };
}

export function chatHandler(
  getStore: () => ShopStore,
  options: ChatOptions = {},
) {
  return async (request: Request) => {
    let input: ChatInput;
    try {
      if (Number(request.headers.get("content-length") ?? 0) > 1048576)
        throw new Error("Chat input too large");
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 1048576)
        throw new Error("Chat input too large");
      input = chatInput.parse(JSON.parse(raw));
    } catch {
      return Response.json({ error: "Invalid chat request" }, { status: 400 });
    }
    try {
      return Response.json(
        await runChat(getStore(), input, {
          ...options,
          signal: request.signal,
        }),
      );
    } catch (error) {
      const value = error as Error & { receiptPath?: string; code?: string };
      const preflight = value.code === "chat_configuration";
      return Response.json(
        {
          error: preflight
            ? "Shopping assistant needs a configured model and key."
            : request.signal.aborted
              ? "The shopping request was cancelled."
              : "Shopping assistant could not complete this request. Please try again.",
          receipt_path: value.receiptPath ?? null,
        },
        { status: preflight ? 503 : request.signal.aborted ? 499 : 502 },
      );
    }
  };
}
