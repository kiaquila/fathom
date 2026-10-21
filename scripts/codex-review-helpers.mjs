const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const CODEX_REVIEW_LOGIN = "chatgpt-codex-connector[bot]";
// Observed native encouragement, including legacy receipts in this repository.
// Unknown prose must not turn a contradictory verdict into approval.
const CODEX_RECEIPT_ENCOURAGEMENTS = new Set([
  "Another round soon, please!",
  "Delightful!",
  "Chef's kiss.",
  "You're on a roll.",
  "Can't wait for the next one!",
  "What shall we delve into next?",
  "Breezy!",
  "Already looking forward to the next diff.",
  "More of your lovely PRs please.",
  "Keep them coming!",
  "Keep it up!",
  "Hooray!"
]);

function withoutAuthorityHtmlBlocks(value, htmlRanges = null) {
  // GFM HTML block classes: raw-text/declaration terminators, then blank-line blocks.
  const blockTags = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;
  const completeTag = /^ {0,3}<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>[ \t]*$/i;
  let result = "", end = null, blankTerminated = false, offset = 0, detailsDepth = 0, htmlContainer = null;
  for (const line of value.split(/(?<=\n)/)) {
    const context = markdownContainerContext(line);
    let content = context.content;
    if (!end && !blankTerminated && !detailsDepth) htmlContainer = null;
    if (htmlContainer && (context.quoteDepth < htmlContainer.quoteDepth || (htmlContainer.listIndent && !context.listIndent && !new RegExp("^ {" + htmlContainer.listIndent + "}|^\\t").test(content)))) { end = null; blankTerminated = false; detailsDepth = 0; htmlContainer = null; }
    if (htmlContainer?.listIndent && !context.listIndent) content = content.replace(new RegExp("^ {" + htmlContainer.listIndent + "}|^\\t"), "");
    if (blankTerminated && /^\s*$/.test(content)) { end = null; blankTerminated = false; }
    if (!end && !blankTerminated) {
      const raw = content.match(/^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i);
      const block = content.match(/^ {0,3}<\/?([a-z][a-z0-9-]*)(?=[\s/>]|$)/i);
      if (raw) end = new RegExp("</" + raw[1] + "\\s*>", "i");
      else if (/^ {0,3}<!--/.test(content)) end = /-->/;
      else if (/^ {0,3}<\?/.test(content)) end = /\?>/;
      else if (/^ {0,3}<!\[CDATA\[/.test(content)) end = /\]\]>/;
      else if (/^ {0,3}<![A-Z]/.test(content)) end = />/;
      else if ((block && blockTags.test(block[1])) || completeTag.test(content.replace(/\r?\n$/, ""))) blankTerminated = true;
    }
    if ((end || blankTerminated) && !htmlContainer) htmlContainer = context;
    const insideDetails = detailsDepth > 0;
    if (htmlRanges === null && !end) for (const tag of content.matchAll(/<\/?details\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
      if (/^<\//.test(tag[0])) detailsDepth = Math.max(0, detailsDepth - 1); else detailsDepth++;
    }
    const hidden = Boolean(end || blankTerminated || insideDetails || detailsDepth);
    if (hidden && htmlRanges) htmlRanges.push([offset, offset + line.length]);
    offset += line.length;
    result += hidden ? line.replace(/[^\r\n]/g, "") : line;
    if (end?.test(content)) end = null;
  }
  return result;
}

function rawVisibleHtml(value, rawHtml = false) {
  if (rawHtml) value = value.replace(/<\/?[a-z][a-z0-9-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/gi, tag => {
    if (/^<img\b/i.test(tag)) return tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined) || "";
    return /^<\/?(?:summary|details)\b/i.test(tag) ? " " : "";
  });
  return value.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>/gi, tag => {
    if (/^<\/?(?:summary|details)\b/i.test(tag)) return " ";
    if (/^<img\b/i.test(tag)) return tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined) || "";
    return "";
  });
}

function markdownEscapeAt(value, index) {
  const code = value.charCodeAt(index + 1);
  return value[index] === "\\" && ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126));
}

function inlineLinkEnd(value, start) {
  let index = start, depth = 0;
  const finish = end => /\n[ \t]*\n/.test(value.slice(start, end).replace(/\r\n?/g, "\n")) ? null : end;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  if (value[index] === "<") {
    index++;
    for (; index < value.length && value[index] !== ">"; index++) {
      if (markdownEscapeAt(value, index)) index++;
      else if (/[\r\n]/.test(value[index]) || value[index] === "<") return null;
    }
    if (value[index++] !== ">") return null;
  } else {
    for (; index < value.length; index++) {
      const char = value[index];
      if (markdownEscapeAt(value, index)) { index++; continue; }
      if (char === "<" || char === ">" || (char.charCodeAt(0) < 32 && !/[ \t\r\n\f\v]/.test(char)) || char.charCodeAt(0) === 127) return null;
      if (/[ \t\r\n\f\v]/.test(char) && !depth) break;
      if (char === "(" && ++depth > 32) return null;
      else if (char === ")") { if (!depth) return finish(index + 1); depth--; }
    }
    if (depth) return null;
  }
  const boundary = index;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  if (value[index] === ")") return finish(index + 1);
  if (index === boundary || !['"', "'", "("].includes(value[index])) return null;
  const closing = value[index] === "(" ? ")" : value[index];
  for (index++; index < value.length && value[index] !== closing; index++) if (markdownEscapeAt(value, index)) index++;
  if (value[index++] !== closing) return null;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  return value[index] === ")" ? finish(index + 1) : null;
}

function markdownLinkOpenerAllowed(value, index) {
  let preceding = index - 1;
  while (preceding >= 0 && value[preceding] === "\\") preceding--;
  return (index - preceding - 1) % 2 === 0;
}

