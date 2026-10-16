import { createHash } from "node:crypto";
import { toolArguments } from "./chat-contracts";

export const LIMIT = 1024 * 1024;
export const now = () => new Date().toISOString();
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const errorInfo = (error: unknown) => ({
  name: error instanceof Error ? error.name : "Error",
  message: error instanceof Error ? error.message : String(error),
});
export type Usage = {
  fields: Record<
    "input_tokens" | "output_tokens" | "total_tokens",
    number | null
  >;
  complete: boolean;
  cost_usd: null;
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export function reportedUsage(body: unknown): Usage {
  const raw =
    body && typeof body === "object"
      ? (body as { usage?: Record<string, unknown> }).usage
      : null;
  const fields = {
    input_tokens: count(raw?.input_tokens),
    output_tokens: count(raw?.output_tokens),
    total_tokens: count(raw?.total_tokens),
  };
  return {
    fields,
    complete: Object.values(fields).every((value) => value !== null),
    cost_usd: null,
  };
}
export function aggregateUsage(observations: Observation[]) {
  const fields = Object.fromEntries(
    (["input_tokens", "output_tokens", "total_tokens"] as const).map((key) => {
      const values = observations.map(
        (item) => item.reported_usage.fields[key],
      );
      const sum =
        values.length && values.every((value) => value !== null)
          ? values.reduce<number>((total, value) => total + value!, 0)
          : null;
      return [key, sum !== null && Number.isSafeInteger(sum) ? sum : null];
    }),
  ) as Usage["fields"];
  return {
    fields,
    complete:
      observations.length > 0 &&
      Object.values(fields).every((value) => value !== null),
    prepared_attempts: observations.length,
    cost_usd: null,
  };
}
export type Observation = {
  attempt: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  path: string;
  request_body: unknown;
  request_sha256: string;
  http_status: number | null;
  request_id: string | null;
  body: unknown;
  body_text: string | null;
  captured_base64: string | null;
  capture_sha256: string | null;
  body_sha256: string | null;
  truncated: boolean;
  response_id: string | null;
  response_model: string | null;
  reported_usage: Usage;
  error: ReturnType<typeof errorInfo> | null;
};
export function endpoint(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error(
      "Provider endpoint requires HTTPS or loopback HTTP without credentials/query/fragment",
    );
  return url.href.replace(/\/$/, "");
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function identity(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error(`Missing/invalid ${name}`);
}
export function parseJSON(text: string): unknown {
  return JSON.parse(text, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Nonfinite provider JSON number");
    return value;
  });
}
export function validateCompletion(
  body: unknown,
  toolIds: Set<string>,
  responseIds: Set<string>,
) {
  if (
    !object(body) ||
    body.status !== "completed" ||
    body.error != null ||
    body.incomplete_details != null ||
    (body.object != null && body.object !== "response")
  )
    throw new Error("Provider response did not complete");
  identity(body.id, "response ID");
  identity(body.model, "response model");
  if (responseIds.has(body.id))
    throw new Error("Provider response ID replayed");
  if (!Array.isArray(body.output) || !body.output.length)
    throw new Error("Provider output is absent");
  let final = false;
  let calls = 0;
  const added = new Set<string>();
  const itemIds = new Set<string>();
  for (const item of body.output) {
    if (
      !object(item) ||
      !["message", "function_call", "reasoning"].includes(String(item.type))
    )
      throw new Error("Unsupported provider output type");
    if (item.status != null && item.status !== "completed")
      throw new Error("Provider output item did not complete");
    if (item.id != null) {
      identity(item.id, "output item ID");
      if (itemIds.has(item.id)) throw new Error("Duplicate output item ID");
      itemIds.add(item.id);
    }
    if (item.type === "reasoning") continue;
    if (item.type === "function_call") {
      identity(item.call_id, "tool call ID");
      if (toolIds.has(item.call_id) || added.has(item.call_id))
        throw new Error("Provider tool call ID replayed");
      if (
        typeof item.name !== "string" ||
        !Object.hasOwn(toolArguments, item.name) ||
        typeof item.arguments !== "string" ||
        item.arguments.length > 8000
      )
        throw new Error("Unsupported provider tool call");
      toolArguments[item.name as keyof typeof toolArguments].parse(
        parseJSON(item.arguments),
      );
      added.add(item.call_id);
      calls++;
      continue;
    }
    if (
      item.role !== "assistant" ||
      !Array.isArray(item.content) ||
      !item.content.length ||
      item.content.some(
        (part) =>
          !object(part) ||
          part.type !== "output_text" ||
          typeof part.text !== "string",
      )
    )
      throw new Error("Provider message is empty, malformed or refused");
    if (
      item.phase != null &&
      item.phase !== "commentary" &&
      item.phase !== "final_answer"
    )
      throw new Error("Unsupported message phase");
    if (
      item.phase !== "commentary" &&
      item.content.some((part) =>
        Boolean((part as { text: string }).text.trim()),
      )
    )
      final = true;
  }
  if (calls > 24 || (!calls && !final))
    throw new Error(
      "Provider has no completed answer or exceeds the read-tool limit",
    );
  for (const id of added) toolIds.add(id);
  responseIds.add(body.id);
  return { calls, terminal: calls === 0 && final };
}

export async function untilAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let stopped = false;
    const abort = () => {
      stopped = true;
      reject(signal.reason ?? new Error("Request aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(
        (value) => {
          if (stopped) late?.(value);
          else resolve(value);
        },
        (error) => {
          if (!stopped) reject(error);
        },
      )
      .finally(() => signal.removeEventListener("abort", abort))
      .catch(() => {});
    if (signal.aborted) abort();
  });
}
async function capture(
  response: Response,
  signal: AbortSignal,
  item: Observation,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  let complete = false;
  const reader = response.body?.getReader();
  const cancel = () => {
    reader?.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (reader)
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await untilAbort(reader.read(), signal);
        if (done) break;
        const remaining = LIMIT - size;
        chunks.push(Buffer.from(value.subarray(0, remaining)));
        size += Math.min(remaining, value.length);
        if (value.length > remaining) {
          item.truncated = true;
          reader.cancel("Provider evidence limit").catch(() => {});
          break;
        }
      }
    signal.throwIfAborted();
    complete = !item.truncated;
  } finally {
    const raw = Buffer.concat(chunks);
    item.capture_sha256 = hash(raw);
    item.body_sha256 = complete ? hash(raw) : null;
    try {
      item.body_text = new TextDecoder("utf8", { fatal: true }).decode(raw);
      item.body = parseJSON(item.body_text);
    } catch {
      item.body = item.body_text;
      item.captured_base64 = raw.toString("base64");
    }
    item.reported_usage = reportedUsage(item.body);
    if (object(item.body)) {
      item.response_id = typeof item.body.id === "string" ? item.body.id : null;
      item.response_model =
        typeof item.body.model === "string" ? item.body.model : null;
    }
    signal.removeEventListener("abort", cancel);
    try {
      if (!complete) reader?.cancel("Capture ended").catch(() => {});
    } finally {
      reader?.releaseLock();
    }
  }
  return Buffer.concat(chunks);
}

