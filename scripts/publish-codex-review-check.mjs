#!/usr/bin/env node

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const headSha = process.env.CODEX_REVIEW_HEAD_SHA;
const conclusion = process.env.CODEX_REVIEW_CONCLUSION;
const detailsUrl = process.env.CODEX_REVIEW_DETAILS_URL;

export function checkRunPayload({ headSha, conclusion, detailsUrl }) {
  if (!/^[a-f0-9]{40}$/i.test(String(headSha || ""))) {
    throw new Error("CODEX_REVIEW_HEAD_SHA must be a full 40-character commit SHA.");
  }
  if (!new Set(["success", "failure"]).has(conclusion)) {
    throw new Error("CODEX_REVIEW_CONCLUSION must be success or failure.");
  }
  if (!/^https:\/\//.test(String(detailsUrl || ""))) {
    throw new Error("CODEX_REVIEW_DETAILS_URL must be an HTTPS URL.");
  }

  const passed = conclusion === "success";
  return {
    name: "Codex Review",
    head_sha: headSha,
    status: "completed",
    conclusion,
    details_url: detailsUrl,
    output: {
      title: passed ? "Codex Review passed" : "Codex Review failed",
      summary: passed
        ? `Trusted manual validation passed for ${headSha}.`
        : `Trusted manual validation failed for ${headSha}. See the workflow logs for the blocking evidence.`
    }
  };
}

export async function publishCodexReviewCheck({
  token,
  repository,
  headSha,
  conclusion,
  detailsUrl,
  request = globalThis.fetch
}) {
  if (!token || !repository) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be owner/repo.");

  const response = await request(`https://api.github.com/repos/${owner}/${repo}/check-runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28"
    },
    body: JSON.stringify(checkRunPayload({ headSha, conclusion, detailsUrl }))
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await publishCodexReviewCheck({ token, repository, headSha, conclusion, detailsUrl });
    console.log(`Published Codex Review ${conclusion} result for ${headSha}.`);
  } catch (error) {
    console.error(`Could not publish Codex Review check: ${error.message}`);
    process.exit(1);
  }
}
