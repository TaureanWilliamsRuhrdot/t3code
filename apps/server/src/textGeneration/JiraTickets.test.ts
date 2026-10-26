import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveJiraTickets } from "./JiraTickets.ts";

const environment = {
  JIRA_BASE_URL: "https://firma.atlassian.net",
  JIRA_EMAIL: "me@firma.test",
  JIRA_API_TOKEN: "token",
};

it.effect("fetches the tickets named in a message and drops the ones Jira rejects", () =>
  Effect.gen(function* () {
    const requests: Array<{ url: string; authorization: string }> = [];
    const fetchTicket = (async (url: URL, init: RequestInit) => {
      requests.push({
        url: url.href,
        authorization: (init.headers as Record<string, string>).authorization!,
      });
      return url.pathname.endsWith("/ABC-1")
        ? Response.json({ fields: { summary: "Fix login", description: "Users cannot log in" } })
        : new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const result = yield* resolveJiraTickets(
      "Work on ABC-1 and UTF-8 please, ABC-1 again",
      environment,
      fetchTicket,
    );

    expect(result).toBe(
      `ABC-1\n${JSON.stringify({ title: "Fix login", body: "Users cannot log in" })}`,
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://firma.atlassian.net/rest/api/2/issue/ABC-1?fields=summary,description",
      "https://firma.atlassian.net/rest/api/2/issue/UTF-8?fields=summary,description",
    ]);
    expect(requests[0]!.authorization).toBe(
      `Basic ${Buffer.from("me@firma.test:token").toString("base64")}`,
    );
  }),
);

it.effect("does nothing without Jira configuration or without a ticket key", () =>
  Effect.gen(function* () {
    const neverCalled = (async () => {
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    expect(yield* resolveJiraTickets("Fix ABC-1", {}, neverCalled)).toBeUndefined();
    expect(yield* resolveJiraTickets("Fix pairing", environment, neverCalled)).toBeUndefined();
  }),
);