function markdownLabelEnd(value, start) {
  let depth = 1;
  for (let index = start; index < value.length; index++) {
    if (markdownEscapeAt(value, index)) { index++; continue; }
    if (value[index] === "[") depth++;
    else if (value[index] === "]" && --depth === 0) return index;
    else if (/[\r\n]/.test(value[index]) && /^\n[ \t]*\n/.test(value.slice(index).replace(/\r\n?/g, "\n"))) return null;
  }
  return null;
}

function containsActiveMarkdownLink(value, defined) {
  const starts = /!?\[/g;
  for (let match; (match = starts.exec(value));) {
    if (match[0][0] === "!" || !markdownLinkOpenerAllowed(value, match.index)) continue;
    const end = markdownLabelEnd(value, starts.lastIndex);
    if (end === null) continue;
    const label = value.slice(starts.lastIndex, end);
    if (value[end + 1] === "(" && inlineLinkEnd(value, end + 2) !== null) return true;
    if (value[end + 1] === "[") {
      const referenceEnd = markdownLabelEnd(value, end + 2);
      if (referenceEnd !== null && defined(value.slice(end + 2, referenceEnd) || label)) return true;
    } else if (value[end + 1] !== "(" && defined(label)) return true;
  }
  return false;
}

function validMarkdownReferenceLabel(label) {
  return !(label.startsWith("^") && /^[^\[\]\x00-\x20]+$/.test(label.slice(1))) && label.length >= 1 && label.length <= 999 && /[^ \t\r\n\f\v]/.test(label) &&
    ![...label.matchAll(/[\[\]]/g)].some(bracket => markdownLinkOpenerAllowed(label, bracket.index));
}

function markdownReferenceDefinitions(value, hiddenLines = null) {
  const definitions = new Set();
  const lines = value.split(/\r\n|[\r\n]/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^ {0,3}\[((?:\\[\s\S]|[^\]\\\n])+)\]:([\s\S]*)$/);
    if (!match || !validMarkdownReferenceLabel(match[1])) continue;
    const candidates = [match[2]];
    for (let extra = 1; extra <= 2 && index + extra < lines.length; extra++) {
      if (!/^ {0,3}[^ \t\r\n\f\v]/.test(lines[index + extra])) break;
      candidates.push(match[2] + "\n" + lines.slice(index + 1, index + extra + 1).join("\n"));
    }
    const valid = candidates.reverse().find(candidate => /[^ \t\r\n\f\v]/.test(candidate) && inlineLinkEnd(candidate + ")", 0) === candidate.length + 1);
    if (valid !== undefined) {
      definitions.add(match[1].trim().replace(/\s+/g, " ").toLowerCase());
      if (hiddenLines) for (let line = index; line <= index + valid.split("\n").length - 1; line++) hiddenLines.add(line);
    }
  }
  return definitions;
}

function visibleMarkdownLinkLabels(value, referenceText = value) {
  const definitions = markdownReferenceDefinitions(referenceText);
  const hiddenLines = new Set(); markdownReferenceDefinitions(value, hiddenLines);
  value = value.split(/\r\n|[\r\n]/).map((line, index) => hiddenLines.has(index) ? "" : line).join("\n");
  const defined = label => definitions.has(label.trim().replace(/\s+/g, " ").toLowerCase());
  let output = "", cursor = 0;
  const starts = /!?\[/g;
  for (let match; (match = starts.exec(value));) {
    if (!markdownLinkOpenerAllowed(value, match.index)) continue;
    const labelEnd = markdownLabelEnd(value, starts.lastIndex);
    if (labelEnd === null) continue;
    const label = value.slice(starts.lastIndex, labelEnd);
    if (containsActiveMarkdownLink(label, defined)) continue;
    let end = null;
    if (value[labelEnd + 1] === "(") end = inlineLinkEnd(value, labelEnd + 2);
    else if (value[labelEnd + 1] === "[") {
      const referenceEnd = markdownLabelEnd(value, labelEnd + 2);
      if (referenceEnd !== null && defined(value.slice(labelEnd + 2, referenceEnd) || label)) end = referenceEnd + 1;
    } else if (defined(label)) end = labelEnd + 1;
    if (end === null) continue;
    output += value.slice(cursor, match.index) + label;
    cursor = end; starts.lastIndex = end;
  }
  return output + value.slice(cursor);
}

function markdownContainerContext(line) {
  let quoteDepth = 0;
  let listIndent = 0;
  while (true) {
    const quote = line.match(/^ {0,3}>[ \t]?/);
    if (quote) { quoteDepth++; line = line.slice(quote[0].length); continue; }
    const list = line.match(/^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+/);
    if (list) { listIndent += list[0].length; line = line.slice(list[0].length); continue; }
    return { content: line, quoteDepth, listIndent };
  }
}

function markdownContainerContent(line) {
  return markdownContainerContext(line).content;
}


function projectFootnoteDefinitions(value, ranges, inlineDelimiters, htmlStarts) {
  const definitions = [...value.matchAll(/^ {0,3}\[\^([^\[\]\x00-\x20]+)\]:[^\r\n]*(?:(?:\r\n|\r|\n)(?: {2,}|\t)[^\r\n]*)*/gm)]
    .filter(match => !ranges.some(([start, end]) => match.index >= start && match.index < end));
  const key = label => label.toLowerCase();
  const refs = text => {
    const rendered = visibleMarkdownLinkLabels(rawVisibleHtml(text), activeText);
    return [...rendered.matchAll(/\[\^([^\[\]\x00-\x20]+)\]/g)].filter(match => markdownLinkOpenerAllowed(rendered, match.index)).map(match => key(match[1]));
  };
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i];
    if (!inlineDelimiters.has(start) && !htmlStarts.has(start) && definitions.some(match => start >= match.index && (end <= match.index + match[0].length || /^[\r\n]*$/.test(value.slice(match.index + match[0].length, end))))) ranges.splice(i, 1);
  }
  let usage = value;
  for (const [start, end] of [...ranges].sort((a,b) => b[0]-a[0])) usage = usage.slice(0,start) + usage.slice(start,end).replace(/[^\r\n]/g," ") + usage.slice(end);
  const activeText = usage;
  for (const match of [...definitions].reverse()) usage = usage.slice(0,match.index) + match[0].replace(/[^\r\n]/g," ") + usage.slice(match.index+match[0].length);
  const used = new Set(refs(usage));
  for (const label of used) {
    const definition = definitions.find(match => key(match[1]) === label);
    if (definition) for (const ref of refs(activeText.slice(definition.index, definition.index + definition[0].length).replace(/^ {0,3}\[\^[^\]\r\n]+\]:/,""))) used.add(ref);
  }
  for (const match of [...definitions].reverse()) {
    const replacement = used.has(key(match[1])) ? match[0].replace(/^ {0,3}\[\^[^\]\r\n]+\]:/, prefix => " ".repeat(prefix.length)) : match[0].replace(/[^\r\n]/g," ");
    value = value.slice(0,match.index) + replacement + value.slice(match.index+match[0].length);
  }
  return value;
}

