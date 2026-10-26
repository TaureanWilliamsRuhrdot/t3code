import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

interface JiraEnvironment {
  readonly JIRA_BASE_URL?: string | undefined;
  readonly JIRA_EMAIL?: string | undefined;
  readonly JIRA_API_TOKEN?: string | undefined;
}

const encodeTicket = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String, body: Schema.String })),
);

// Keys like UTF-8 also match; the lookup 404s and the candidate is dropped.
const TICKET_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** Looks up Jira tickets named in a message; configured through JIRA_* environment variables. */
export const resolveJiraTickets = Effect.fn("resolveJiraTickets")(function* (
  message: string,
  environment: JiraEnvironment = process.env,
  fetchTicket: typeof fetch = fetch,
) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = environment;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !URL.canParse(JIRA_BASE_URL)) {
    return undefined;
  }
  const baseUrl = new URL(JIRA_BASE_URL);
  const keys = [...new Set(message.match(TICKET_KEY))].slice(0, 2);
  const authorization = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`;
  const tickets = yield* Effect.forEach(
    keys,
    (key) =>
      Effect.tryPromise(async (signal) => {
        const response = await fetchTicket(
          new URL(`/rest/api/2/issue/${key}?fields=summary,description`, baseUrl),
          { headers: { authorization, accept: "application/json" }, signal },
        );
        if (!response.ok) throw new Error(`Jira responded ${response.status}`);
        const issue = (await response.json()) as {
          fields: { summary: string; description?: string | null };
        };
        return `${key}\n${encodeTicket({
          title: issue.fields.summary.slice(0, 300),
          body: issue.fields.description?.slice(0, 1_200) ?? "",
        })}`;
      }).pipe(
        Effect.timeout("3 seconds"),
        Effect.orElseSucceed(() => undefined),
      ),
    { concurrency: 2 },
  );
  const found = tickets.filter((ticket) => ticket !== undefined);
  return found.length > 0 ? found.join("\n\n") : undefined;
});
