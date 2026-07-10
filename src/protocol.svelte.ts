// The single module that owns the protocol-family boundary. App code traffics
// in bare `Body` values; document wrappers ({protocol, body}, PaperfoldDocument,
// Scene) are constructed only here and in the source-panel round-trip. Svelte 5
// $state proxies must never reach protocol internals — route every hand-off
// through snapshotBody.

import { PAPER_DOLL_PROTOCOL, validateDocument } from "paperdoll";
import type { Body, ProtocolError, Result } from "paperdoll";
import { formatProtocolErrors } from "paperdoll";

/** Deep, proxy-free copy of a (possibly $state-proxied) body. */
export function snapshotBody(body: Body): Body {
  return $state.snapshot(body) as Body;
}

/** Validate a bare body against all eight kernel laws. */
export function validateBody(body: Body): ProtocolError[] {
  return validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body });
}

/** Unwrap a protocol Result, throwing formatted errors on failure. */
export function assertApplied<T>(result: Result<T, ProtocolError[]>): T {
  if (!result.ok) {
    throw new Error(formatProtocolErrors(result.errors));
  }
  return result.value;
}