function literalAwareVisibleText(value) {
  value = String(value || "");
  const comments = [...value.matchAll(/<!--[\s\S]*?(?:-->|$)/g)].map(match => [match.index, match.index + match[0].length]);
  const inComment = index => comments.some(([start, end]) => index >= start && index < end);
  const htmlRanges = [];
  withoutAuthorityHtmlBlocks(value, htmlRanges);
  const rawBlockRanges = htmlRanges.map(range => [...range]);
  for (const match of value.matchAll(/<(pre|code|script|style|textarea)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)/gi)) if (!inComment(match.index)) htmlRanges.push([match.index, match.index + match[0].length]);
  const mergedHtml = [];
  for (const range of htmlRanges.sort((a, b) => a[0] - b[0])) {
    const prior = mergedHtml.at(-1);
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else mergedHtml.push([...range]);
  }
  const htmlStarts = new Set(mergedHtml.map(range => range[0]));
  const ranges = mergedHtml.map(range => [...range]);
  let offset = 0, fence = null, fenceStart = 0;
  for (const line of value.split(/(?<=\n)/)) {
    const content = markdownContainerContent(line);
    const marker = content.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(content.slice(marker[0].length))) { ranges.push([fenceStart, offset + line.length]); fence = null; }
    } else if (marker && !inComment(offset)) { fence = marker[1]; fenceStart = offset; }
    else if (/^(?: {4}| *\t)/.test(content) && !inComment(offset)) ranges.push([offset, offset + line.length]);
    offset += line.length;
  }
  if (fence) ranges.push([fenceStart, value.length]);
  const inlineDelimiters = new Map();
  const ticks = /`+/g;
  for (let opening; (opening = ticks.exec(value));) {
    if (!markdownLinkOpenerAllowed(value, opening.index) || inComment(opening.index) || ranges.some(([start, end]) => opening.index >= start && opening.index < end)) continue;
    const closing = new RegExp("(?<!`)" + opening[0] + "(?!`)", "g"); closing.lastIndex = ticks.lastIndex;
    const match = closing.exec(value);
    if (match) { inlineDelimiters.set(opening.index, opening[0].length); ranges.push([opening.index, match.index + match[0].length]); ticks.lastIndex = match.index + match[0].length; }
  }
  value = projectFootnoteDefinitions(value, ranges, inlineDelimiters, htmlStarts);
  ranges.sort((a, b) => a[0] - b[0]);
  let referenceText = value;
  for (const [start, end] of [...ranges].reverse()) referenceText = referenceText.slice(0, start) + referenceText.slice(start, end).replace(/[^\r\n]/g, " ") + referenceText.slice(end);
  let result = "", cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    if (start > cursor) result += normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor, start)), referenceText));
    const delimiter = inlineDelimiters.get(start) || 0;
    const content = value.slice(Math.max(cursor, start + delimiter), end - delimiter);
    result += htmlStarts.has(start) ? normalizeVisibleFragment(rawVisibleHtml(content, rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish)), rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish)) : content; cursor = end;
  }
  return result + normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor)), referenceText));
}

function renderedLabelAmbiguityText(value) {
  return normalizeVisibleFragment(rawVisibleHtml(String(value || "")));
}

function visibleReviewText(value) {
  return literalAwareVisibleText(value);
}

function normalizeVisibleFragment(value, rawHtml = false) {
  return value.replace(rawHtml ? /&#(x[0-9a-f]+|[0-9]+);?/gi : /&#(x[0-9a-f]+|[0-9]+);/gi, (entity, digits) => {
    const point = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/&(ZeroWidthSpace|NegativeVeryThinSpace|NegativeThinSpace|NegativeMediumSpace|NegativeThickSpace|NoBreak|zwnj|zwj|lrm|rlm|shy);/g, "").replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/&(nbsp|NonBreakingSpace|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|ThinSpace|hairsp|VeryThinSpace|MediumSpace|ThickSpace|Tab|NewLine);/g, " ").replace(/[*`~]/g, "").replace(/_/g, " ");
}

