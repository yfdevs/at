import type { LlamaServerErrorCode } from "./types.js";

export class LlamaServerError extends Error {
  readonly code: LlamaServerErrorCode;

  constructor(code: LlamaServerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LlamaServerError";
    this.code = code;
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
      });
    }
  }
}
