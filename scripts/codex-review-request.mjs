#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCodexReviewRequestMarkerBody,
  isCodexReviewCommand,
  isCodexReviewCommandForHead,
  isTrustedAssociation
} from "./codex-review-helpers.mjs";
import { rerunCodexReviewForHead } from "./codex-review-rerun.mjs";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository || !eventPath) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_EVENT_PATH are required.");
  }

  const [owner, repo] = repository.split("/");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const comment = event.comment;
  if (!event.issue?.pull_request || !comment || !isCodexReviewCommand(comment.body)) {
    throw new Error("The request must be an @codex review comment on a pull request.");
  }
  if (comment.user?.type === "Bot" || !isTrustedAssociation(comment.author_association)) {
    throw new Error("Only OWNER, MEMBER, or COLLABORATOR comments can request Codex review.");
  }

  async function request(path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }

  const pull = await request(`/repos/${owner}/${repo}/pulls/${event.issue.number}`);
  const headSha = pull.head?.sha;
  if (!isCodexReviewCommandForHead(comment.body, headSha)) {
    throw new Error("The @codex review command must include the current full PR head SHA.");
  }
  const requestedAt = comment.created_at || new Date().toISOString();
  const markerBody = createCodexReviewRequestMarkerBody({
    headSha,
    requestId: `${comment.id}-${String(headSha).slice(0, 12)}`,
    sourceCommentId: String(comment.id),
    sourceCommentCreatedAt: comment.created_at,
    requestedAt
  });

  await request(`/repos/${owner}/${repo}/issues/${event.issue.number}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: markerBody })
  });

  try {
    const result = await rerunCodexReviewForHead({ token, repository, headSha });
    console.log(result.message);
  } catch (error) {
    console.warn(`Marker recorded, but Codex Review rerun could not be requested: ${error.message}`);
  }

  console.log(`Trusted Codex review request recorded for ${headSha}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Codex review request rejected: ${error.message}`);
    process.exit(1);
  }
}
