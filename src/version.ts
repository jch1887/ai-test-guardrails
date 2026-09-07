import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** The version declared in package.json, reported by the MCP server and the CLI. */
export const PACKAGE_VERSION: string = version;