function containsNegativeReviewState(text) {
  const plain = visibleReviewText(text);
  const negativeState = /\b(?:unresolved|incomplete|pending|in[\s./:-]*progress|changes[\s./:-]*requested|fail(?:ed|ure)?|running|queued|cancel(?:led|ed)|error(?:ed)?|blocked|unknown|withdraw(?:n|al|ing)?|revok(?:e|ed|ing)|revocation|retracted|rescinded|rejected|declined|denied|aborted|abandoned|paused|suspended|skipped|stopped|terminated|expired|invalid|unavailable|inconclusive|deferred|unsuccessful|stale|outdated|superseded|waiting|timed[\s./:-]*out|action[\s./:-]*required)\b/i;
  const negatedSuccess = /\b(?:not|never|no[\s./:-]*longer|(?:has|have|had|is|was|were|could|did|does|do)n['’]t|can['’]t|won['’]t|cannot|unable[\s./:-]*to)(?:[\s./:-]*(?:yet|fully|be|been|being|to))*[\s./:-]*(?:complet(?:e|ed)|finish(?:ed)?|approv(?:e|ed)|start(?:ed)?|review(?:ed)?|pass(?:ed)?|valid(?:ate|ated)?|ready|done|success(?:ful(?:ly)?)?|available)\b/i;
  return negativeState.test(plain) || negatedSuccess.test(plain) || /\bdo\s*not\s*merge\b/i.test(plain);
}

const codexHelpIntroduction = `[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review"`;
const codexHelpFooters = [
  codexHelpIntroduction + ` or "@codex security review".
Codex reacts with 👀 while any review is running, comments if it has suggestions, and reacts with 👍 once all reviews finish with no findings.`,
  codexHelpIntroduction + `.
If Codex has suggestions, it will comment; otherwise it will react with 👍.
Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".`
].map((text) => text.replace(/\s+/g, " ").trim());

function withoutCodexHelpFooter(text) {
  const body = String(text);
  const footer = body.match(/\s*<details>\s*<summary>ℹ️ About Codex in GitHub<\/summary>\s*<br\/>\s*((?:(?!<\/?details\b)[\s\S])*)<\/details>\s*$/);
  if (!footer || !codexHelpFooters.includes(footer[1].replace(/\s+/g, " ").trim())) return body;
  return body.slice(0, footer.index);
}

function isPositiveSummaryRendering(text, headSha, securityActive) {
  const visible = withoutCodexHelpFooter(text).trim();
  const lines = visible.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.shift() !== "This comment shows the latest Codex review activity on this pull request." ||
      lines.shift() !== "| Review | Status | Commit | Review trigger |" ||
      lines.shift() !== "| --- | --- | --- | --- |") return false;
  const seen = new Set();
  for (const line of lines) {
    const row = line.match(/^\| (?:📝|🛡️) \*\*(Code Review|Security Review)\*\* \| ✅ \*\*Completed\*\*(?: <relative-time datetime="([^"<>]+)">([^<>]+)<\/relative-time>)? \| `([a-f0-9]{7,40})` \| (?:Manual request|Automatic review) \|$/);
    if (!row || seen.has(row[1]) || !headSha.startsWith(row[4]) ||
        (row[2] && (row[2] !== row[3] || !Number.isFinite(Date.parse(row[2]))))) return false;
    seen.add(row[1]);
  }
  return seen.has("Code Review") && seen.size === (securityActive ? 2 : 1) &&
    (!securityActive || seen.has("Security Review"));
}

function withoutMarkdownFences(body) {
  let fence = null;
  return String(body).split("\n").filter(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return false;
    }
    if (marker) { fence = marker[1]; return false; }
    return true;
  }).join("\n");
}

