// Separate Metro smoke-test entry: includes the SDK even while the demo has no live program calls.
import '../polyfills.ts';
export { ArgusClient, ARGUS_PROGRAM_ID } from './client.ts';
