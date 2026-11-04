# AI design notes

How the LLM features of Sève are built, and why.

## 1. Prompt structure

Every prompt is assembled from the same building blocks:

```
[House voice]   who the brand is, tone rules, "never invent products, discounts or policies"
[Grounding]     the full catalog: id | name | family | top | heart | base | prices
[User context]  quiz answers, free text, the customer's bag, the chat history
[Task]          what to decide or write
[Output spec]   the exact JSON shape, length limits, output language
```

The shared house voice, written once and reused by every feature:

```text
Sève is an artisan perfume house in Antibes, France. Tone: warm, refined, concise,
sensory, like a knowledgeable boutique advisor at a luxury house. No em dashes.
Never invent products, discounts or policies.
```

The catalog is serialized one line per product, in English, so the model reasons over one consistent vocabulary whatever the interface language:

```text
- id: iris-pluie | Iris Pluie | Powdery floral | top: Bergamot, rain accord | heart: Orris, violet | base: White musk, vetiver | 50 ml €110, 100 ml €160
```

## 2. Example: the scent-finder quiz

```text
{house voice}
Collection:
{catalog}

Quiz answers: {"moment":"evening","family":"woody","presence":"trail","season":"autumn"}
Scent memory: "my grandmother's garden after rain"

Return ONLY JSON: {"pick":"<id>","reason":"<2-3 sentences in French linking their answers
and memory to specific notes>","runnerUp":"<different id>","runnerReason":"<1 sentence in French>"}
```

Design choices:
- **Closed set.** The model picks an `id`, not a name, so the result maps exactly to a product. An unknown id falls back to a default product, and a runner-up identical to the pick is dropped.
- **Explainability.** The `reason` field must tie the customer's own answers to specific notes, which makes the recommendation feel personal and easy to trust.
- **Language.** The output language is injected from the interface state, so a French visitor gets French text without a translation step.

## 3. Parsing model output

```js
const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
if (!m) throw { code: "bad_json" };
return JSON.parse(m[0]);
```

Models sometimes wrap JSON in code fences or add a sentence before it. The parser strips fences and extracts the first JSON object. Any failure shows a friendly retry message instead of breaking the page, and every field is rendered with `textContent`, never as HTML, so model output can't inject markup.

## 4. Actions from the chat: tag-based tool use

The concierge can add products to the bag. Instead of a full function-calling loop, the model is told:

```text
If the customer clearly asks to add something to their bag, confirm briefly and put this
tag alone on the last line: [[ADD <id> <50 or 100>]]. Never use the tag otherwise.
```

The page then runs:

```js
reply = reply.replace(/\[\[ADD\s+([a-z-]+)\s*(\d+)?\]\]/g, (m, id, ml) => {
  if (addToBag(id, ml === "100" ? 1 : 0, true)) addMsg("sys", "... was added to your bag");
  return "";
});
```

Why: it needs a single API call per message (lower latency and cost), it works with plain text responses, and the page stays in control, since `addToBag` only accepts ids that exist in the catalog.

## 5. Conversation memory

- The system instructions and catalog travel inside the first user turn.
- History is kept in the browser and capped at the last 16 messages, and the server also caps at 20 messages, which bounds cost per request.
- The current bag is injected into the instructions on every turn, so the advisor knows what the customer has already chosen.

## 6. Guardrails

| Risk | Mitigation |
|---|---|
| Recommending a product that doesn't exist | Closed-set ids, validation against the catalog |
| Inventing discounts, delivery times or stock | Explicit prohibition in the house voice; logistics questions routed to the team |
| Off-topic use of the chat | Instruction to steer back to perfume |
| Dishonest pairing advice | The layering prompt requires an honest verdict, including "not recommended" |
| Clichéd marketing copy | Banned-word list in the brand space prompt |

## 7. Backend safeguards (`api/claude.js`)

- The API key is read from an environment variable and never reaches the browser.
- Only `user` / `assistant` messages with string content are forwarded; the last message must come from the user.
- Request size is capped at 12,000 characters and output at 800 tokens.
- Best-effort rate limit of 12 requests per minute per IP.
- The model is configurable through `CLAUDE_MODEL`, with a fast, low-cost default for interactive use.

## 8. What I would measure next

- **Recommendation accuracy:** a set of labelled customer profiles with acceptable picks, run on every prompt or model change.
- **Consistency:** the same quiz answers submitted several times should give the same pick.
- **Grounding rate:** the share of chat replies that mention only catalog products.
- **Latency and cost per feature,** logged server-side.