function parseStructuredCodexSummary(body, headSha, stateOnly = false, negativeOnly = false) {
  // Four-space/tab protocol openers are Markdown examples, never authority.
  const rawEnvelope = body.replace(/[^\S\r\n \t]/g, "");
  const leadingMarkers = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*([ \t]*)<!--\s*codex-(?:pull-request-review-summary|review-state:)/);
  const leadingState = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*[ \t]*<!-- codex-pull-request-review-summary -->[ \t]*\r?\n([ \t]*)<!--\s*codex-review-state:/);
  const leadingHeading = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*[ \t]*<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->[ \t]*\r?\n(?:[ \t]*\r?\n)*([ \t\uFEFF]*)## Codex Review Summary/s);
  if ([leadingMarkers, leadingState, leadingHeading].some(match => match && (/\t/.test(match[1]) || match[1].replace(/\uFEFF/g, "").length >= 4))) return null;
  body = body.trim();
  const protocolBody = withoutMarkdownFences(body).replace(/^(?: {4,}| *\t[ \t]*)<!--[^\n]*-->[ \t]*$/gm, "");
  const envelope = body.match(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (.+?) -->\s*## Codex Review Summary(?:\s|$)/s);
  if (!envelope || (!negativeOnly && ((protocolBody.match(/<!--\s*codex-pull-request-review-summary\b/g) || []).length !== 1 ||
      (protocolBody.match(/<!--\s*codex-review-state:/g) || []).length !== 1 || /<!--\s*codex-review-receipt:/.test(body)))) return null;
  if (negativeOnly && ((envelope[0].match(/<!--\s*codex-pull-request-review-summary\b/g) || []).length !== 1 ||
      (envelope[0].match(/<!--\s*codex-review-state:/g) || []).length !== 1 || /<!--\s*codex-review-receipt:/.test(envelope[0]))) return null;
  let state;
  try { state = JSON.parse(envelope[1]); } catch { return null; }
  const keysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  if (!keysAre(state, ["code_review", "security_review"])) return null;
  for (const [name, value] of Object.entries(state)) {
    if (!keysAre(value, ["commit_sha", "has_any_findings", "has_unresolved_findings", "status"])) return null;
    if (name === "security_review" && Object.values(value).every((field) => field === null)) continue;
    const knownFindings = typeof value.has_any_findings === "boolean" && typeof value.has_unresolved_findings === "boolean";
    const omittedCodeFindings = false;
    if (typeof value.commit_sha !== "string" || !/^[a-f0-9]{40}$/.test(value.commit_sha) || typeof value.status !== "string" ||
        (!knownFindings && !omittedCodeFindings) || (!value.has_any_findings && value.has_unresolved_findings)) return null;
  }
  // Decode key spellings too, so escaped duplicate JSON fields cannot override
  // an earlier negative value under a second spelling of the same key.
  const keys = [...envelope[1].matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map((match) => JSON.parse(match[1]));
  for (const key of ["code_review", "security_review", "commit_sha", "has_any_findings", "has_unresolved_findings", "status"]) {
    const expected = ["code_review", "security_review"].includes(key) ? 1 : 2;
    if (keys.filter((value) => value === key).length !== expected) return null;
  }
  const code = state.code_review;
  if (stateOnly) return state;
  if (code.commit_sha !== headSha) return null;
  // Conflicting visible severity or a second verdict cannot be hidden by JSON.
  const visibleVerdict = withoutCodexHelpFooter(body.slice(envelope[0].length));
  if (containsBlockingCodexSeverity(body) || containsNegativeReviewState(visibleVerdict) ||
      /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleVerdict)) return { result: "fail", explicitSha: true };
  const security = state.security_review;
  if (code.has_any_findings || code.has_unresolved_findings || security.has_any_findings || security.has_unresolved_findings) {
    return { result: "fail", explicitSha: true };
  }
  const securityCompleted = security.status === null || (security.commit_sha === headSha && security.status === "completed");
  const completed = code.status === "completed" && securityCompleted;
  const positiveRendering = completed && isPositiveSummaryRendering(visibleVerdict, headSha, security.status !== null);
  if (positiveRendering && code.has_any_findings === null && code.has_unresolved_findings === null) {
    // The native backend omits code findings flags when it publishes a separate
    // no-findings receipt. Null is never a positive verdict on its own.
    return { result: "pending", explicitSha: true, requiresCodeReceipt: true };
  }
  return { result: positiveRendering ? "pass" : "pending", explicitSha: true };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compareNumericIds(left, right) {
  if (!/^\d+$/.test(String(left || "")) || !/^\d+$/.test(String(right || ""))) return 0;
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
}

export function isStrictlyAfterCodexReviewRequest(value, requestMarker) {
  const valueTime = Date.parse(value || "");
  const requestedAt = Date.parse(
    requestMarker?.sourceCommentCreatedAt ||
    requestMarker?.requestedAt ||
    requestMarker?.commentCreatedAt ||
    ""
  );
  return Number.isFinite(valueTime) && Number.isFinite(requestedAt) && valueTime > requestedAt;
}

export function isTrustedAssociation(value) {
  return TRUSTED_ASSOCIATIONS.has(String(value || "").toUpperCase());
}

export function isCodexReviewCommand(body) {
  return /(?:^|\s)@codex\s+review\b/i.test(String(body || ""));
}

export function isCodexReviewCommandForHead(body, headSha) {
  const requestedHead = String(body || "").match(
    /(?:^|\s)@codex\s+review\s+`?([a-f0-9]{40})`?\b/i
  )?.[1];
  return Boolean(requestedHead) && normalize(requestedHead) === normalize(headSha);
}

export function isTrustedCodexLogin(login) {
  return normalize(login) === CODEX_REVIEW_LOGIN;
}

export function createCodexReviewRequestMarkerBody({
  headSha,
  requestId,
  sourceCommentId,
  sourceCommentCreatedAt,
  requestedAt
}) {
  const recordedAt = requestedAt || new Date().toISOString();
  return [
    `Codex review request recorded for \`${String(headSha || "").slice(0, 10)}\`.`,
    "",
    "<!-- web-design:codex-review-request",
    `CODEX_REVIEW_REQUEST_ID: ${requestId}`,
    `CODEX_REVIEW_SHA: ${headSha}`,
    `CODEX_REVIEW_SOURCE_COMMENT_ID: ${sourceCommentId}`,
    `CODEX_REVIEW_SOURCE_COMMENT_CREATED_AT: ${sourceCommentCreatedAt || recordedAt}`,
    `CODEX_REVIEW_REQUESTED_AT: ${recordedAt}`,
    "-->"
  ].join("\n");
}

export function extractCodexReviewRequestMarker(body) {
  const text = String(body || "");
  if (!text.includes("web-design:codex-review-request")) return null;

  const field = (name) =>
    text.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim() || null;
  const requestId = field("CODEX_REVIEW_REQUEST_ID");
  const sha = field("CODEX_REVIEW_SHA");
  const sourceCommentId = field("CODEX_REVIEW_SOURCE_COMMENT_ID");
  const sourceCommentCreatedAt = field("CODEX_REVIEW_SOURCE_COMMENT_CREATED_AT");
  const requestedAt = field("CODEX_REVIEW_REQUESTED_AT");

  if (!requestId || !sha || !sourceCommentId || !requestedAt) return null;
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) return null;

  return {
    requestId,
    sha,
    sourceCommentId,
    sourceCommentCreatedAt,
    requestedAt
  };
}

export function latestCodexReviewRequestMarker(comments = [], headSha) {
  return comments
    .map((comment) => {
      const marker = extractCodexReviewRequestMarker(comment?.body);
      if (!marker) return null;
      return {
        ...marker,
        commentId: String(comment.id || ""),
        commentCreatedAt: comment.created_at || null,
        author: normalize(comment.user?.login)
      };
    })
    .filter((marker) =>
      marker && marker.author === "github-actions[bot]" && marker.sha === headSha
    )
    .sort((left, right) => {
      const byRequestTime = Date.parse(right.sourceCommentCreatedAt || right.requestedAt || "") -
        Date.parse(left.sourceCommentCreatedAt || left.requestedAt || "");
      return byRequestTime || compareNumericIds(right.sourceCommentId, left.sourceCommentId);
    })[0] || null;
}