export class NativeEvidence {
  readonly observations: Observation[] = [];
  readonly toolIds = new Set<string>();
  readonly responseIds = new Set<string>();
  terminal = false;
  failed: unknown = null;
  constructor(
    readonly baseURL: string,
    readonly publish: () => Promise<void>,
    readonly guard: () => void,
  ) {}
  check() {
    this.guard();
    if (this.failed) throw this.failed;
  }
  fetch(
    fetcher: typeof globalThis.fetch,
    signal: AbortSignal,
  ): typeof globalThis.fetch {
    return async (url, options = {}) => {
      this.check();
      signal.throwIfAborted();
      if (this.observations.length >= 4)
        throw new Error("Prepared HTTP request limit (4) reached");
      if (
        String(url) !== `${this.baseURL}/responses` ||
        options.method !== "POST" ||
        typeof options.body !== "string"
      )
        throw new Error("Only native JSON Responses is qualified");
      const bytes = Buffer.from(options.body);
      if (bytes.length > LIMIT)
        throw new Error("Provider request exceeds 1 MiB");
      const request = parseJSON(options.body);
      if (
        !object(request) ||
        request.stream === true ||
        request.store !== false ||
        request.max_output_tokens !== 2048
      )
        throw new Error("Unexpected provider execution settings");
      const tools = request.tools;
      if (
        !Array.isArray(tools) ||
        tools.length !== 3 ||
        new Set(tools.map((tool) => (object(tool) ? tool.name : null))).size !==
          3 ||
        tools.some(
          (tool) =>
            !object(tool) ||
            tool.type !== "function" ||
            typeof tool.name !== "string" ||
            !Object.hasOwn(toolArguments, tool.name),
        )
      )
        throw new Error("Only read-only shopping tools may be exposed");
      const item: Observation = {
        attempt: this.observations.length + 1,
        status: "prepared",
        started_at: now(),
        finished_at: null,
        path: new URL(String(url)).pathname,
        request_body: request,
        request_sha256: hash(bytes),
        http_status: null,
        request_id: null,
        body: null,
        body_text: null,
        captured_base64: null,
        capture_sha256: null,
        body_sha256: null,
        truncated: false,
        response_id: null,
        response_model: null,
        reported_usage: reportedUsage(null),
        error: null,
      };
      this.observations.push(item);
      await this.publish();
      this.check();
      signal.throwIfAborted();
      const phase = new AbortController();
      const timer = setTimeout(
        () => phase.abort(new Error("Provider HTTP deadline exceeded")),
        30000,
      );
      const combined = AbortSignal.any([
        signal,
        phase.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      try {
        const response = await untilAbort(
          fetcher(url, { ...options, redirect: "error", signal: combined }),
          combined,
          (value) => {
            value.body?.cancel("Run already stopped").catch(() => {});
          },
        );
        item.http_status = response.status;
        item.request_id = response.headers.get("x-request-id");
        item.status = "received";
        const raw = await capture(response, combined, item);
        await this.publish();
        this.check();
        combined.throwIfAborted();
        if (item.truncated)
          throw new Error("Provider response exceeds 1 MiB evidence limit");
        if (response.ok) {
          const completed = validateCompletion(
            item.body,
            this.toolIds,
            this.responseIds,
          );
          this.terminal = completed.terminal;
        }
        item.status = response.ok ? "accepted" : "http_error";
        item.finished_at = now();
        await this.publish();
        this.check();
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(raw, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        this.failed = error;
        item.status = "failed";
        item.finished_at = now();
        item.error = errorInfo(error);
        await this.publish();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
  }
}
