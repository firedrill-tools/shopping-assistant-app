/** Controlled provider HTTP for production browser tests. Never a live model. */
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".e2e");
mkdirSync(root, { recursive: true, mode: 0o700 });
let sequence = 0;
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.end("ready");
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    response.writeHead(404);
    response.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  sequence++;
  appendFileSync(
    resolve(root, "provider-log.jsonl"),
    JSON.stringify({ path: request.url, body }) + "\n",
    { mode: 0o600 },
  );
  const send = (value: unknown, status = 200) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "x-request-id": `browser-synthetic-${sequence}`,
    });
    response.end(JSON.stringify(value));
  };
  const usage = { input_tokens: 40, output_tokens: 15, total_tokens: 55 };
  const pending = new Set<string>();
  for (const item of body.input) {
    if (item.type === "function_call") pending.add(item.call_id);
    if (item.type === "function_call_output") {
      if (!pending.delete(item.call_id)) {
        send(
          { error: { message: "Orphan controlled tool result" }, usage },
          400,
        );
        return;
      }
    }
    if (item.role === "user" && pending.size) {
      send(
        { error: { message: "Unanswered controlled tool call" }, usage },
        400,
      );
      return;
    }
  }
  if (pending.size) {
    send({ error: { message: "Missing controlled tool result" }, usage }, 400);
    return;
  }
  const lastUser = body.input.findLastIndex(
    (item: { role?: string }) => item.role === "user",
  );
  const content = body.input[lastUser]?.content;
  const task = (
    typeof content === "string"
      ? content
      : (content?.map((part: { text?: string }) => part.text ?? "").join(" ") ??
        "")
  ).toLowerCase();
  if (task.includes("provider outage")) {
    send(
      {
        error: { message: "Controlled provider outage", type: "server_error" },
        usage,
      },
      503,
    );
    return;
  }
  const results = body.input
    .slice(lastUser + 1)
    .filter((item: { type: string }) => item.type === "function_call_output");
  let name: string | null, arguments_: unknown;
  if (task.includes("unfinished response")) {
    name = "viewCart";
    arguments_ = {};
  } else if (!results.length) {
    name = "searchProducts";
    arguments_ = { query: "towel" };
  } else if (results.length === 1) {
    name = "suggestAlternatives";
    arguments_ = { product_id: "towel-01" };
  } else if (results.length === 2) {
    name = "viewCart";
    arguments_ = {};
  } else {
    name = null;
    arguments_ = null;
  }
  const output = name
    ? [
        {
          type: "function_call",
          id: `fc_${sequence}`,
          call_id: `call_${sequence}`,
          name,
          arguments: JSON.stringify(arguments_),
          status: task.includes("unfinished response")
            ? "incomplete"
            : "completed",
        },
      ]
    : [
        {
          type: "message",
          id: `msg_${sequence}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text:
                "The cotton bath towel is in stock at $36. Your bag and orders are unchanged. Use the shopper controls when you are ready." +
                (task.includes("long answer")
                  ? " Compare verified stock before using the shopper controls.".repeat(
                      60,
                    )
                  : ""),
              annotations: [],
            },
          ],
        },
      ];
  send({
    id: `resp_browser_${sequence}`,
    model: "gpt-synthetic-response",
    created_at: 1792126800,
    status: "completed",
    output,
    incomplete_details: null,
    usage,
    unknown_field: { preserved: true },
  });
});
server.listen(3303, "127.0.0.1");
process.once("SIGTERM", () => server.close(() => process.exit(0)));