export function latestTrustedCodexReviewCommand(comments = [], timeline = [], headSha) {
  return comments
    .filter((comment) =>
      comment?.user?.type !== "Bot" &&
      isTrustedAssociation(comment?.author_association) &&
      isCodexReviewCommandForHead(comment?.body, headSha)
    )
    .sort((left, right) =>
      Date.parse(right.created_at || "") - Date.parse(left.created_at || "")
    )
    .map((comment) => ({
      requestId: `bootstrap-${comment.id}-${String(headSha).slice(0, 12)}`,
      sha: headSha,
      sourceCommentId: String(comment.id || ""),
      sourceCommentCreatedAt: comment.created_at,
      requestedAt: comment.created_at,
      commentCreatedAt: comment.created_at,
      bootstrap: true
    }))[0] || null;
}

export function extractCodexPriority(body) {
  const match = String(body || "").match(/\bP([0-3])\b/i);
  return match ? Number(match[1]) : null;
}

export function containsBlockingCodexSeverity(body) {
  return /\bP[0-2]\b/i.test(visibleReviewText(body));
}

export function classifyCodexNativeReview(review, reviewComments = [], headSha) {
  if (!review || review.commit_id !== headSha) return null;
  if (!isTrustedCodexLogin(review.user?.login)) return null;
  if (containsBlockingCodexSeverity(review.body)) return "fail";
  if (review.state === "CHANGES_REQUESTED") return "fail";

  const commentsForReview = reviewComments.filter((comment) =>
    comment.pull_request_review_id === review.id &&
    isTrustedCodexLogin(comment.user?.login)
  );
  if (commentsForReview.length > 0) {
    const priorities = commentsForReview.map((comment) => extractCodexPriority(comment.body));
    if (priorities.some((priority) => priority === null)) return "fail";
    if (Math.min(...priorities) <= 2) return "fail";
  }

  return review.state === "APPROVED" || review.state === "COMMENTED" ? "pass" : null;
}

export function latestCodexNativeReviewResult(reviews = [], reviewComments = [], headSha) {
  return reviews
    .map((review) => ({
      review,
      result: classifyCodexNativeReview(review, reviewComments, headSha)
    }))
    .filter((entry) => entry.result !== null)
    .sort((left, right) => {
      const bySubmissionTime = Date.parse(right.review.submitted_at || "") -
        Date.parse(left.review.submitted_at || "");
      return bySubmissionTime || compareNumericIds(right.review.id, left.review.id);
    })[0]?.result || null;
}

export function isAcceptableCodexSummaryComment(comment, headSha, requestedAt, sourceCommentId) {
  const body = String(comment?.body || "");
  const shortSha = String(headSha || "").slice(0, 10);
  const commentCreatedAt = Date.parse(comment?.created_at || "");
  const requestTime = Date.parse(requestedAt || "");
  const ordering = commentCreatedAt === requestTime
    ? compareNumericIds(comment?.id, sourceCommentId) > 0
    : commentCreatedAt > requestTime;
  const isAfterRequest = !requestedAt ||
    (Number.isFinite(commentCreatedAt) && Number.isFinite(requestTime) && ordering);
  if (!isAfterRequest || !isTrustedCodexLogin(comment?.user?.login)) return false;
  if (!/^[a-f0-9]{40}$/i.test(String(headSha || ""))) return false;

  // This legacy path recognizes strict receipts only. Structured whole-review
  // snapshots are independently validated by evaluateCodexCommentEvidence.
  if ((body.match(/codex-review-receipt/gi) || []).length > 1 ||
      /codex-(?:review-state|pull-request-review-summary)/i.test(body) ||
      (body.match(/\*\*Reviewed commit:/g) || []).length !== 1 ||
      containsBlockingCodexSeverity(body)) return false;
  let receipt = body.trim();
  if (receipt.startsWith("<!-- codex-review-receipt:v1 -->")) {
    receipt = receipt.slice("<!-- codex-review-receipt:v1 -->".length).trim();
  }
  receipt = withoutCodexHelpFooter(receipt).trim();
  const match = receipt.match(
    /^Codex Review: Didn't find any major issues\.([^\r\n]*)\r?\n\s*\r?\n\*\*Reviewed commit:\*\* +`([a-f0-9]{10}|[a-f0-9]{40})`$/i
  );
  if (!match) return false;
  const suffix = match[1].trim();
  if (!CODEX_RECEIPT_ENCOURAGEMENTS.has(suffix) &&
      !/^(?:\s|:[a-z0-9_+-]+:|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D)*$/u.test(suffix)) return false;
  return match[2].toLowerCase() === shortSha.toLowerCase() ||
    match[2].toLowerCase() === headSha.toLowerCase();
}

export function hasUnresolvedCodexFindings(threads = []) {
  return threads.some((thread) => thread.isResolved !== true &&
    thread.comments?.nodes?.some((comment) =>
      isTrustedCodexLogin(comment.author?.login) ||
      (comment.author?.__typename === "Bot" && comment.author.login === "chatgpt-codex-connector")));
}

// Machine snapshots cover the whole review. Legacy receipts stay strict;
// opaque presentation contributes no positive review evidence.


