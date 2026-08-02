/**
 * Jami's own shape for a piece of model input.
 *
 * `lib/` is pure domain logic, so it must not depend on a vendor SDK. The
 * Gemini `Part` type had drifted into three modules here and one service,
 * which meant swapping or adding a provider would have touched domain code
 * that has nothing to do with who serves the request.
 *
 * This is deliberately not a provider abstraction. It describes only the two
 * shapes Jami actually builds -- text and inline base64 data -- and both are
 * structurally compatible with the SDK's `Part`, so the Gemini client accepts
 * them without conversion. Adding a second provider is then a change inside
 * `lib/ai/gemini.ts` and its caller, not a rewrite of the assistant, source
 * ingestion and context modules.
 */
export type AiTextPart = { text: string };

export type AiInlineDataPart = {
  inlineData: {
    mimeType: string;
    /** Base64, without a data: prefix. */
    data: string;
  };
};

export type AiContentPart = AiTextPart | AiInlineDataPart;

export function isAiInlineDataPart(
  part: AiContentPart
): part is AiInlineDataPart {
  return "inlineData" in part && Boolean(part.inlineData);
}
