import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      return `${resolveOllamaLocalHost(credentials)}${new URL(rt.baseUrl).pathname}`;
    }
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
