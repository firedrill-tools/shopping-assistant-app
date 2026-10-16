import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import aiPackage from "ai/package.json";
import providerPackage from "@ai-sdk/openai/package.json";
import zodPackage from "zod/package.json";
import {
  aggregateUsage,
  errorInfo,
  hash,
  now,
  type NativeEvidence,
} from "./chat-native";
import type { ShopStore } from "./store";

export async function publish(path: string, value: unknown) {
  const staged = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staged, path);
  } finally {
    await unlink(staged).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export class ChatReceipt {
  native: NativeEvidence | null = null;
  recordingError: unknown = null;
  private tail = Promise.resolve();
  readonly data: Record<string, unknown>;
  private constructor(
    readonly path: string,
    readonly store: ShopStore,
    readonly writer: typeof publish,
    input: unknown,
    model: string | null,
    readonly runId: string,
  ) {
    const initial = store.snapshot();
    this.data = {
      schema_version: 1,
      run_id: runId,
      receipt_path: path,
      status: "running",
      execution_kind: "preflight",
      started_at: now(),
      finished_at: null,
      versions: {
        node: process.version,
        ai: aiPackage.version,
        "@ai-sdk/openai": providerPackage.version,
        zod: zodPackage.version,
      },
      requested_model: model,
      input,
      input_sha256: hash(JSON.stringify(input)),
      initial_state: initial,
      initial_state_sha256: hash(JSON.stringify(initial)),
      final_state: null,
      provider_observations: [],
      normalized_sdk_steps: [],
      normalized_sdk: null,
      tools: [],
      reported_usage: aggregateUsage([]),
      actual_effects: { cart_mutations: [], placed_order_ids: [] },
      result: null,
      error: null,
    };
  }
  static async create(
    store: ShopStore,
    input: unknown,
    model: string | null,
    outputRoot?: string,
    writer = publish,
  ) {
    const root = resolve(/* turbopackIgnore: true */ outputRoot ?? ".runs");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const runId = randomUUID(),
      directory = join(/* turbopackIgnore: true */ root, runId);
    await mkdir(directory, { mode: 0o700 });
    const value = new ChatReceipt(
      join(directory, "receipt.json"),
      store,
      writer,
      input,
      model,
      runId,
    );
    try {
      await value.save();
    } catch (error) {
      value.data.status = "failed";
      value.data.evidence_error = errorInfo(error);
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { evidence: value.data, receiptPath: value.path },
      );
    }
    return value;
  }
  guard() {
    if (this.recordingError) throw this.recordingError;
  }
  async save(force = false) {
    if (!force) this.guard();
    if (this.native) {
      this.data.provider_observations = structuredClone(
        this.native.observations,
      );
      this.data.reported_usage = aggregateUsage(this.native.observations);
    }
    const value = structuredClone(this.data);
    const previous = force ? this.tail.catch(() => {}) : this.tail;
    this.tail = previous
      .then(() => this.writer(this.path, value))
      .catch((error) => {
        this.recordingError = error;
        throw error;
      });
    await this.tail;
  }
  async finish(result: unknown, error: unknown) {
    let failure = error;
    Object.assign(this.data, {
      status: failure ? "failed" : "completed",
      finished_at: now(),
      result: failure ? null : result,
      error: failure ? errorInfo(failure) : null,
    });
    try {
      const final = this.store.snapshot();
      this.data.final_state = final;
      this.data.final_state_sha256 = hash(JSON.stringify(final));
    } catch (snapshotFailure) {
      this.data.snapshot_error = errorInfo(snapshotFailure);
      failure ??= snapshotFailure;
      Object.assign(this.data, {
        status: "failed",
        result: null,
        error: errorInfo(failure),
      });
    }
    try {
      await this.save(true);
    } catch (recordingFailure) {
      this.data.status = "failed";
      this.data.result = null;
      this.data.evidence_error = errorInfo(recordingFailure);
      throw recordingFailure;
    }
    if (failure && !error) throw failure;
  }
}