// The shared summary can be edited by security activity. Its server update
// time alone cannot prove that code review ran for this particular request.
function codeReviewCompletionTime(body, section = "Code Review", headSha = null) {
  // Rendered-equivalent duplicate labels are ambiguity, never new clock authority.
  const rawRows = String(body).split(/\r?\n/).filter(line => new RegExp("^ {0,3}\\|[^|]*\\b" + section + "\\s*\\|", "i").test(renderedLabelAmbiguityText(line)));
  if (rawRows.length !== 1 || [...rawRows[0].matchAll(/<!--[\s\S]*?(?:-->|$)/g)].some(comment => [...comment[0].matchAll(/\|/g)].some(pipe => markdownLinkOpenerAllowed(comment[0], pipe.index)))) return NaN;
  // A rendered code example cannot supply a canonical completion row.
  if ([...String(body).matchAll(/<summary\b(?:[^"'<>]|"[^"]*"|'[^']*')*>([\s\S]*?)<\/summary>/gi)].some(match => renderedLabelAmbiguityText(match[1]).includes(section))) return NaN;
  body = withoutMarkdownFences(withoutAuthorityHtmlBlocks(String(body).replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\r\n]/g, "")))).replace(/^ {1,3}(?=\|)/gm, "");
  const label = section === "Code Review" ? "📝 \\*\\*Code Review\\*\\*" : "🛡️ \\*\\*Security Review\\*\\*";
  const rowPattern = new RegExp('^\\| ' + label + ' \\| ✅ \\*\\*Completed\\*\\* <relative-time datetime="([^"<>]+)">([^<>]+)</relative-time> \\| `([a-f0-9]{7,40})` \\| (?:Manual request|Automatic review) \\|$', "gm");
  const rows = [...withoutCodexHelpFooter(String(body)).matchAll(rowPattern)];
  if ((String(body).match(new RegExp("^\\| " + label + " \\|", "gm")) || []).length !== 1 || rows.length !== 1 || (headSha && !headSha.startsWith(rows[0][3])) || rows[0][1] !== rows[0][2] ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(rows[0][1])) return NaN;
  const time = Date.parse(rows[0][1]);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === rows[0][1].slice(0, 19) ? time : NaN;
}


// A request or code-only receipt cannot clear a typed finding from another
// section. Only a newer independently clean snapshot with that section's own
// canonical completion clock can retire the valid current-head finding.
function hasValidFindingCompanions(state, body, observed, headSha, resolvingSection = null) {
  for (const [section, label, emoji] of [["code_review", "Code Review", "📝"], ["security_review", "Security Review", "🛡️"]]) {
    const value = state[section];
    if (section === resolvingSection) continue;
    if (!resolvingSection && value.commit_sha === headSha && (value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    if (value.status === null) {
      if (renderedLabelAmbiguityText(body).toLowerCase().includes(label.toLowerCase())) return false;
      continue;
    }
    const rowBody = resolvingSection && value.status === "running"
      ? String(body).replace(`| ${emoji} **${label}** | 🔄 **Running** since`, `| ${emoji} **${label}** | ✅ **Completed**`).replace(`| ${emoji} **${label}** | 🔄 **Running**`, `| ${emoji} **${label}** | ✅ **Completed**`)
      : body;
    if (resolvingSection && value.status === "running" && rowBody === body) return false;
    const completed = codeReviewCompletionTime(rowBody, label, value.commit_sha);
    if (!(value.status === "completed" || (resolvingSection && value.status === "running")) || !Number.isFinite(completed) || completed > observed + 999) return false;
  }
  return true;
}

function structuredNegativeTime(comment, headSha) {
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state || hasVisibleStructuredConflict(comment.body) || !hasValidFindingCompanions(state, comment.body, observed, headSha)) return observed;
  const times = [];
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    const value = state[section];
    if (value.commit_sha !== headSha || !(value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    const completed = codeReviewCompletionTime(comment.body, label, headSha);
    times.push(value.status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? Math.floor(completed / 1000) * 1000 : observed);
  }
  return times.length ? Math.max(...times) : observed;
}

function hasVisibleStructuredConflict(body, section = null) {
  if (/^(?: {4,}| *\t[ \t]*)<!--/m.test(String(body))) return true;
  let visible = withoutCodexHelpFooter(String(body).trim().replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  visible = visible.replace(/^ {1,3}(?=\|)/gm, "");
  if (section) {
    const other = section === "code_review" ? "| 🛡️ **Security Review** |" : "| 📝 **Code Review** |";
    const rows = visible.split("\n").filter(line => line.startsWith(other));
    if (rows.some(line => !/^\| [📝🛡️]+ \*\*(?:Code|Security) Review\*\* \| (?:✅ \*\*Completed\*\*|🔄 \*\*Running\*\*)(?: since)?(?: <relative-time datetime="[^"<>]+">[^<>]+<\/relative-time>)? \| `[a-f0-9]{7,40}` \| (?:Manual request|Automatic review) \|$/.test(line))) return true;
  }
  if (section) visible = visible.split("\n").filter(line => !line.startsWith(section === "code_review" ? "| 🛡️ **Security Review** |" : "| 📝 **Code Review** |")).join("\n");
  return /<!--\s*codex-/i.test(visible) || containsBlockingCodexSeverity(body) || containsNegativeReviewState(visible) || /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleReviewText(visible));
}

function isSupersededTypedFinding(comment, snapshots, headSha) {
  const body = String(comment.body || "").trim();
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state) return false;
  const visible = withoutCodexHelpFooter(body.replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  if (containsBlockingCodexSeverity(body) || containsNegativeReviewState(visible) || /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleReviewText(visible))) return false;
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  if (!hasValidFindingCompanions(state, body, observed, headSha)) return false;
  const findings = [["code_review", "Code Review"], ["security_review", "Security Review"]].filter(([section]) => state[section].commit_sha === headSha && (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
  return findings.length > 0 && findings.every(([section, label]) => {
    const completed = codeReviewCompletionTime(body, label, headSha);
    const fence = Math.floor((state[section].status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? completed : observed) / 1000);
    return snapshots.some(({ comment: clean }) => {
      if (clean === comment || hasVisibleStructuredConflict(clean.body, section)) return false;
      const cleanState = parseStructuredCodexSummary(String(clean.body || ""), headSha, true);
      if (!cleanState || !hasValidFindingCompanions(cleanState, clean.body, Date.parse(clean.updated_at || clean.created_at || ""), headSha, section)) return false;
      const value = cleanState[section];
      const time = codeReviewCompletionTime(clean.body, label, headSha);
      const updated = Date.parse(clean.updated_at || clean.created_at || "");
      return value.commit_sha === headSha && value.status === "completed" && value.has_any_findings === false && value.has_unresolved_findings === false && Number.isFinite(time) && time <= updated + 999 && Math.floor(time / 1000) > fence;
    });
  });
}

function hasUnclearedStructuredFindings(snapshots, headSha) {
  const states = snapshots.map(({ comment, result }) => ({ comment, result,
    state: parseStructuredCodexSummary(String(comment.body || ""), headSha, true),
    negativeState: parseStructuredCodexSummary(String(comment.body || ""), headSha, true, true),
    time: Date.parse(comment.updated_at || comment.created_at || "")
  })).filter((entry) => (entry.state || entry.negativeState) && Number.isFinite(entry.time));
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    const findings = states.map(entry => ({ ...entry, state: entry.negativeState || entry.state })).filter(({ state }) => state[section].commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
    if (!findings.length) continue;
    const fence = Math.max(...findings.map(({ comment, state, time }) => {
      const completed = codeReviewCompletionTime(comment.body, label, headSha);
      return Math.floor((state[section].status === "completed" && Number.isFinite(completed) && completed <= time + 999 ? completed : time) / 1000);
    }));
    const cleared = states.some(({ comment, state, result, time }) => {
      if (!state) return false;
      const value = state[section];
      const completed = codeReviewCompletionTime(comment.body, label, headSha);
      return hasValidFindingCompanions(state, comment.body, time, headSha, section) && !hasVisibleStructuredConflict(comment.body, section) && value.commit_sha === headSha && value.status === "completed" &&
        value.has_any_findings === false && value.has_unresolved_findings === false &&
        Number.isFinite(completed) && completed <= time + 999 && Math.floor(completed / 1000) > fence;
    });
    if (!cleared) return true;
  }
  return false;
}


function hasFreshCodeReviewCompletion(body, requestMarker, updatedAt) {
  const time = codeReviewCompletionTime(body);
  const cutoff = Date.parse(requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt || requestMarker?.commentCreatedAt || "");
  const snapshotTime = Date.parse(updatedAt || "");
  // GitHub comment timestamps have second precision; row times retain fractions.
  return Number.isFinite(time) && Number.isFinite(cutoff) && Number.isFinite(snapshotTime) &&
    Math.floor(time / 1000) > Math.floor(cutoff / 1000) && time <= snapshotTime + 999;
}

export function evaluateCodexCommentEvidence(comments, headSha, requestMarker, nativeResult = null, nativeTime = null) {
  let candidates = [];
  if (nativeResult) candidates.push({ result: nativeResult, time: Date.parse(nativeTime || "") });
  for (const comment of comments) {
    if (!isTrustedCodexLogin(comment.user?.login)) continue;
    const body = String(comment.body || "").trim();
    const structured = /codex-(?:pull-request-review-summary|review-state)/i.test(body);
    const signal = structured || /codex-review-receipt|^Codex Review:/i.test(body);
    if (!signal) continue;
    const cutoff = requestMarker.sourceCommentCreatedAt || requestMarker.requestedAt || requestMarker.commentCreatedAt;
    const strictReceipt = !structured && isAcceptableCodexSummaryComment(comment, headSha);
    // Static approval cannot be refreshed by an edit. Pending or negative edits
    // are newly observed signals and retain their server update time.
    if (strictReceipt && !isAcceptableCodexSummaryComment(comment, headSha, cutoff, requestMarker.sourceCommentId)) continue;
    const time = Date.parse((strictReceipt ? comment.created_at : comment.updated_at || comment.created_at) || "");
    if (!Number.isFinite(time)) return "pending";
    let result = "pending";
    if (structured) result = parseStructuredCodexSummary(String(comment.body || ""), headSha)?.result || "pending";
    else if (strictReceipt) result = "pass";
    else if (containsBlockingCodexSeverity(body)) result = "fail";
    if (structured && result === "pass" &&
        (!isStrictlyAfterCodexReviewRequest(new Date(time).toISOString(), requestMarker) ||
         !hasFreshCodeReviewCompletion(body, requestMarker, comment.updated_at || comment.created_at))) result = "pending";
    candidates.push({ result, time: structured && result === "pass" ? Math.floor(codeReviewCompletionTime(body) / 1000) * 1000 : structured && result === "fail" ? structuredNegativeTime(comment, headSha) : time, snapshotTime: structured && result === "fail" ? structuredNegativeTime(comment, headSha) : time, structured, comment });
  }
  if (hasUnclearedStructuredFindings(candidates.filter((entry) => entry.structured), headSha)) return "pending";
  const history = candidates.filter(entry => entry.structured);
  candidates = candidates.filter(entry => !(entry.structured && isSupersededTypedFinding(entry.comment, history, headSha)));
  const snapshots = candidates.filter((entry) => entry.structured);
  if (snapshots.length) {
    const latest = Math.max(...snapshots.map((entry) => entry.snapshotTime));
    const current = snapshots.filter((entry) => entry.snapshotTime === latest);
    if (current.some((entry) => entry.result === "fail")) return "fail";
    if (current.some((entry) => entry.result !== "pass")) return "pending";
  }
  const time = Math.max(...candidates.map((entry) => entry.time).filter(Number.isFinite));
  const latest = candidates.filter((entry) => entry.time === time);
  if (latest.some((entry) => entry.result === "fail")) return "fail";
  if (latest.some((entry) => entry.result !== "pass")) return "pending";
  return latest.some((entry) => entry.result === "pass") ? "pass" : "pending";
}
